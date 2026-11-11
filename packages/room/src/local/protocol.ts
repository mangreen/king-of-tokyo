/**
 * 「房主」與「客戶端」之間的訊息（Worker／同頁離線、中繼、之後的 WebRTC 都用這一套）。
 * 它把遊戲協定（@kot/protocol 的事件與 ack）包成可以任意傳輸的小信封。
 */
import { z } from 'zod';
import type { Ack } from '@kot/protocol';

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
      payload: z.unknown(),
      ackId: z.number().int().min(0).max(2_147_483_647).optional(),
    })
    .strict(),
  z.object({ t: z.literal('close') }).strict(),
]);

/** 來自網路的 ToClient（房主不一定可信，例如惡意房主）。 */
export const ToClientSchema = z.union([
  z.object({ t: z.literal('open') }).strict(),
  z
    .object({ t: z.literal('emit'), event: z.string().min(1).max(64), payload: z.unknown() })
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
