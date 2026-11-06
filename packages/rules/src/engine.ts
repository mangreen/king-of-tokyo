/**
 * 規則引擎核心：applyAction(state, action) → { state, events }。
 *
 * 純函式：不修改傳入的 state、不使用 Math.random / Date.now / I/O。
 * 亂數狀態在 state.rng 內，因此「初始 seed + 動作序列」可完整重放。
 */
import { countFaces, numberVp, rollDie } from './dice.js';
import { pickWinners } from './outcome.js';
import {
  aliveMonsters,
  cloneState,
  getMonster,
  isBayOpen,
  nextAliveSeat,
  occupantOf,
  roundPosition,
} from './state.js';
import type {
  Action,
  ActionResult,
  ErrorCode,
  Face,
  GameEvent,
  GameState,
  VpReason,
  WinReason,
} from './types.js';

function fail(error: ErrorCode): ActionResult {
  return { ok: false, error };
}

function isWellFormed(action: Action): boolean {
  switch (action.type) {
    case 'roll':
      return Array.isArray(action.keep) && Number.isInteger(action.seat);
    case 'endRolling':
      return Number.isInteger(action.seat);
    case 'yieldDecision':
      return typeof action.leave === 'boolean' && Number.isInteger(action.seat);
    default:
      return false;
  }
}

/** 驗證 keep 是「不重複、在範圍內的索引」，且至少要擲一顆。 */
function isValidKeep(keep: readonly number[], diceCount: number): boolean {
  if (keep.length >= diceCount) {
    return false; // 沒有任何骰子要重擲，沒有意義
  }
  const seen = new Set<number>();
  for (const index of keep) {
    if (!Number.isInteger(index) || index < 0 || index >= diceCount || seen.has(index)) {
      return false;
    }
    seen.add(index);
  }
  return true;
}

/**
 * 套用一個動作。回傳新的 state 與這個動作產生的事件；
 * 不合法的動作回傳穩定的錯誤碼，且不改變 state。
 */
export function applyAction(state: GameState, action: Action): ActionResult {
  if (state.phase === 'over') {
    return fail('game_over');
  }
  // 引擎也可能在沒有經過協定層驗證時被呼叫：形狀不對一律回穩定的錯誤碼，不丟例外
  if (!isWellFormed(action)) {
    return fail('invalid_action');
  }

  switch (action.type) {
    case 'roll':
    case 'endRolling': {
      if (state.phase !== 'roll') {
        return fail('wrong_phase');
      }
      if (action.seat !== state.turn.seat) {
        return fail('not_your_turn');
      }
      if (action.type === 'roll') {
        if (state.turn.rollsUsed >= state.config.maxRolls) {
          return fail('no_rolls_left');
        }
        const keep = state.turn.rollsUsed === 0 ? [] : action.keep;
        if (state.turn.rollsUsed === 0 && action.keep.length > 0) {
          return fail('invalid_keep');
        }
        if (!isValidKeep(keep, state.config.diceCount)) {
          return fail('invalid_keep');
        }
        const next = cloneState(state);
        const events: GameEvent[] = [];
        doRoll(next, keep, events);
        next.version += 1;
        return { ok: true, state: next, events };
      }
      if (state.turn.rollsUsed === 0) {
        return fail('roll_first');
      }
      const next = cloneState(state);
      const events: GameEvent[] = [];
      finishRolling(next, events);
      next.version += 1;
      return { ok: true, state: next, events };
    }

    case 'yieldDecision': {
      if (state.phase !== 'yield' || !state.pending) {
        return fail('wrong_phase');
      }
      if (action.seat !== state.pending.queue[0]) {
        return fail('not_your_turn');
      }
      const next = cloneState(state);
      const events: GameEvent[] = [];
      decideYield(next, action.leave, events);
      next.version += 1;
      return { ok: true, state: next, events };
    }
  }
}

// ── 擲骰 ────────────────────────────────────────────────

function doRoll(s: GameState, keep: readonly number[], events: GameEvent[]): void {
  const keepSet = new Set(keep);
  const dice: Face[] = [...s.turn.dice];
  const rerolled: number[] = [];
  for (let i = 0; i < s.config.diceCount; i += 1) {
    if (!keepSet.has(i)) {
      const [face, rng] = rollDie(s.rng);
      s.rng = rng;
      dice[i] = face;
      rerolled.push(i);
    }
  }
  s.turn.dice = dice;
  s.turn.rollsUsed += 1;
  events.push({
    type: 'dice_rolled',
    seat: s.turn.seat,
    rollNumber: s.turn.rollsUsed,
    dice: [...dice],
    rerolled,
  });
  // 用完所有擲骰次數就自動進入結算。R-DICE-01
  if (s.turn.rollsUsed >= s.config.maxRolls) {
    finishRolling(s, events);
  }
}

function finishRolling(s: GameState, events: GameEvent[]): void {
  events.push({ type: 'rolling_ended', seat: s.turn.seat, dice: [...s.turn.dice] });
  resolveDice(s, events);
}

// ── 結算骰子（R-DICE-06：VP → 能量 → 治療 → 攻擊）──────────────

function gainVp(s: GameState, seat: number, amount: number, reason: VpReason, ev: GameEvent[]) {
  if (amount <= 0) {
    return;
  }
  getMonster(s, seat).vp += amount;
  ev.push({ type: 'vp_gained', seat, amount, reason });
}

function resolveDice(s: GameState, events: GameEvent[]): void {
  const seat = s.turn.seat;
  const me = getMonster(s, seat);
  const counts = countFaces(s.turn.dice);

  gainVp(s, seat, numberVp(s.turn.dice), 'dice', events);

  const energy = counts['energy'] ?? 0;
  if (energy > 0) {
    me.energy += energy;
    events.push({ type: 'energy_gained', seat, amount: energy });
  }

  const heal = counts['heal'] ?? 0;
  if (heal > 0) {
    if (me.location !== null) {
      events.push({ type: 'heal_ignored', seat, faces: heal }); // R-HEAL-02
    } else {
      const amount = Math.min(heal, me.maxHp - me.hp); // R-HEAL-01
      if (amount > 0) {
        me.hp += amount;
        events.push({ type: 'healed', seat, amount });
      }
    }
  }

  const attacks = counts['attack'] ?? 0;
  if (attacks > 0) {
    smash(s, seat, attacks, events);
  }
  if (s.phase === 'over') {
    return;
  }
  afterSmash(s, events);
}

/** 攻擊：在東京內打東京外的人，在東京外打東京內的人。R-SMASH-01 ~ 04 */
function smash(s: GameState, attackerSeat: number, damage: number, events: GameEvent[]): void {
  const attacker = getMonster(s, attackerSeat);
  const targets = aliveMonsters(s).filter(
    (m) =>
      m.seat !== attackerSeat &&
      (attacker.location === null ? m.location !== null : m.location === null),
  );
  if (targets.length === 0) {
    return; // 實際沒有傷害就不算攻擊。R-SMASH-06
  }
  events.push({
    type: 'smash',
    attacker: attackerSeat,
    damage,
    targets: targets.map((t) => t.seat),
  });

  for (const target of targets) {
    const amount = Math.min(target.hp, damage);
    target.hp -= amount;
    events.push({
      type: 'damage_taken',
      seat: target.seat,
      amount,
      hp: target.hp,
      source: attackerSeat,
    });
    if (target.hp === 0) {
      // R-SMASH-04：淘汰時 keep 卡與能量被捨棄，離開東京
      target.alive = false;
      target.location = null;
      target.energy = 0;
      target.cards = [];
      events.push({ type: 'eliminated', seat: target.seat, by: attackerSeat });
    }
  }

  const alive = aliveMonsters(s);
  if (alive.length <= 1) {
    endGame(
      s,
      alive.map((m) => m.seat),
      alive.length === 0 ? 'allEliminated' : 'lastStanding',
      events,
    ); // R-END-01、R-END-06
  }
}

// ── 讓位與進入東京 ───────────────────────────────────────────

/** 攻擊後：若攻擊者在東京外，依序詢問東京內存活的怪獸是否讓位。R-TOKYO-04/05 */
function afterSmash(s: GameState, events: GameEvent[]): void {
  const attacker = getMonster(s, s.turn.seat);
  if (attacker.location === null) {
    const n = s.config.playerCount;
    const queue: number[] = [];
    for (let i = 1; i < n; i += 1) {
      const seat = (attacker.seat + i) % n; // 從攻擊者的下一位順時針
      const m = getMonster(s, seat);
      // 這次攻擊的對象就是所有在東京的存活怪獸
      if (m.alive && m.location !== null) {
        queue.push(seat);
      }
    }
    if (queue.length > 0 && attackLanded(events)) {
      s.pending = { attacker: attacker.seat, queue };
      s.phase = 'yield';
      events.push({ type: 'yield_requested', seat: queue[0] as number, attacker: attacker.seat });
      return;
    }
  }
  enterTokyoAndEndTurn(s, events);
}

/** 本次結算是否真的有攻擊命中（用事件判斷，避免重複計算）。 */
function attackLanded(events: readonly GameEvent[]): boolean {
  return events.some((e) => e.type === 'smash');
}

function decideYield(s: GameState, leave: boolean, events: GameEvent[]): void {
  const pending = s.pending;
  if (!pending) {
    return;
  }
  const seat = pending.queue.shift() as number;
  const m = getMonster(s, seat);
  if (leave && m.location !== null) {
    events.push({ type: 'yielded', seat, location: m.location });
    m.location = null;
  } else {
    events.push({ type: 'stayed', seat });
  }
  const nextSeat = pending.queue[0];
  if (nextSeat !== undefined) {
    events.push({ type: 'yield_requested', seat: nextSeat, attacker: pending.attacker });
    return;
  }
  s.pending = null;
  s.phase = 'roll';
  enterTokyoAndEndTurn(s, events);
}

function enterTokyoAndEndTurn(s: GameState, events: GameEvent[]): void {
  enterTokyo(s, events);
  closeBayIfNeeded(s, events);
  endTurn(s, events);
}

/** 進入東京步驟（必須進入）。R-TOKYO-01/02/03/06/07 */
function enterTokyo(s: GameState, events: GameEvent[]): void {
  const me = getMonster(s, s.turn.seat);
  if (!me.alive || me.location !== null) {
    return;
  }
  let location: 'city' | 'bay' | null = null;
  if (!occupantOf(s, 'city')) {
    location = 'city';
  } else if (isBayOpen(s) && !occupantOf(s, 'bay')) {
    location = 'bay';
  }
  if (location) {
    me.location = location;
    events.push({ type: 'entered_tokyo', seat: me.seat, location });
    gainVp(s, me.seat, 1, 'enter_tokyo', events);
  }
}

/** 存活 ≤4 時東京灣關閉；灣內怪獸離開，東京市若空著就移過去（不得 VP）。R-TOKYO-09 */
function closeBayIfNeeded(s: GameState, events: GameEvent[]): void {
  if (isBayOpen(s)) {
    return;
  }
  const inBay = occupantOf(s, 'bay');
  if (!inBay) {
    return;
  }
  if (!occupantOf(s, 'city')) {
    inBay.location = 'city';
    events.push({ type: 'bay_closed', seat: inBay.seat, movedTo: 'city' });
  } else {
    inBay.location = null;
    events.push({ type: 'bay_closed', seat: inBay.seat, movedTo: null });
  }
}

// ── 回合結束與勝負 ──────────────────────────────────────────

function endGame(s: GameState, winners: number[], reason: WinReason, events: GameEvent[]): void {
  s.outcome = { winners: [...winners].sort((a, b) => a - b), reason };
  s.phase = 'over';
  s.pending = null;
  events.push({ type: 'game_over', winners: [...s.outcome.winners], reason });
}

function endTurn(s: GameState, events: GameEvent[]): void {
  const current = s.turn.seat;
  events.push({ type: 'turn_ended', seat: current });

  const next = nextAliveSeat(s, current);
  // R-END-08：下一位在一輪中的位置不大於目前這位，表示繞回先手，一輪結束
  const roundEnds = roundPosition(s, next) <= roundPosition(s, current);
  if (roundEnds) {
    events.push({ type: 'round_ended', round: s.round });
  }

  const goal = s.config.victoryPoints;
  if (roundEnds) {
    // R-END-03、R-END-04：一輪結束時以所有 VP ≥ 目標的存活怪獸決勝
    const winners = aliveMonsters(s).filter((m) => m.vp >= goal);
    if (winners.length > 0) {
      endGame(s, pickWinners(winners), 'roundEnd', events);
      return;
    }
  } else {
    const me = getMonster(s, current);
    if (me.alive && me.vp >= goal) {
      endGame(s, [current], 'turnEnd', events); // R-END-02
      return;
    }
  }

  if (roundEnds) {
    s.round += 1;
  }
  startTurn(s, next, events);
}

function startTurn(s: GameState, seat: number, events: GameEvent[]): void {
  s.turn = { seat, rollsUsed: 0, dice: [] };
  s.phase = 'roll';
  events.push({ type: 'turn_started', seat, round: s.round });
  if (getMonster(s, seat).location !== null) {
    gainVp(s, seat, 2, 'tokyo_start', events); // R-TURN-02
  }
}
