import {
  applyAction,
  createGame,
  currentActor,
  defaultConfig,
  defaultAction,
  greedyBot,
  legalActions,
  redactEvent,
  redactState,
  type Action,
  type CardDef,
  type GameEvent,
  type GameState,
  type RulesConfig,
  type RulesEnv,
  type Seed,
} from '@kot/rules';
import type { LoadedCardSet } from '@kot/cardsets';
import { pickMonsters } from './monsters.js';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type AckErrorCode,
  type CardSetInfo,
  type GameActionInput,
  type GameCardsMessage,
  type GameUpdateMessage,
  type PlayerInfo,
  type RoomPhase,
  type RoomSnapshot,
} from '@kot/protocol';
import type { Scheduler } from './scheduler.js';

export type Result = { ok: true } | { ok: false; code: AckErrorCode };
const OK: Result = { ok: true };
const fail = (code: AckErrorCode): Result => ({ ok: false, code });

/** 把狀態推送給玩家。玩家不在線時由實作端忽略。 */
export interface Publisher {
  roomState(playerId: string, room: RoomSnapshot | null): void;
  /** 這場對局的完整卡牌目錄（開局與重連時送出）。 */
  gameCards(playerId: string, message: GameCardsMessage): void;
  gameUpdate(playerId: string, message: GameUpdateMessage): void;
}

export interface Timings {
  /** 輪到在線玩家擲骰／停止的時限。 */
  decisionMs: number;
  /** 輪到在線玩家回應提示（讓位、反應、分配治療等）的時限。 */
  yieldMs: number;
  /** 已被標為代打、但仍在線的玩家，每一步的等待時間（給他搶回控制權的機會）。 */
  awayConnectedMs: number;
  /** 斷線或已離開的玩家，每一步的等待時間。 */
  awayOfflineMs: number;
  /** 房間內沒有任何在線玩家多久後關閉。 */
  emptyRoomMs: number;
  /** 大廳階段，離線的成員多久後被移出房間（避免佔位、擋住開局）。 */
  lobbyOfflineMs: number;
  /** 對局結束後，房間最多保留多久（玩家都還在線也會關閉）。 */
  overRoomMs: number;
}

export const DEFAULT_TIMINGS: Timings = {
  decisionMs: 45_000,
  yieldMs: 20_000,
  awayConnectedMs: 8_000,
  awayOfflineMs: 1_500,
  emptyRoomMs: 5 * 60_000,
  lobbyOfflineMs: 60_000,
  overRoomMs: 10 * 60_000,
};

export interface RoomDeps {
  scheduler: Scheduler;
  publisher: Publisher;
  /** 產生新對局的 seed（正式環境是 128 位元的 CSPRNG 字串；機密，見 randomSeed）。 */
  newSeed: () => Seed;
  /** 為這場對局隨機分配怪獸造型（外觀用，不是機密；預設為 CSPRNG 洗牌）。 */
  pickMonsters?: (playerCount: number) => number[];
  timings: Timings;
  /** 房間關閉時通知管理者。 */
  onClose: (room: Room) => void;
  /** 成員被系統移出房間（例如大廳離線逾時）時通知管理者。 */
  onMemberRemoved: (playerId: string) => void;
}

interface Member {
  id: string;
  nickname: string;
  ready: boolean;
  connected: boolean;
  away: boolean;
  left: boolean;
  seat: number | null;
  /** 這場的怪獸造型（開局時隨機分配）。 */
  monster: number | null;
}

/**
 * 一個房間：大廳 → 對局 → 結束。
 * 所有規則都交給 @kot/rules；這裡只負責「誰能做什麼」、計時與推送。
 */
export class Room {
  phase: RoomPhase = 'lobby';
  hostId: string;
  private readonly members: Member[] = [];
  private state: GameState | null = null;
  /** 對局動作日誌（含系統代打的動作），M5 寫入事件日誌時使用。 */
  private readonly log: Action[] = [];
  private seed: Seed = 0;
  private config: RulesConfig | null = null;
  private readonly env: RulesEnv;
  private readonly cardsMessage: GameCardsMessage;
  private cancelTurnTimer: (() => void) | null = null;
  private cancelCloseTimer: (() => void) | null = null;
  private cancelOverTimer: (() => void) | null = null;
  private readonly offlineTimers = new Map<string, () => void>();
  private deadline: number | null = null;
  private closed = false;

  constructor(
    readonly code: string,
    host: { id: string; nickname: string },
    private readonly cardSet: LoadedCardSet,
    private readonly deps: RoomDeps,
  ) {
    const cards: Record<string, CardDef> = {};
    for (const card of cardSet.set.cards) cards[card.id] = card;
    this.env = { cards };
    this.cardsMessage = { cardSetId: cardSet.set.id, cards: cardSet.set.cards };
    this.hostId = host.id;
    this.members.push({
      id: host.id,
      nickname: host.nickname,
      ready: true,
      connected: true,
      away: false,
      left: false,
      seat: null,
      monster: null,
    });
    this.broadcastRoom();
  }

  // ── 查詢 ───────────────────────────────────────────────

  has(playerId: string): boolean {
    return this.members.some((m) => m.id === playerId && !m.left);
  }

  get activeCount(): number {
    return this.members.filter((m) => !m.left).length;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** 目前還在房間裡的玩家 id。 */
  memberIds(): string[] {
    return this.members.filter((m) => !m.left).map((m) => m.id);
  }

  /** 重放所需的全部資料：設定、seed、卡牌組（id 與內容雜湊）與動作日誌。 */
  replayInfo(): {
    config: RulesConfig | null;
    seed: Seed;
    cardSetId: string;
    cardSetHash: string;
    actions: readonly Action[];
  } {
    return {
      config: this.config,
      seed: this.seed,
      cardSetId: this.cardSet.set.id,
      cardSetHash: this.cardSet.hash,
      actions: this.log,
    };
  }

  /** 卡牌組摘要（顯示用）。 */
  cardSetInfo(): CardSetInfo {
    return {
      id: this.cardSet.set.id,
      name: this.cardSet.set.name,
      cardCount: this.cardSet.set.cards.length,
    };
  }

  snapshot(): RoomSnapshot {
    const players: PlayerInfo[] = this.members.map((m) => ({
      id: m.id,
      nickname: m.nickname,
      seat: m.seat,
      monster: m.monster,
      ready: m.ready,
      connected: m.connected,
      away: m.away,
      left: m.left,
    }));
    return {
      code: this.code,
      cardSet: this.cardSetInfo(),
      phase: this.phase,
      hostId: this.hostId,
      players,
    };
  }

  // ── 大廳 ───────────────────────────────────────────────

  join(player: { id: string; nickname: string }): Result {
    if (this.has(player.id)) {
      return OK;
    }
    if (this.phase !== 'lobby') {
      return fail('game_in_progress');
    }
    if (this.activeCount >= MAX_PLAYERS) {
      return fail('room_full');
    }
    this.members.push({
      id: player.id,
      nickname: player.nickname,
      ready: false,
      connected: true,
      away: false,
      left: false,
      seat: null,
      monster: null,
    });
    this.cancelClose();
    this.broadcastRoom();
    return OK;
  }

  setReady(playerId: string, ready: boolean): Result {
    const member = this.find(playerId);
    if (!member) return fail('not_in_room');
    if (this.phase !== 'lobby') return fail('wrong_state');
    if (playerId !== this.hostId) {
      member.ready = ready; // 房主視為永遠已準備
    }
    this.broadcastRoom();
    return OK;
  }

  start(playerId: string): Result {
    if (!this.find(playerId)) return fail('not_in_room');
    if (playerId !== this.hostId) return fail('not_host');
    if (this.phase !== 'lobby') return fail('wrong_state');
    const players = this.members.filter((m) => !m.left);
    if (players.length < MIN_PLAYERS) return fail('not_enough_players');
    if (players.some((m) => !m.ready)) return fail('not_ready');

    const looks = (this.deps.pickMonsters ?? pickMonsters)(players.length);
    players.forEach((m, seat) => {
      m.seat = seat;
      m.monster = looks[seat] ?? seat;
      m.away = false;
    });
    this.seed = this.deps.newSeed();
    this.config = defaultConfig(players.length);
    const created = createGame(this.config, this.seed, this.env);
    this.state = created.state;
    this.phase = 'playing';
    this.armTurnTimer(); // 先設計時，推送的 remainingMs 才有值
    this.broadcastRoom();
    this.broadcastCards();
    this.broadcastGame(created.events);
    return OK;
  }

  // ── 離開與連線狀態 ──────────────────────────────────────

  /** 離開房間。大廳會移除；對局中的座位由系統代打到結束。 */
  leave(playerId: string): Result {
    const member = this.find(playerId);
    if (!member) return fail('not_in_room');
    this.clearOfflineTimer(playerId);

    if (this.phase === 'lobby') {
      this.members.splice(this.members.indexOf(member), 1);
      if (this.members.length === 0) {
        this.close();
        return OK;
      }
    } else {
      const wasActor = this.phase === 'playing' && this.actorMember()?.id === playerId;
      member.left = true;
      member.connected = false;
      member.away = this.phase === 'playing';
      if (this.activeCount === 0) {
        this.close();
        return OK;
      }
      // 只有「輪到他」時才縮短計時；離開不會重設別人的時鐘
      if (wasActor) this.shortenTurnTimer(this.deps.timings.awayOfflineMs);
    }
    if (this.hostId === playerId) this.transferHost();
    this.afterPresenceChange();
    this.broadcastRoom();
    return OK;
  }

  setConnected(playerId: string, connected: boolean): void {
    const member = this.find(playerId);
    if (!member || member.connected === connected) return;
    member.connected = connected;
    if (this.phase === 'lobby') {
      if (connected) this.clearOfflineTimer(playerId);
      else this.armOfflineTimer(playerId);
    }
    this.afterPresenceChange();
    this.broadcastRoom();
    // 斷線只會「縮短」輪到他時的等待；重連不會重設時鐘（否則反覆重連就能無限拖延）
    if (!connected && this.phase === 'playing' && this.actorMember()?.id === playerId) {
      this.shortenTurnTimer(this.deps.timings.awayOfflineMs);
    }
  }

  /** 房主離開時，把房主交給在線的下一位（沒有人在線就交給第一位）。 */
  private transferHost(): void {
    const candidates = this.members.filter((m) => !m.left);
    const next = candidates.find((m) => m.connected) ?? candidates[0];
    if (next) {
      this.hostId = next.id;
      next.ready = true;
    }
  }

  private armOfflineTimer(playerId: string): void {
    this.clearOfflineTimer(playerId);
    const cancel = this.deps.scheduler.after(this.deps.timings.lobbyOfflineMs, () => {
      this.offlineTimers.delete(playerId);
      this.guarded(() => {
        const member = this.find(playerId);
        if (this.phase !== 'lobby' || !member || member.connected) return;
        this.leave(playerId);
        this.deps.onMemberRemoved(playerId);
      });
    });
    this.offlineTimers.set(playerId, cancel);
  }

  private clearOfflineTimer(playerId: string): void {
    this.offlineTimers.get(playerId)?.();
    this.offlineTimers.delete(playerId);
  }

  /** 計時器回呼不能讓整個伺服器因為例外而崩潰：記錄錯誤後繼續。 */
  private guarded(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      console.error(
        '房間計時器處理失敗',
        this.code,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /** 重連後重送完整狀態（不含事件，避免重播動畫）。 */
  resync(playerId: string): void {
    const member = this.find(playerId);
    if (!member) return;
    this.deps.publisher.roomState(playerId, this.snapshot());
    if (this.state) {
      this.deps.publisher.gameCards(playerId, this.cardsMessage);
      this.deps.publisher.gameUpdate(playerId, this.buildUpdate(member, []));
    }
  }

  // ── 對局 ───────────────────────────────────────────────

  act(playerId: string, input: GameActionInput): Result {
    const member = this.find(playerId);
    if (!member) return fail('not_in_room');
    if (this.phase === 'lobby' || !this.state || member.seat === null) return fail('wrong_state');

    const action = this.toAction(input, member.seat);
    const result = applyAction(this.state, action, this.env);
    if (!result.ok) return fail(result.error);

    const wasAway = member.away;
    member.away = false; // 玩家自己做出合法操作，取回控制權
    this.commit(action, result.state, result.events);
    if (wasAway) this.broadcastRoom();
    return OK;
  }

  // ── 內部 ───────────────────────────────────────────────

  private find(playerId: string): Member | undefined {
    return this.members.find((m) => m.id === playerId && !m.left);
  }

  private toAction(input: GameActionInput, seat: number): Action {
    switch (input.type) {
      case 'roll':
        return { type: 'roll', seat, keep: input.keep };
      case 'endRolling':
      case 'sweep':
      case 'endTurn':
        return { type: input.type, seat };
      case 'yieldDecision':
        return input.takeCard === undefined
          ? { type: 'yieldDecision', seat, leave: input.leave }
          : { type: 'yieldDecision', seat, leave: input.leave, takeCard: input.takeCard };
      case 'buy': {
        const action: Extract<Action, { type: 'buy' }> = {
          type: 'buy',
          seat,
          cardId: input.cardId,
        };
        if (input.from !== undefined) action.from = input.from;
        if (input.energy !== undefined) action.energy = input.energy;
        if (input.target !== undefined) action.target = input.target;
        return action;
      }
      case 'useCard': {
        const action: Extract<Action, { type: 'useCard' }> = {
          type: 'useCard',
          seat,
          cardId: input.cardId,
        };
        if (input.args !== undefined) {
          const args: NonNullable<typeof action.args> = {};
          if (input.args.die !== undefined) args.die = input.args.die;
          if (input.args.face !== undefined) args.face = input.args.face;
          if (input.args.target !== undefined) args.target = input.args.target;
          if (input.args.cards !== undefined) args.cards = input.args.cards;
          action.args = args;
        }
        return action;
      }
      case 'reactDecision':
        return { type: 'reactDecision', seat, cardId: input.cardId };
      case 'heartsDecision':
        return {
          type: 'heartsDecision',
          seat,
          self: input.self,
          poison: input.poison,
          shrink: input.shrink,
          others: input.others,
        };
      case 'probeDecision': {
        const action: Extract<Action, { type: 'probeDecision' }> = {
          type: 'probeDecision',
          seat,
          die: input.die,
        };
        if (input.target !== undefined) action.target = input.target;
        return action;
      }
      case 'opportunityDecision':
        return { type: 'opportunityDecision', seat, buy: input.buy };
    }
  }

  private commit(action: Action, state: GameState, events: GameEvent[]): void {
    this.state = state;
    this.log.push(action);
    if (state.phase === 'over') {
      this.phase = 'over';
      this.cancelTurn();
      this.cancelOverTimer = this.deps.scheduler.after(this.deps.timings.overRoomMs, () => {
        this.guarded(() => {
          this.close();
        });
      });
      this.broadcastGame(events);
      this.broadcastRoom();
      return;
    }
    this.armTurnTimer();
    this.broadcastGame(events);
  }

  private actorMember(): Member | undefined {
    if (!this.state) return undefined;
    const seat = currentActor(this.state);
    return seat === null ? undefined : this.members.find((m) => m.seat === seat);
  }

  private cancelTurn(): void {
    this.cancelTurnTimer?.();
    this.cancelTurnTimer = null;
    this.deadline = null;
  }

  /** 為目前的決策者重設計時（每次狀態推進後呼叫）；逾時就代打一步。 */
  private armTurnTimer(): void {
    const state = this.state;
    if (!state || state.phase === 'over' || this.closed) {
      this.cancelTurn();
      return;
    }
    const actor = this.actorMember();
    if (!actor) {
      this.cancelTurn();
      return;
    }
    const { timings } = this.deps;
    const offline = actor.left || !actor.connected;
    const delay = offline
      ? timings.awayOfflineMs
      : actor.away
        ? timings.awayConnectedMs
        : state.phase === 'prompt'
          ? timings.yieldMs
          : timings.decisionMs;
    this.scheduleTurnTimer(delay);
  }

  private scheduleTurnTimer(delay: number): void {
    const state = this.state;
    if (!state) return;
    this.cancelTurn();
    this.deadline = this.deps.scheduler.now() + delay;
    const version = state.version;
    this.cancelTurnTimer = this.deps.scheduler.after(delay, () => {
      this.guarded(() => {
        this.onTurnTimeout(version);
      });
    });
  }

  /** 只縮短、不延長目前的等待，並把新的剩餘時間通知所有人。 */
  private shortenTurnTimer(maxMs: number): void {
    if (!this.state || this.state.phase === 'over' || this.closed || this.deadline === null) return;
    if (this.deadline - this.deps.scheduler.now() <= maxMs) return;
    this.scheduleTurnTimer(maxMs);
    this.broadcastGame([]);
  }

  private onTurnTimeout(version: number): void {
    const state = this.state;
    if (this.closed || !state || state.version !== version || state.phase === 'over') return;
    const actor = this.actorMember();
    if (!actor) return;

    const becameAway = !actor.away;
    actor.away = true;
    const picked = this.pickTimeoutAction(state);
    if (!picked) {
      // 沒有任何可接受的動作（不應發生）：記錄並以完整時限重試，避免卡死也避免緊迴圈
      console.error('代打找不到可接受的動作', this.code);
      this.scheduleTurnTimer(this.deps.timings.decisionMs);
      return;
    }
    this.commit(picked.action, picked.result.state, picked.result.events);
    if (becameAway) this.broadcastRoom();
  }

  /**
   * 代打動作：先用機器人的選擇；若被拒絕或丟出例外，改用最保守的預設動作，再不行就逐一嘗試所有合法動作。
   * 這樣單一卡牌組合的邊角問題不會讓整個房間卡死。
   */
  private pickTimeoutAction(
    state: GameState,
  ): { action: Action; result: Extract<ReturnType<typeof applyAction>, { ok: true }> } | null {
    const candidates: (() => Action | null)[] = [
      () => greedyBot(state, this.env),
      () => defaultAction(state),
    ];
    const tried = new Set<string>();
    const attempt = (
      make: () => Action | null,
    ): { action: Action; result: Extract<ReturnType<typeof applyAction>, { ok: true }> } | null => {
      try {
        const action = make();
        if (!action) return null;
        const key = JSON.stringify(action);
        if (tried.has(key)) return null;
        tried.add(key);
        const result = applyAction(state, action, this.env);
        if (result.ok) return { action, result };
        console.error('代打動作被拒絕', this.code, result.error);
      } catch (error) {
        console.error('代打動作失敗', this.code, error instanceof Error ? error.message : error);
      }
      return null;
    };
    for (const make of candidates) {
      const picked = attempt(make);
      if (picked) return picked;
    }
    let legal: Action[];
    try {
      legal = legalActions(state, this.env);
    } catch {
      legal = [];
    }
    for (const action of legal) {
      const picked = attempt(() => action);
      if (picked) return picked;
    }
    return null;
  }

  private afterPresenceChange(): void {
    const anyOnline = this.members.some((m) => !m.left && m.connected);
    if (anyOnline) {
      this.cancelClose();
    } else if (!this.cancelCloseTimer && !this.closed) {
      this.cancelCloseTimer = this.deps.scheduler.after(this.deps.timings.emptyRoomMs, () => {
        this.guarded(() => {
          this.close();
        });
      });
    }
  }

  private cancelClose(): void {
    this.cancelCloseTimer?.();
    this.cancelCloseTimer = null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelTurn();
    this.cancelClose();
    this.cancelOverTimer?.();
    this.cancelOverTimer = null;
    for (const cancel of this.offlineTimers.values()) cancel();
    this.offlineTimers.clear();
    this.deps.onClose(this);
  }

  private broadcastRoom(): void {
    const snapshot = this.snapshot();
    for (const member of this.members) {
      if (!member.left) this.deps.publisher.roomState(member.id, snapshot);
    }
  }

  private broadcastCards(): void {
    for (const member of this.members) {
      if (!member.left) this.deps.publisher.gameCards(member.id, this.cardsMessage);
    }
  }

  private broadcastGame(events: GameEvent[]): void {
    for (const member of this.members) {
      if (!member.left) this.deps.publisher.gameUpdate(member.id, this.buildUpdate(member, events));
    }
  }

  private buildUpdate(viewer: Member, events: GameEvent[]): GameUpdateMessage {
    const state = this.state;
    if (!state) throw new Error('對局尚未開始');
    const actor = currentActor(state);
    return {
      version: state.version,
      // 依視角遮蔽：牌庫內容、亂數狀態、別人窺看到的牌都不外洩
      state: redactState(state, viewer.seat),
      events: events.map((event) => redactEvent(event, viewer.seat)),
      remainingMs:
        this.deadline === null ? null : Math.max(0, this.deadline - this.deps.scheduler.now()),
      actorSeat: actor,
    };
  }
}
