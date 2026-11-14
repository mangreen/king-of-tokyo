/**
 * 後備房主（M9）：每位真人客人都是後備。房主不見時，依自己在順序中的名次排隊，
 * 輪到時向中繼出示接手金鑰；成功就把手上的複本變成房間，成為新房主。
 *
 * 時序（伺服器才是裁判，這裡只是不要太早去敲門）：
 *   第 k 順位（k 從 1 起）在房主消失後 graceMs + (k-1) × staggerMs 才出手。
 *   太早（too_early）就依伺服器給的 retryInMs 再試；房主回來（host_online）、
 *   前面的後備已經接手（superseded／我們收到 back）、或金鑰無效（bad_takeover）就停手。
 *
 * 這個類別只管「何時、是否」嘗試；怎麼建出房主由 create() 提供（測試與網頁各自注入）。
 */
import type { RoomReplica } from '../replica.js';
import type { TakeoverResult } from '../relay/hostBridge.js';
import type { Scheduler } from '../scheduler.js';
import { ReplicaMirror, type ReplicaSync } from './sync.js';

/** 一次接手嘗試用到的新房主（RelayedHost 的子集，方便測試）。 */
export type PrepareResult = { ok: true } | { ok: false; reason: string };

export interface TakeoverTarget {
  /** 把複本還原到本機主機（一次）。網頁的房主在 Worker 裡，所以可以是非同步。 */
  prepare(replica: RoomReplica): PrepareResult | Promise<PrepareResult>;
  takeover(code: string, key: string): Promise<TakeoverResult>;
  /** 放棄這次嘗試（沒接手成功就丟掉）。 */
  abandon(): void;
}

export type StandbyState =
  /** 房主在線上，持續收複本。 */
  | 'watching'
  /** 房主不見了，正在等輪到自己。 */
  | 'waiting'
  /** 正在向中繼出示金鑰。 */
  | 'taking-over'
  /** 已成為房主（不再動作）。 */
  | 'done'
  /** 不能或不必接手（不在順序中、金鑰失效、房間已關…），直到下次收到新的複本或房主狀態。 */
  | 'idle';

export interface StandbyOptions<T extends TakeoverTarget> {
  code: string;
  /** 我的玩家 id（握手後才知道）。 */
  playerId: () => string | undefined;
  scheduler: Scheduler;
  create: () => T;
  /** 接手成功：回傳建好、已登記的新房主。 */
  onTakeover: (target: T, epoch: number) => void;
  /** 複本有缺口時要房主重送。 */
  requestReplica: () => void;
  onState?: (state: StandbyState, rank: number | null) => void;
  graceMs?: number;
  staggerMs?: number;
  /** 連不上中繼時的重試間隔。 */
  unreachableRetryMs?: number;
}

/** 與伺服器預設一致（registry 的 SUCCESSION_GRACE_MS／SUCCESSION_STAGGER_MS）。 */
export const STANDBY_GRACE_MS = 10_000;
export const STANDBY_STAGGER_MS = 3_000;

export class Standby<T extends TakeoverTarget> {
  readonly mirror = new ReplicaMirror();
  private _state: StandbyState = 'watching';
  private lostAt: number | null = null;
  private cancelTimer: () => void = () => undefined;
  private target: T | null = null;
  private prepared = false;
  private generation = 0;
  private readonly graceMs: number;
  private readonly staggerMs: number;

  constructor(private readonly options: StandbyOptions<T>) {
    this.graceMs = options.graceMs ?? STANDBY_GRACE_MS;
    this.staggerMs = options.staggerMs ?? STANDBY_STAGGER_MS;
  }

  get state(): StandbyState {
    return this._state;
  }

  /** 我的名次（1＝第一順位）；不在順序中或還沒有金鑰時為 null。 */
  get rank(): number | null {
    const id = this.options.playerId();
    if (id === undefined || this.mirror.key === undefined) return null;
    const index = this.mirror.order.indexOf(id);
    return index < 0 ? null : index + 1;
  }

  /** 收到房主的複本同步（GuestEndpoint.onReplica 接這裡）。 */
  onReplica(sync: ReplicaSync): void {
    if (this._state === 'done') return;
    const result = this.mirror.apply(sync);
    if (result === 'gap') this.options.requestReplica();
    if (sync.handover === true && result === 'ok' && this._state !== 'taking-over') {
      // 計畫性交接：房主指定我，立刻出示金鑰（伺服器已登記，不必等寬限期）
      this.cancelTimer();
      const generation = (this.generation += 1);
      void this.attempt(generation);
      return;
    }
    // 順序或金鑰變了：排程要跟著重算
    if (this._state === 'waiting') this.schedule();
    this.notify();
  }

  /** 房主不見了或回來了（GuestEndpoint.onHostState 接這裡）。 */
  onHostState(state: 'lost' | 'back'): void {
    if (this._state === 'done') return;
    // 正在向中繼出示金鑰：結果由伺服器的回覆決定。這時看到「房主回來了」可能正是我們自己成功了
    // （伺服器先通知客人、後回覆我們），不能因此丟掉準備好的房間
    if (this._state === 'taking-over') return;
    if (state === 'back') {
      this.lostAt = null;
      this.stop('watching');
      return;
    }
    if (this.lostAt === null) this.lostAt = this.options.scheduler.now();
    this.setState('waiting');
    this.schedule();
  }

  /** 結束（端點被關掉）。 */
  dispose(): void {
    this.generation += 1;
    this.cancelTimer();
    this.target?.abandon();
    this.target = null;
    this.setState('done');
  }

  private notify(): void {
    this.options.onState?.(this._state, this.rank);
  }

  private setState(state: StandbyState): void {
    this._state = state;
    this.notify();
  }

  private stop(state: StandbyState): void {
    this.generation += 1;
    this.cancelTimer();
    this.discardTarget();
    this.setState(state);
  }

  private discardTarget(): void {
    this.target?.abandon();
    this.target = null;
    this.prepared = false;
  }

  /** 依名次算出該出手的時間點並排程。 */
  private schedule(): void {
    this.cancelTimer();
    const rank = this.rank;
    if (rank === null || this.lostAt === null) return;
    const due = this.lostAt + this.graceMs + (rank - 1) * this.staggerMs;
    const wait = Math.max(0, due - this.options.scheduler.now());
    const generation = (this.generation += 1);
    this.cancelTimer = this.options.scheduler.after(wait, () => {
      void this.attempt(generation);
    });
  }

  private retry(generation: number, ms: number): void {
    this.cancelTimer();
    this.cancelTimer = this.options.scheduler.after(Math.max(250, ms), () => {
      void this.attempt(generation);
    });
  }

  private async attempt(generation: number): Promise<void> {
    if (generation !== this.generation || this._state === 'done') return;
    const replica = this.mirror.snapshot();
    const key = this.mirror.key;
    if (replica === null || key === undefined) {
      this.setState('idle');
      return;
    }
    this.setState('taking-over');
    if (this.target === null) {
      this.target = this.options.create();
      this.prepared = false;
    }
    if (!this.prepared) {
      const prepared = await this.target.prepare(replica);
      if (generation !== this.generation) return;
      if (!prepared.ok) {
        this.stop('idle');
        return;
      }
      this.prepared = true;
    }
    const target = this.target;
    const result = await target.takeover(this.options.code, key);
    if (result.ok) {
      // 伺服器已承認我們是新房主：不論期間狀態有沒有變，都要接起這個角色（否則房間會沒有房主）
      this.generation += 1;
      this.target = null;
      this.cancelTimer();
      if (this.state !== 'done') {
        this.setState('done');
        this.options.onTakeover(target as T, result.epoch);
      } else {
        target.abandon();
      }
      return;
    }
    if (generation !== this.generation) return; // 等待期間狀態變了：這次的失敗結果作廢
    switch (result.reason) {
      case 'too_early':
        this.setState('waiting');
        this.retry(generation, result.retryInMs ?? 1_000);
        return;
      case 'unreachable':
        this.setState('waiting');
        this.retry(generation, this.options.unreachableRetryMs ?? 2_000);
        return;
      case 'host_online':
        // 房主其實還在：丟掉準備好的房間，等自己也看到房主回來（或再次失去）
        this.lostAt = null;
        this.stop('watching');
        return;
      default:
        // bad_takeover、room_not_found、superseded…：這把金鑰用不了
        this.stop('idle');
    }
  }
}
