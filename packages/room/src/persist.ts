/**
 * 房主存檔（ADR-0007 M8）：房間複本＋中繼房主金鑰，存在房主自己的瀏覽器（IndexedDB）。
 * 房主重新整理頁面後，用它還原房間並向中繼重新登記同一個房號。
 *
 * 這裡只定義「存什麼」與「怎麼不漏存」；實際的儲存（IndexedDB）在網頁端，測試用記憶體版。
 * 存檔含種子（牌庫與骰子的全部資訊）與房主金鑰，只能留在房主自己的瀏覽器裡。
 */
import { z } from 'zod';
import type { RoomReplica } from './replica.js';

export interface HostSave {
  version: 1;
  replica: RoomReplica;
  /** 中繼房主金鑰：用來接回同一個房號。 */
  hostKey: string;
  savedAt: number;
  /** 後備房主的接手金鑰（玩家 id → 金鑰）。 */
  takeoverKeys?: Record<string, string>;
}

export interface RoomStore {
  save(code: string, save: HostSave): Promise<void>;
  /** 沒有存檔（或儲存不可用）時回傳 null；不會丟例外。 */
  load(code: string): Promise<HostSave | null>;
  remove(code: string): Promise<void>;
}

const MemberSchema = z
  .object({
    id: z.string().min(1).max(64),
    nickname: z.string().min(1).max(64),
    bot: z.boolean(),
    ready: z.boolean(),
    away: z.boolean(),
    left: z.boolean(),
    seat: z.number().int().min(0).max(5).nullable(),
    monster: z.number().int().min(0).max(63).nullable(),
    tokenHash: z.string().max(128).nullable(),
  })
  .strict();

/** 複本的外層形狀（動作日誌的內容交給引擎重放時驗證）。來自本機儲存或後備房主，可能是舊版或損毀。 */
export const RoomReplicaSchema = z
  .object({
    version: z.literal(1),
    epoch: z.number().int().min(0),
    code: z.string().min(1).max(16),
    cardSetId: z.string().min(1).max(64),
    cardSetHash: z.string().min(1).max(128),
    phase: z.enum(['lobby', 'playing', 'over']),
    hostId: z.string().min(1).max(64),
    botSerial: z.number().int().min(0),
    members: z.array(MemberSchema).max(12),
    seed: z.union([z.number(), z.string()]).nullable(),
    config: z
      .object({
        playerCount: z.number().int(),
        startingHp: z.number().int(),
        victoryPoints: z.number().int(),
        diceCount: z.number().int(),
        maxRolls: z.number().int(),
      })
      .strict()
      .nullable(),
    actions: z.array(z.unknown()).max(20_000),
  })
  .strict();

/** 存檔的外層形狀。 */
export const HostSaveSchema = z
  .object({
    version: z.literal(1),
    hostKey: z.string().regex(/^[0-9a-f]{32}$/),
    savedAt: z.number(),
    replica: RoomReplicaSchema,
    /** 後備房主的接手金鑰（玩家 id → 金鑰）；重新整理後沿用，後備手上的金鑰才不會失效。 */
    takeoverKeys: z.record(z.string().max(64), z.string().regex(/^[0-9a-f]{32}$/)).optional(),
  })
  .strict();

/** 驗證存檔的外層形狀；不合格回傳 null。 */
export function parseHostSave(value: unknown): HostSave | null {
  const parsed = HostSaveSchema.safeParse(value);
  return parsed.success ? (parsed.data as unknown as HostSave) : null;
}

/**
 * 不漏存的寫入器：房間每次改變就 request；同時間只有一筆寫入在進行，
 * 進行中又有改變就在完成後再寫一次「最新」的，不會堆積也不會跳過最後的狀態。
 * 刪除與寫入共用同一條佇列，所以順序一定正確。
 */
export class RoomSaver {
  private tail: Promise<void> = Promise.resolve();
  private readonly dirty = new Set<string>();
  /** 已刪除（房間結束／房主主動離開）的房號：之後房間收尾時的狀態變動不能再把存檔寫回去。 */
  private readonly removed = new Set<string>();

  constructor(
    private readonly store: RoomStore,
    /** 目前最新的存檔內容；還不能存（例如還沒向中繼登記）時回傳 null。 */
    private readonly build: (code: string) => HostSave | null,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  request(code: string): void {
    if (this.removed.has(code) || this.dirty.has(code)) return; // 已排隊的那次寫入會讀到最新狀態
    this.dirty.add(code);
    this.tail = this.tail.then(async () => {
      this.dirty.delete(code);
      const save = this.build(code);
      if (!save) return;
      try {
        await this.store.save(code, save);
      } catch (error) {
        this.onError(error);
      }
    });
  }

  remove(code: string): void {
    this.removed.add(code);
    this.dirty.delete(code);
    this.tail = this.tail.then(async () => {
      try {
        await this.store.remove(code);
      } catch (error) {
        this.onError(error);
      }
    });
  }

  /** 等到目前排隊的寫入都完成（測試用）。 */
  flush(): Promise<void> {
    return this.tail;
  }
}

/** 記憶體版（測試用）：存進去的是 JSON 複本，和真的序列化儲存一樣不會共用參照。 */
export function createMemoryRoomStore(): RoomStore & {
  readonly size: number;
  raw(code: string): unknown;
} {
  const data = new Map<string, string>();
  return {
    get size() {
      return data.size;
    },
    raw: (code) => {
      const text = data.get(code);
      return text === undefined ? undefined : (JSON.parse(text) as unknown);
    },
    save: (code, save) => {
      data.set(code, JSON.stringify(save));
      return Promise.resolve();
    },
    load: (code) => {
      const text = data.get(code);
      return Promise.resolve(text === undefined ? null : parseHostSave(JSON.parse(text)));
    },
    remove: (code) => {
      data.delete(code);
      return Promise.resolve();
    },
  };
}
