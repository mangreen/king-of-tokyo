/**
 * 直連工作階段：一位客人與房主之間「中繼 → 直連」的無縫切換。
 *
 * 順序保證：送出者在直連通道開啟後，先在**中繼**送一個 switch 標記，之後的訊息都走直連。
 * 接收者在收到標記前，把從直連收到的訊息先暫存；收到標記（代表之前走中繼的訊息都已經到齊）
 * 再依序放行。兩個方向各自獨立切換，所以任何一個時間點，訊息都不會遺失、重複或亂序。
 *
 * 直連中途斷掉時，沒辦法知道哪些訊息遺失，所以交給擁有者當作「連線中斷」處理（重新走中繼加入、
 * 重新握手，沿用既有的 token 接回座位），而不是在這裡悄悄補。
 */
import type { Scheduler } from '../scheduler.js';
import type { RtcSignal, WireRtc, WireSwitch } from '../local/protocol.js';
import { FrameAssembler, FrameEncoder, FrameError } from './frames.js';
import type { DirectConnector, DirectPeer, DirectRole } from './types.js';

/** 通道開啟前最多暫存幾則「早到」的直連訊息（對方不可信）。 */
const MAX_EARLY_MESSAGES = 256;

export interface DirectSessionOptions<Out, In> {
  role: DirectRole;
  /** null＝不嘗試直連（純中繼，行為和 M6 相同）。 */
  connector: DirectConnector | null;
  scheduler: Scheduler;
  /** 多久內沒連上就放棄直連，繼續走中繼。 */
  connectTimeoutMs: number;
  /** 經中繼送出：遊戲訊息、協商資料或切換標記。 */
  sendRelay(message: Out | WireRtc | WireSwitch): void;
  /** 把（驗證過的）對方訊息交給遊戲層。 */
  deliver(message: In): void;
  /** 驗證從直連收到的 JSON；不合法回傳 null（會中斷直連）。 */
  parse(value: unknown): In | null;
  /** 兩個方向都已切到直連。 */
  onSwitched?(): void;
  /** 已開啟的直連中斷了：遺失的訊息無從得知，請擁有者重建連線。 */
  onLost?(): void;
}

export class DirectSession<Out, In> {
  private peer: DirectPeer | null = null;
  private readonly encoder = new FrameEncoder();
  private readonly assembler = new FrameAssembler();
  private early: In[] = [];
  private cancelTimer: () => void = () => undefined;
  private channelOpen = false;
  private sentSwitch = false;
  private recvSwitch = false;
  private notified = false;
  /** 已結束（失敗、中斷或手動關閉）：不再嘗試直連。 */
  private ended = false;

  constructor(private readonly options: DirectSessionOptions<Out, In>) {}

  /** 通道已開啟，且兩個方向都已切到直連。 */
  get isDirect(): boolean {
    return this.channelOpen && this.sentSwitch && this.recvSwitch && !this.ended;
  }

  /** 通道已開啟（不論是否已完成雙向切換）。 */
  get isOpen(): boolean {
    return this.channelOpen && !this.ended;
  }

  /** 房主端：開始建立直連（客人端等 offer）。 */
  start(): void {
    if (this.options.role === 'host') this.ensurePeer();
  }

  /** 送出遊戲訊息：已切換就走直連，否則走中繼。 */
  send(message: Out): void {
    if (!this.sentSwitch) {
      this.options.sendRelay(message);
      return;
    }
    if (!this.channelOpen || this.ended) return; // 已中斷：擁有者會重建連線，這則本來就會被丟掉
    for (const frame of this.encoder.encode(JSON.stringify(message))) this.peer?.send(frame);
  }

  /** 從中繼收到的遊戲訊息。 */
  receive(message: In): void {
    this.options.deliver(message);
  }

  /** 從中繼收到控制訊息（協商資料、切換標記）。 */
  receiveControl(message: WireRtc | WireSwitch): void {
    if (message.t === 'switch') {
      this.recvSwitch = true;
      const queued = this.early;
      this.early = [];
      for (const item of queued) this.options.deliver(item);
      this.maybeSwitched();
      return;
    }
    this.onSignal(message.d);
  }

  close(): void {
    this.ended = true;
    this.early = [];
    this.cancelTimer();
    const peer = this.peer;
    this.peer = null;
    peer?.close();
  }

  // ── 內部 ──────────────────────────────────────────

  private onSignal(data: RtcSignal): void {
    if (this.ended || this.options.connector === null) return;
    // 客人端：第一個 offer 才建立對等端（重連後房主會送新的 offer，由新的工作階段處理）
    if (this.options.role === 'guest' && this.peer === null) {
      if (data.k !== 'desc' || data.type !== 'offer') return;
      this.ensurePeer();
    }
    this.peer?.signal(data);
  }

  private ensurePeer(): void {
    const { connector, scheduler, connectTimeoutMs } = this.options;
    if (connector === null || this.peer !== null || this.ended) return;
    this.cancelTimer = scheduler.after(connectTimeoutMs, () => {
      if (!this.channelOpen) this.fail();
    });
    this.peer = connector(this.options.role, {
      signal: (data) => {
        if (!this.ended) this.options.sendRelay({ t: 'rtc', d: data });
      },
      open: () => {
        if (this.ended || this.channelOpen) return;
        this.channelOpen = true;
        this.cancelTimer();
        // 先在舊路徑宣告「之後走直連」，再切換
        this.options.sendRelay({ t: 'switch' });
        this.sentSwitch = true;
        this.maybeSwitched();
      },
      message: (frame) => {
        this.onFrame(frame);
      },
      close: () => {
        if (this.ended) return;
        if (this.channelOpen) this.lost();
        else this.fail();
      },
    });
  }

  private onFrame(frame: string): void {
    if (this.ended) return;
    let message: In | null;
    try {
      const text = this.assembler.push(frame);
      if (text === null) return;
      message = this.options.parse(JSON.parse(text) as unknown);
    } catch (error) {
      if (error instanceof FrameError || error instanceof SyntaxError) message = null;
      else throw error;
    }
    if (message === null) {
      // 對方送了不合法的資料：中斷直連，不信任
      this.lost();
      return;
    }
    if (!this.recvSwitch) {
      if (this.early.length >= MAX_EARLY_MESSAGES) {
        this.lost();
        return;
      }
      this.early.push(message);
      return;
    }
    this.options.deliver(message);
  }

  private maybeSwitched(): void {
    if (this.notified || !this.isDirect) return;
    this.notified = true;
    this.options.onSwitched?.();
  }

  /** 沒連上（逾時或建立失敗）：放棄直連，繼續走中繼。 */
  private fail(): void {
    this.ended = true;
    this.cancelTimer();
    this.peer?.close();
    this.peer = null;
  }

  /** 已開啟的直連中斷。 */
  private lost(): void {
    const wasOpen = this.channelOpen;
    this.close();
    if (wasOpen) this.options.onLost?.();
  }
}
