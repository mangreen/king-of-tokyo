/**
 * 房主橋接：把「中繼伺服器上的客人」接成本機閘道的連線。
 * 房主的瀏覽器（Worker）跑完整的房間與規則；每位客人在這裡看起來就是一條 GatewayConn，
 * 與離線模式的本機連線沒有差別——所以握手、身分（token 由房主簽發）、限流、代管全部沿用。
 *
 * 直連（M7）：客人加入後，房主另外嘗試和他建立 WebRTC 直連；成功就把這位客人的訊息改走直連
 * （見 direct/session.ts）。所有客人都走直連、且對局進行中時，房主可以「停泊」：
 * 關掉自己的中繼連線，只留房號登記，不再佔伺服器的連線。任何人的直連中斷就立刻回到中繼。
 */
import {
  EVENTS,
  RELAY_EVENTS,
  RELAY_PROTOCOL_VERSION,
  type RelayClosedReason,
  type RelayErrorCode,
  type RelayHostOpenAck,
  type RelayParkAck,
  type RelaySimpleAck,
  type RelayTakeoverAck,
} from '@kot/protocol';
import type { DirectConnector } from '../direct/types.js';
import { DirectSession } from '../direct/session.js';
import { ReplicaSender, type ReplicaSync } from '../failover/sync.js';
import { rankCandidates, SuccessionPlanner, type Candidate } from '../failover/succession.js';
import type { LocalHost } from '../local/host.js';
import {
  parseWireToHost,
  type ToClient,
  type ToHost,
  type WireReplica,
  type WireReplicaNeed,
  type WireRtc,
  type WireSwitch,
} from '../local/protocol.js';
import { randomHex } from '../random.js';
import type { RoomReplica } from '../replica.js';
import { realScheduler, type Scheduler } from '../scheduler.js';
import type { RelaySocket } from './socket.js';

export type BridgeStatus =
  /** 與中繼伺服器的連線中斷，等待自動重連。 */
  | { state: 'offline' }
  | { state: 'online'; code: string }
  /** 房間已被中繼關閉（閒置、房號逾時等），無法接回。 */
  | { state: 'closed'; reason: RelayClosedReason | RelayErrorCode };

/** 房主看到的連線方式摘要（給畫面顯示用）。 */
export interface HostPathInfo {
  /** 走直連的客人數。 */
  direct: number;
  /** 走中繼的客人數。 */
  relay: number;
  /** 中繼連線已停泊（房主沒有佔用伺服器連線）。 */
  parked: boolean;
}

export interface HostBridgeOptions {
  /** 提供就會嘗試與每位客人建立直連。 */
  direct?: DirectConnector;
  scheduler?: Scheduler;
  /** 現在可以停泊嗎（對局進行中、所有真人都連著）？沒提供就永遠不停泊。 */
  canPark?: () => boolean;
  /** 多久內沒連上直連就放棄（毫秒）。 */
  directTimeoutMs?: number;
  /** 停泊期間每隔多久回伺服器刷新一次房號期限（毫秒，必須小於伺服器的停泊期限）。 */
  parkRefreshMs?: number;
  /**
   * 目前房間的複本（M9）。提供就會把複本增量送給每位真人客人（後備房主）並向伺服器登記後備順序。
   * 回傳的 epoch 會被覆寫成橋接端知道的世代。
   */
  replica?: () => RoomReplica | null;
  /** 後備房主的接手金鑰（沿用重新整理前的存檔；沒有就由橋接端新產生）。 */
  takeoverKeys?: Record<string, string>;
  randomHex?: (bytes: number) => string;
}

/** 接手的結果（成為新房主）。retryInMs：太早，伺服器建議多久後再試。 */
export type TakeoverResult =
  | { ok: true; epoch: number }
  | { ok: false; reason: RelayErrorCode | 'unreachable'; retryInMs?: number };

/** 15 秒：區網／一般 NAT 通常幾秒內就連上；要靠 TURN 才通的我們沒有提供，放棄就走中繼。 */
export const DIRECT_TIMEOUT_MS = 15_000;
/** 伺服器的停泊期限是 15 分鐘；這裡 6 分鐘刷新一次，留足背景分頁計時器被延後的餘裕。 */
export const PARK_REFRESH_MS = 6 * 60_000;

interface GuestEntry {
  receive: (message: ToHost) => void;
  session: DirectSession<ToClient | WireReplica, ToHost | WireReplicaNeed>;
  /** 握手後才知道這位客人是哪個玩家。 */
  playerId: string | null;
  /** 加入的先後（後備順序用）。 */
  serial: number;
  sender: ReplicaSender;
}

export class HostBridge {
  private creds: { code: string; hostKey: string } | null = null;
  /** 從存檔接回（房主重新整理）：伺服器沒有這個房號時，用房號與金鑰重新登記。 */
  private adopted = false;
  private readonly guests = new Map<string, GuestEntry>();
  private opening: Promise<string> | null = null;
  private done = false;
  private statusHandlers: ((status: BridgeStatus) => void)[] = [];
  /** 已停泊（中繼連線是刻意關掉的）。 */
  private parked = false;
  /** 正在跟伺服器談停泊，或正在從停泊回來。 */
  private transitioning = false;
  private cancelRefresh: () => void = () => undefined;
  private readonly scheduler: Scheduler;
  private pathHandlers: ((info: HostPathInfo) => void)[] = [];
  private lastPath = '';
  /** 房主世代：房主轉移時由伺服器遞增。 */
  private epochValue = 0;
  private readonly planner: SuccessionPlanner;
  /** 已向伺服器登記（或正在登記）的後備順序（JSON）；空字串＝還沒登記。 */
  private registeredOrder = '';
  private guestSerial = 0;
  private handoverWaiter: ((ok: boolean) => void) | null = null;

  constructor(
    private readonly local: LocalHost,
    private readonly socket: RelaySocket,
    private readonly options: HostBridgeOptions = {},
  ) {
    this.scheduler = options.scheduler ?? realScheduler;
    this.planner = new SuccessionPlanner(options.randomHex ?? randomHex, options.takeoverKeys);
    socket.onEvent(RELAY_EVENTS.guestJoined, (payload) => {
      const guestId = readGuestId(payload);
      if (guestId !== null) this.attachGuest(guestId);
    });
    socket.onEvent(RELAY_EVENTS.guestLeft, (payload) => {
      const guestId = readGuestId(payload);
      if (guestId === null) return;
      // 客人改走直連後會自己關掉中繼連線：這時不能當作他離開
      if (this.guests.get(guestId)?.session.isDirect) {
        // 中繼上少了一位客人：也許現在可以停泊了（之前可能因為中繼上還有他而被伺服器拒絕）
        this.evaluate();
        return;
      }
      this.detachGuest(guestId);
    });
    socket.onEvent(RELAY_EVENTS.fromGuest, (payload) => {
      if (typeof payload !== 'object' || payload === null) return;
      const { guestId, data } = payload as { guestId?: unknown; data?: unknown };
      if (typeof guestId !== 'string') return;
      const entry = this.guests.get(guestId);
      if (!entry) return;
      const message = parseWireToHost(data); // 客人不可信：格式不對的信封直接丟掉
      if (message === null) return;
      if (message.t === 'rtc' || message.t === 'switch') {
        entry.session.receiveControl(message as WireRtc | WireSwitch);
      } else {
        entry.session.receive(message);
        this.evaluate();
      }
    });
    socket.onEvent(RELAY_EVENTS.closed, (payload) => {
      const reason = (payload as { reason?: RelayClosedReason } | null)?.reason ?? 'room_closed';
      if (reason === 'superseded') this.handoverWaiter?.(true);
      this.finish({ state: 'closed', reason });
    });
    socket.onDisconnect(() => {
      if (this.done || this.parked) return;
      this.emitStatus({ state: 'offline' });
    });
    socket.onConnect(() => {
      // 自動重連（或從停泊回來）後，用房號＋金鑰接回同一個房間
      if (this.creds) this.resume(this.creds);
    });
  }

  get code(): string | null {
    return this.creds?.code ?? null;
  }

  /** 中繼房號與房主金鑰（登記成功後才有；存檔用）。 */
  get credentials(): { code: string; hostKey: string } | null {
    return this.creds;
  }

  /** 房主世代（伺服器記錄；房主轉移時遞增）。 */
  get epoch(): number {
    return this.epochValue;
  }

  /** 載入重新整理前存下的接手金鑰（後備手上的金鑰才不會失效）。 */
  loadTakeoverKeys(keys: Readonly<Record<string, string>>): void {
    this.planner.load(keys);
  }

  /** 後備房主的接手金鑰（存檔用）。 */
  get takeoverKeys(): Record<string, string> {
    return this.planner.exportKeys();
  }

  /**
   * 房主重新整理後從存檔接回：用原本的房號與金鑰向中繼登記（伺服器若已忘記這個房號就重新登記）。
   * 不等待結果：房主自己的頁面不依賴中繼；結果會經 onStatus 回報（online／closed）。
   */
  adopt(creds: { code: string; hostKey: string; epoch?: number }): void {
    this.creds = { code: creds.code, hostKey: creds.hostKey };
    this.epochValue = creds.epoch ?? 0;
    this.adopted = true;
    this.transitioning = true;
    if (this.socket.connected) this.resume(this.creds);
    else this.socket.connect?.(); // 連上後 onConnect 會接回
  }

  /**
   * 以後備房主的身分接手一個房間：向伺服器出示接手金鑰，成功就成為新房主（拿到新的房主金鑰與世代）。
   * 呼叫前要先把複本還原到本機主機。時間未到時回 retryInMs，由呼叫端排程重試。
   */
  takeover(code: string, key: string): Promise<TakeoverResult> {
    return new Promise<TakeoverResult>((resolve) => {
      const send = (): void => {
        this.socket.emit(
          RELAY_EVENTS.takeover,
          { relayVersion: RELAY_PROTOCOL_VERSION, code, key },
          (result) => {
            const ack = result as RelayTakeoverAck;
            if (!ack.ok) {
              resolve({
                ok: false,
                reason: ack.code,
                ...(ack.retryInMs === undefined ? {} : { retryInMs: ack.retryInMs }),
              });
              return;
            }
            this.creds = { code: ack.code, hostKey: ack.hostKey };
            this.epochValue = ack.epoch;
            this.adopted = true;
            this.registeredOrder = '';
            this.emitStatus({ state: 'online', code: ack.code });
            resolve({ ok: true, epoch: ack.epoch });
            this.pushReplicas();
          },
        );
      };
      if (this.socket.connected) send();
      else {
        this.socket.connect?.();
        let sent = false;
        this.socket.onConnect(() => {
          if (!sent) {
            sent = true;
            send();
          }
        });
        this.socket.onConnectError(() => {
          if (!sent) {
            sent = true;
            resolve({ ok: false, reason: 'unreachable' });
          }
        });
      }
    });
  }

  /**
   * 計畫性交接（M9）：把房間交給某位後備。呼叫端要先讓房間停止提交（凍結）。
   * 先把最新複本推給對方、向伺服器登記「指定這位」，再通知對方立刻接手；伺服器在對方接手的瞬間
   * 取代我們的連線，之後狀態變成 closed(superseded)。逾時沒人接手就回傳失敗，呼叫端可以解凍繼續。
   */
  async handover(
    playerId: string,
    timeoutMs = 20_000,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const entry = [...this.guests.values()].find((g) => g.playerId === playerId);
    if (!entry || this.creds === null) return { ok: false, reason: '對方不在線上' };
    if (this.parked) {
      this.unpark();
      return { ok: false, reason: '連線方式切換中，請稍後再試' };
    }
    if (!this.socket.connected) return { ok: false, reason: '與伺服器的連線中斷' };
    this.pushReplicas(); // 對方的複本先追到最新（同一條連線上依序到達）
    const replica = this.currentReplica();
    if (!replica) return { ok: false, reason: '沒有可交接的房間' };
    const { actions, ...meta } = replica;
    const offer: ReplicaSync = {
      epoch: replica.epoch,
      meta,
      from: actions.length,
      actions: [],
      key: this.planner.keyOf(playerId),
      order: this.currentOrder(replica),
      handover: true,
    };
    const registered = await this.ask<RelaySimpleAck>(RELAY_EVENTS.handover, {
      target: this.planner.hashes([playerId])[0] as string,
    });
    if (!registered.ok) return { ok: false, reason: registered.code };
    return new Promise((resolve) => {
      const cancel = this.scheduler.after(timeoutMs, () => {
        this.handoverWaiter = null;
        resolve({ ok: false, reason: '對方沒有接手' });
      });
      this.handoverWaiter = (ok) => {
        cancel();
        this.handoverWaiter = null;
        resolve(ok ? { ok: true } : { ok: false, reason: '交接失敗' });
      };
      entry.session.send({ t: 'replica', d: offer });
    });
  }

  private ask<T>(event: string, payload: unknown): Promise<T> {
    return new Promise<T>((resolve) => {
      this.socket.emit(event, payload, (result) => {
        resolve(result as T);
      });
    });
  }

  /** 已停泊（測試與除錯用）。 */
  get isParked(): boolean {
    return this.parked;
  }

  /** 目前直連中的客人數（測試與除錯用）。 */
  get directCount(): number {
    let n = 0;
    for (const entry of this.guests.values()) if (entry.session.isDirect) n += 1;
    return n;
  }

  onStatus(handler: (status: BridgeStatus) => void): void {
    this.statusHandlers.push(handler);
  }

  /** 連線方式（直連／中繼人數、是否停泊）改變時通知；也會在訂閱時立即送一次目前狀態。 */
  onPath(handler: (info: HostPathInfo) => void): void {
    this.pathHandlers.push(handler);
    handler(this.pathInfo());
  }

  private pathInfo(): HostPathInfo {
    const direct = this.directCount;
    return { direct, relay: this.guests.size - direct, parked: this.parked };
  }

  private notifyPath(): void {
    const info = this.pathInfo();
    const key = `${String(info.direct)}/${String(info.relay)}/${String(info.parked)}`;
    if (key === this.lastPath) return;
    this.lastPath = key;
    for (const handler of this.pathHandlers) handler(info);
  }

  /** 向中繼伺服器登記房間（只做一次，之後回傳同一個房號）。失敗時 reject，錯誤碼在 message。 */
  open(): Promise<string> {
    if (this.creds) return Promise.resolve(this.creds.code);
    this.opening ??= new Promise<string>((resolve, reject) => {
      const send = (): void => {
        this.socket.emit(
          RELAY_EVENTS.hostOpen,
          { relayVersion: RELAY_PROTOCOL_VERSION },
          (result) => {
            const ack = result as RelayHostOpenAck;
            if (ack.ok) {
              this.creds = { code: ack.code, hostKey: ack.hostKey };
              this.epochValue = ack.epoch;
              this.emitStatus({ state: 'online', code: ack.code });
              resolve(ack.code);
            } else {
              this.opening = null;
              reject(new Error(ack.code));
            }
          },
        );
      };
      if (this.socket.connected) send();
      else {
        this.socket.connect?.();
        let sent = false;
        this.socket.onConnect(() => {
          if (!sent) {
            sent = true;
            send();
          }
        });
        this.socket.onConnectError(() => {
          if (!sent) {
            sent = true;
            this.opening = null;
            reject(new Error('unreachable'));
          }
        });
      }
    });
    return this.opening;
  }

  /** 重新評估要不要停泊（對局開始、有人離線等狀態改變時呼叫；很便宜）。 */
  evaluate(): void {
    if (this.done || this.transitioning || this.creds === null) return;
    const wantPark = this.shouldPark();
    if (wantPark && !this.parked) this.park();
    else if (!wantPark && this.parked) this.unpark();
  }

  /** 關閉：中斷中繼連線（伺服器會通知客人房主離開）。 */
  close(): void {
    this.done = true;
    this.cancelRefresh();
    for (const guestId of [...this.guests.keys()]) this.detachGuest(guestId);
    this.socket.disconnect();
  }

  // ── 停泊 ──────────────────────────────────────────

  private shouldPark(): boolean {
    const { canPark } = this.options;
    if (!canPark || !this.socket.pause || !this.socket.connect) return false;
    for (const entry of this.guests.values()) if (!entry.session.isDirect) return false;
    return canPark();
  }

  private park(): void {
    if (!this.socket.connected) return;
    this.transitioning = true;
    this.socket.emit(RELAY_EVENTS.park, {}, (result) => {
      this.transitioning = false;
      if (this.done || !(result as RelayParkAck).ok) return; // 中繼上還有客人：維持原狀
      this.parked = true;
      this.notifyPath();
      this.socket.pause?.();
      this.cancelRefresh();
      this.cancelRefresh = this.scheduler.after(
        this.options.parkRefreshMs ?? PARK_REFRESH_MS,
        () => {
          this.unpark();
        },
      );
    });
  }

  /** 回到中繼（有人直連中斷、對局結束，或定時刷新房號期限）。接回成功後會再評估是否重新停泊。 */
  private unpark(): void {
    if (!this.parked) return;
    this.cancelRefresh();
    this.parked = false;
    this.notifyPath();
    this.transitioning = true; // 接回完成（resume 的 ack）之前不要再評估
    this.socket.connect?.();
  }

  // ── 內部 ──────────────────────────────────────────

  private resume(creds: { code: string; hostKey: string }, restore = false): void {
    this.socket.emit(
      RELAY_EVENTS.hostOpen,
      {
        relayVersion: RELAY_PROTOCOL_VERSION,
        code: creds.code,
        hostKey: creds.hostKey,
        ...(restore ? { restore: true, epoch: this.epochValue } : {}),
      },
      (result) => {
        const ack = result as RelayHostOpenAck;
        if (
          !ack.ok &&
          ack.code === 'room_not_found' &&
          !restore &&
          (this.guests.size > 0 || this.adopted)
        ) {
          // 伺服器重啟、登記遺失，但還有客人經直連在玩：用原本的房號與金鑰重新登記，對局不中斷
          this.resume(creds, true);
          return;
        }
        this.transitioning = false;
        if (ack.ok) {
          this.epochValue = ack.epoch;
          this.registeredOrder = ''; // 伺服器可能忘了（重啟、接回）：重新登記後備順序
          this.emitStatus({ state: 'online', code: ack.code });
          this.evaluate();
          this.pushReplicas();
        } else this.finish({ state: 'closed', reason: ack.code });
      },
    );
  }

  // ── 複本與後備順序（M9）────────────────────────────

  private currentReplica(): RoomReplica | null {
    const replica = this.options.replica?.();
    return replica ? { ...replica, epoch: this.epochValue } : null;
  }

  /** 目前的後備順序：已握手、仍在房間裡的真人客人，直連優先。 */
  private currentOrder(replica: RoomReplica): string[] {
    // 房主自己的頁面不是中繼客人，不會出現在 guests；「遊戲裡的房主座位」（hostId）則可能是
    // 交接後降級回來的原房主，他也是合格的後備，所以不能用 hostId 排除
    const humans = new Set(replica.members.filter((m) => !m.bot && !m.left).map((m) => m.id));
    const candidates: Candidate[] = [];
    for (const entry of this.guests.values()) {
      if (entry.playerId === null || !humans.has(entry.playerId)) continue;
      candidates.push({
        playerId: entry.playerId,
        direct: entry.session.isDirect,
        serial: entry.serial,
      });
    }
    return rankCandidates(candidates);
  }

  /** 把複本的變化送給每位後備，並在順序改變時向伺服器登記。房間每次改變、連線方式改變時呼叫（很便宜）。 */
  pushReplicas(): void {
    if (this.done || this.creds === null) return;
    const replica = this.currentReplica();
    if (!replica) return;
    const order = this.currentOrder(replica);
    this.registerSuccession(order);
    for (const entry of this.guests.values()) {
      if (entry.playerId === null || !order.includes(entry.playerId)) continue;
      const key = this.planner.keyOf(entry.playerId);
      for (const d of entry.sender.messages(replica, key, order)) {
        entry.session.send({ t: 'replica', d });
      }
    }
  }

  private registerSuccession(order: readonly string[]): void {
    const hashes = this.planner.hashes(order);
    const json = JSON.stringify(hashes);
    if (json === this.registeredOrder || !this.socket.connected || this.transitioning) return;
    this.registeredOrder = json;
    this.socket.emit(RELAY_EVENTS.succession, { order: hashes }, (result) => {
      // 登記失敗（例如已不是房主）：下次再試
      if (!(result as RelaySimpleAck).ok) this.registeredOrder = '';
    });
  }

  /** 客人進來（或房主接回後被重新告知）：換一條全新的閘道連線，客人會收到 open 並重新握手。 */
  private attachGuest(guestId: string): void {
    this.detachGuest(guestId);
    const relayEmit = (data: unknown): void => {
      this.socket.emit(RELAY_EVENTS.toGuest, { guestId, data });
    };
    const session: DirectSession<ToClient | WireReplica, ToHost | WireReplicaNeed> =
      new DirectSession<ToClient | WireReplica, ToHost | WireReplicaNeed>({
        role: 'host',
        connector: this.options.direct ?? null,
        scheduler: this.scheduler,
        connectTimeoutMs: this.options.directTimeoutMs ?? DIRECT_TIMEOUT_MS,
        // 協商資料與切換標記只在中繼還連著時有意義；斷線期間不要讓 socket.io 把它們緩存起來重送
        sendRelay: (message) => {
          if (message.t === 'rtc' || message.t === 'switch') {
            if (this.socket.connected) relayEmit(message);
          } else relayEmit(message);
        },
        deliver: (message) => {
          const entry = this.guests.get(guestId);
          if (!entry) return;
          if (message.t === 'replica-need') {
            // 後備說他漏了訊息：從頭重送
            entry.sender.reset();
            this.pushReplicas();
            return;
          }
          entry.receive(message);
        },
        parse: (value) => {
          const parsed = parseWireToHost(value);
          // 協商與切換標記只走中繼
          return parsed === null || parsed.t === 'rtc' || parsed.t === 'switch' ? null : parsed;
        },
        onSwitched: () => {
          this.notifyPath();
          this.evaluate();
        },
        onLost: () => {
          // 直連中斷：遺失了哪些訊息無從得知，當作這位客人斷線；他會經中繼重新加入並接回座位
          this.detachGuest(guestId); // 會通知連線方式
          if (this.parked) this.unpark();
          else this.evaluate();
        },
      });
    const send = (message: ToClient): void => {
      session.send(message);
      if (message.t === 'emit' && message.event === EVENTS.serverHello) {
        // 握手完成：知道這位客人是哪個玩家了，他可以開始收複本
        const entry = this.guests.get(guestId);
        const id = (message.payload as { playerId?: unknown } | null)?.playerId;
        if (entry && typeof id === 'string') {
          entry.playerId = id;
          entry.sender.reset();
          this.pushReplicas();
        }
      }
      if (message.t === 'closed') {
        // 閘道主動中斷這條連線（握手逾時、被取代等）：關掉直連，並請伺服器也把客人踢出中繼
        this.guests.delete(guestId);
        if (this.socket.connected) this.socket.emit(RELAY_EVENTS.kick, { guestId });
        session.close();
      }
    };
    this.guestSerial += 1;
    this.guests.set(guestId, {
      receive: this.local.connect(send),
      session,
      playerId: null,
      serial: this.guestSerial,
      sender: new ReplicaSender(),
    });
    session.start();
    this.notifyPath();
  }

  private detachGuest(guestId: string): void {
    const entry = this.guests.get(guestId);
    if (!entry) return;
    this.guests.delete(guestId);
    entry.session.close();
    entry.receive({ t: 'close' });
    this.notifyPath();
  }

  private finish(status: BridgeStatus): void {
    if (this.done) return;
    this.done = true;
    this.cancelRefresh();
    for (const guestId of [...this.guests.keys()]) this.detachGuest(guestId);
    this.emitStatus(status);
  }

  private emitStatus(status: BridgeStatus): void {
    for (const handler of this.statusHandlers) handler(status);
  }
}

function readGuestId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { guestId } = payload as { guestId?: unknown };
  return typeof guestId === 'string' && guestId.length > 0 && guestId.length <= 40 ? guestId : null;
}
