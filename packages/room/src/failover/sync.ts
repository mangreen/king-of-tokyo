/**
 * 複本同步（ADR-0007 §4.2，M9）：房主把房間複本增量送給後備房主（所有真人客人），
 * 後備用「種子＋動作日誌」重放就能在房主不見時接手。
 *
 * - 訊息：meta（成員、階段、種子…，不含動作）＋「從第 from 筆開始的動作」。meta 很小，每則都帶；
 *   動作只送新的部分。追上時分批（每批最多 REPLICA_BATCH 筆），避免超過中繼單則 32 KB 的上限。
 * - 順序：同一條連線（中繼或直連）上依序到達；若真的漏了（from 比手上多），後備回 replica-need，
 *   房主從頭重送。倒退（房主從存檔還原，少了尾端幾筆）也用同一個規則處理：從 from 截斷再接上。
 * - 機密：複本含種子，只給後備（真人客人，信任等級見 §3）。接手金鑰只給本人，不會出現在別人的訊息裡。
 */
import { z } from 'zod';
import type { Action } from '@kot/rules';
import { RoomReplicaSchema } from '../persist.js';
import type { RoomReplica } from '../replica.js';

/** 每則訊息最多帶幾筆動作（每筆約 0.1 KB，遠小於中繼的 32 KB 上限）。 */
export const REPLICA_BATCH = 100;

const ReplicaMetaSchema = RoomReplicaSchema.omit({ actions: true });

export const ReplicaSyncSchema = z
  .object({
    /** 房主任期；後備只接受不低於手上的。 */
    epoch: z.number().int().min(0),
    meta: ReplicaMetaSchema,
    /** actions 是日誌中「從第幾筆開始」的部分。 */
    from: z.number().int().min(0).max(20_000),
    actions: z.array(z.unknown()).max(REPLICA_BATCH),
    /** 這位後備的接手金鑰（只給本人）。 */
    key: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    /** 目前的後備順序（玩家 id，第 1 個是第一順位）。 */
    order: z.array(z.string().max(64)).max(12),
    /** 計畫性交接：房主已指定這位後備，請立刻接手（這是房主送出的最後一則）。 */
    handover: z.literal(true).optional(),
  })
  .strict();
export type ReplicaSync = z.infer<typeof ReplicaSyncSchema>;

type Meta = Omit<RoomReplica, 'actions'>;

/** 房主端：一位客人一個，記得已經送了什麼，只送變化的部分。 */
export class ReplicaSender {
  private sentActions = 0;
  private lastMeta = '';
  private lastKey: string | undefined;
  private lastOrder = '';

  /** 有新連線（客人重連）或客人要求重送時呼叫：下次從頭送。 */
  reset(): void {
    this.sentActions = 0;
    this.lastMeta = '';
    this.lastKey = undefined;
    this.lastOrder = '';
  }

  /** 依目前複本算出要送的訊息（沒有變化就是空陣列）。 */
  messages(replica: RoomReplica, key: string | undefined, order: readonly string[]): ReplicaSync[] {
    const { actions, ...meta } = replica;
    const metaJson = JSON.stringify(meta);
    const orderJson = JSON.stringify(order);
    // 日誌比已送的短＝房主倒退了（從存檔還原）：從日誌尾端對齊的地方重送
    const base = Math.min(this.sentActions, actions.length);
    const unchanged =
      base === actions.length &&
      this.sentActions === actions.length &&
      metaJson === this.lastMeta &&
      key === this.lastKey &&
      orderJson === this.lastOrder;
    if (unchanged) return [];

    const out: ReplicaSync[] = [];
    let from = base;
    do {
      const batch = actions.slice(from, from + REPLICA_BATCH);
      out.push({
        epoch: replica.epoch,
        meta: meta as Meta,
        from,
        actions: batch as unknown[],
        ...(key === undefined ? {} : { key }),
        order: [...order],
      });
      from += batch.length;
    } while (from < actions.length);

    this.sentActions = actions.length;
    this.lastMeta = metaJson;
    this.lastKey = key;
    this.lastOrder = orderJson;
    return out;
  }
}

export type ApplyResult = 'ok' | 'gap' | 'stale';

/** 後備端：維護最新的複本。 */
export class ReplicaMirror {
  private meta: Meta | null = null;
  private actions: unknown[] = [];
  private _epoch = 0;
  private _key: string | undefined;
  private _order: string[] = [];

  get epoch(): number {
    return this._epoch;
  }
  get key(): string | undefined {
    return this._key;
  }
  get order(): readonly string[] {
    return this._order;
  }
  get actionCount(): number {
    return this.actions.length;
  }

  /** 套用一則同步訊息。gap＝漏了中間的動作，需要房主從頭重送；stale＝來自更舊的世代，忽略。 */
  apply(sync: ReplicaSync): ApplyResult {
    if (sync.epoch < this._epoch) return 'stale';
    if (sync.epoch > this._epoch) {
      // 新房主：舊的日誌不能沿用
      this._epoch = sync.epoch;
      this.actions = [];
      this.meta = null;
    }
    if (sync.from > this.actions.length) return 'gap';
    // 從 from 截斷再接上：同時處理重疊與倒退
    this.actions = [...this.actions.slice(0, sync.from), ...sync.actions];
    this.meta = sync.meta as Meta;
    this._key = sync.key;
    this._order = [...sync.order];
    return 'ok';
  }

  /** 目前的完整複本；還沒收到任何資料時為 null。 */
  snapshot(): RoomReplica | null {
    if (!this.meta) return null;
    return { ...this.meta, epoch: this._epoch, actions: this.actions as Action[] };
  }

  clear(): void {
    this.meta = null;
    this.actions = [];
    this._key = undefined;
    this._order = [];
  }
}
