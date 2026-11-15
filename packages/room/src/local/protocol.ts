/**
 * 「房主」與「客戶端」之間的訊息（Worker／同頁離線、中繼、之後的 WebRTC 都用這一套）。
 * 它把遊戲協定（@kot/protocol 的事件與 ack）包成可以任意傳輸的小信封。
 */
import { z } from 'zod';
import type { Ack } from '@kot/protocol';
import { ReplicaSyncSchema, type ReplicaSync } from '../failover/sync.js';

/** 客戶端 → 房主。 */
export type ToHost =
  { t: 'event'; event: string; payload: unknown; ackId?: number } | { t: 'close' };

/** 房主 → 客戶端。error 只會由「客人端的傳輸層」產生（加入失敗等），房主不會送。 */
export type ToClient =
  | { t: 'open' }
  | { t: 'emit'; event: string; payload: unknown }
  | { t: 'ack'; ackId: number; result: Ack }
  | { t: 'closed' }
  | { t: 'error'; code: string };

/** 來自網路的 ToHost 必須驗證（客人不可信）。event 長度有上限，payload 交給閘道的 zod schema 驗證。 */
export const ToHostSchema = z.union([
  z
    .object({
      t: z.literal('event'),
      event: z.string().min(1).max(64),
      // 沒有內容的事件（例如 client:active）不帶 payload
      payload: z.unknown().optional(),
      ackId: z.number().int().min(0).max(2_147_483_647).optional(),
    })
    .strict(),
  z.object({ t: z.literal('close') }).strict(),
]);

/** 來自網路的 ToClient（房主不一定可信，例如惡意房主）。 */
export const ToClientSchema = z.union([
  z.object({ t: z.literal('open') }).strict(),
  z
    .object({
      t: z.literal('emit'),
      event: z.string().min(1).max(64),
      payload: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      t: z.literal('ack'),
      ackId: z.number().int().min(0),
      result: z.union([
        z.object({ ok: z.literal(true) }),
        z.object({ ok: z.literal(false), code: z.string().max(64) }),
      ]),
    })
    .strict(),
  z.object({ t: z.literal('closed') }).strict(),
]);

/** 頁面這一端看到的「通往房主的通道」（Worker、中繼、WebRTC，測試可用同執行緒替身）。 */
export interface LocalEndpoint {
  post(message: ToHost): void;
  /** 設定收到房主訊息時的處理函式。 */
  listen(handler: (message: ToClient) => void): void;
  terminate(): void;
}

/** 把驗證過的信封整理成 ToHost（exactOptionalPropertyTypes：沒有 ackId 就不帶這個鍵）。 */
export function parseToHost(data: unknown): ToHost | null {
  const parsed = ToHostSchema.safeParse(data);
  if (!parsed.success) return null;
  const message = parsed.data;
  if (message.t === 'close') return { t: 'close' };
  return {
    t: 'event',
    event: message.event,
    payload: message.payload,
    ...(message.ackId === undefined ? {} : { ackId: message.ackId }),
  };
}

// ── 直連（WebRTC）用的信封（ADR-0007 M7）──────────────────────────
// 這些只在「房主⇄客人」之間、經中繼時出現；遊戲層（ToHost／ToClient）完全不知道。

/** WebRTC 連線協商資料。來自對方，所以要驗證大小與形狀。 */
export const RtcSignalSchema = z.union([
  z
    .object({
      k: z.literal('desc'),
      type: z.enum(['offer', 'answer']),
      sdp: z.string().max(20_000),
    })
    .strict(),
  z
    .object({
      k: z.literal('ice'),
      candidate: z.string().max(2_000),
      mid: z.string().max(64).nullable(),
      index: z.number().int().min(0).max(255).nullable(),
    })
    .strict(),
]);
export type RtcSignal = z.infer<typeof RtcSignalSchema>;

/** 協商資料。 */
export interface WireRtc {
  t: 'rtc';
  d: RtcSignal;
}
/** 路徑切換標記：送出者宣告「這則之後我的訊息都走直連」。標記本身走舊路徑，所以接收端能分辨順序。 */
export interface WireSwitch {
  t: 'switch';
}

/** 房主 → 後備：複本同步（M9）。遊戲層不會看到，由客人端點攔截。 */
export interface WireReplica {
  t: 'replica';
  d: ReplicaSync;
}
/** 後備 → 房主：我漏了訊息，請從頭重送複本（M9）。 */
export interface WireReplicaNeed {
  t: 'replica-need';
}

/** 房主 → 客人：開始對局前的種子共同產生（M10）。承諾 commit 公布後，客人回送自己的亂數。 */
export interface WireSeedBegin {
  t: 'seed-begin';
  d: { attempt: number; commit: string };
}
/** 客人 → 房主：我對這次種子產生的貢獻（只送給房主，不廣播）。 */
export interface WireSeedPart {
  t: 'seed-part';
  d: { attempt: number; r: string };
}

export type WireToHost = ToHost | WireRtc | WireSwitch | WireReplicaNeed | WireSeedPart;
export type WireToClient =
  Exclude<ToClient, { t: 'error' }> | WireRtc | WireSwitch | WireReplica | WireSeedBegin;

const WireRtcSchema = z.object({ t: z.literal('rtc'), d: RtcSignalSchema }).strict();
const WireSwitchSchema = z.object({ t: z.literal('switch') }).strict();
const WireReplicaSchema = z.object({ t: z.literal('replica'), d: ReplicaSyncSchema }).strict();
const WireReplicaNeedSchema = z.object({ t: z.literal('replica-need') }).strict();
const WireSeedBeginSchema = z
  .object({
    t: z.literal('seed-begin'),
    d: z
      .object({
        attempt: z.number().int().min(1).max(1_000_000),
        commit: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
  })
  .strict();
const WireSeedPartSchema = z
  .object({
    t: z.literal('seed-part'),
    d: z
      .object({
        attempt: z.number().int().min(1).max(1_000_000),
        r: z.string().regex(/^[0-9a-f]{32}$/),
      })
      .strict(),
  })
  .strict();

/** 驗證來自客人的信封（遊戲訊息＋直連控制訊息）。 */
export function parseWireToHost(data: unknown): WireToHost | null {
  const control = parseControl(data);
  if (control) return control;
  const need = WireReplicaNeedSchema.safeParse(data);
  if (need.success) return need.data;
  const part = WireSeedPartSchema.safeParse(data);
  if (part.success) return part.data;
  return parseToHost(data);
}

/** 驗證來自房主的信封。 */
export function parseWireToClient(data: unknown): WireToClient | null {
  const control = parseControl(data);
  if (control) return control;
  const replica = WireReplicaSchema.safeParse(data);
  if (replica.success) return replica.data as WireReplica;
  const begin = WireSeedBeginSchema.safeParse(data);
  if (begin.success) return begin.data;
  const parsed = ToClientSchema.safeParse(data);
  return parsed.success ? (parsed.data as WireToClient) : null;
}

function parseControl(data: unknown): WireRtc | WireSwitch | null {
  const rtc = WireRtcSchema.safeParse(data);
  if (rtc.success) return rtc.data;
  const sw = WireSwitchSchema.safeParse(data);
  return sw.success ? sw.data : null;
}
