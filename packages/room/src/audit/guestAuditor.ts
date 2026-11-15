/**
 * 客人端的稽核員（M10）：整場對局中默默記帳，局後（房主的複本顯示對局結束）交給驗證函式。
 *
 * 記什麼：
 *   - 開局前房主對我公布的承諾，以及我回送的亂數貢獻（只存在記憶體；重新整理就沒有，稽核時略過那兩項）；
 *   - 對局中房主給我的每一個畫面的摘要（見 ObservationRecorder）；
 *   - 我的玩家 id 與座位。
 * 驗證本身（重放整場）由呼叫端注入：網頁放在 Worker 裡跑，測試直接呼叫 auditGame。
 */
import type { GameState } from '@kot/rules';
import type { RoomReplica } from '../replica.js';
import type { Scheduler } from '../scheduler.js';
import { newContribution, type MyCeremonyPart } from './ceremony.js';
import { ObservationRecorder, type AuditInput, type AuditReport } from './audit.js';

export type AuditVerifier = (input: AuditInput) => AuditReport | Promise<AuditReport>;

export interface GuestAuditorOptions {
  scheduler: Scheduler;
  verify: AuditVerifier;
  /** 稽核完成（或失敗）。同一局只會通知一次，之後複本內容改變才會重新稽核。 */
  onReport: (report: AuditReport) => void;
  /** 局終複本到手後等多久再開始（讓最後的畫面也進來）。 */
  settleMs?: number;
  random?: (bytes: number) => string;
}

/** 等最後的畫面進來：複本與畫面更新幾乎同時送出，但不保證到達順序。 */
export const AUDIT_SETTLE_MS = 400;

export class GuestAuditor {
  private readonly recorder = new ObservationRecorder();
  private readonly parts = new Map<number, MyCeremonyPart>();
  private playerId: string | undefined;
  private seat: number | null = null;
  private cancelTimer: () => void = () => undefined;
  /** 已經稽核過的那一局（以種子＋世代＋動作數辨識）。 */
  private auditedKey = '';
  private generation = 0;
  private disposed = false;

  constructor(private readonly options: GuestAuditorOptions) {}

  setPlayerId(id: string): void {
    this.playerId = id;
  }

  /** 房主開始前的承諾：產生並記下我的貢獻，回傳給端點送給房主。 */
  onSeedBegin(begin: { attempt: number; commit: string }): string {
    const contribution = newContribution(this.options.random);
    this.parts.set(begin.attempt, { ...begin, contribution });
    // 只留最近幾次，避免房主不停重來把記憶體塞滿
    for (const key of [...this.parts.keys()].sort((a, b) => a - b).slice(0, -3)) {
      this.parts.delete(key);
    }
    return contribution;
  }

  /** 頁面收到的 room:state：從中得知自己的座位。 */
  onRoomState(payload: unknown): void {
    const players = (payload as { room?: { players?: unknown } | null } | null)?.room?.players;
    if (!Array.isArray(players) || this.playerId === undefined) return;
    const me = players.find((p: { id?: unknown }) => p.id === this.playerId) as
      { seat?: unknown } | undefined;
    if (me) this.seat = typeof me.seat === 'number' ? me.seat : null;
  }

  /** 頁面收到的 game:update：記下這個版本的畫面摘要。 */
  onGameUpdate(payload: unknown): void {
    const state = (payload as { state?: GameState } | null)?.state;
    if (state && typeof state.version === 'number') this.recorder.record(state);
  }

  /** 後備複本更新了（房主或接手的新房主送來）。 */
  onReplica(replica: RoomReplica | null): void {
    if (this.disposed) return;
    if (replica === null || replica.phase !== 'over') {
      // 新的一局開始或回到大廳：之前的稽核結果與等待都作廢
      this.cancelTimer();
      this.generation += 1;
      this.auditedKey = '';
      return;
    }
    const key = `${String(replica.seed)}:${String(replica.epoch)}:${String(replica.actions.length)}`;
    if (key === this.auditedKey) return;
    this.cancelTimer();
    const generation = (this.generation += 1);
    this.cancelTimer = this.options.scheduler.after(
      this.options.settleMs ?? AUDIT_SETTLE_MS,
      () => {
        void this.run(replica, key, generation);
      },
    );
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  private async run(replica: RoomReplica, key: string, generation: number): Promise<void> {
    if (generation !== this.generation || this.disposed) return;
    this.auditedKey = key;
    const ceremony = replica.ceremony;
    const mine = ceremony === undefined ? null : (this.parts.get(ceremony.attempt) ?? null);
    const input: AuditInput = {
      replica,
      observed: this.recorder.snapshot(),
      seat: this.seat,
      playerId: this.playerId,
      mine,
    };
    let report: AuditReport;
    try {
      report = await this.options.verify(input);
    } catch (error) {
      report = {
        ok: false,
        checks: [
          {
            id: 'replay',
            status: 'fail',
            detail: error instanceof Error ? error.message : '稽核程式出錯',
          },
        ],
        compared: 0,
        attempt: ceremony?.attempt ?? null,
        missing: ceremony?.missing ?? [],
        actionCount: replica.actions.length,
      };
    }
    if (generation !== this.generation || this.disposed) return;
    this.options.onReport(report);
  }
}
