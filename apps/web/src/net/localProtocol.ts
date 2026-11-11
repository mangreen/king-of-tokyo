/** 離線主機（Worker）與頁面之間的訊息。 */
import type { Ack } from '@kot/protocol';

export type ToHost =
  { t: 'event'; event: string; payload: unknown; ackId?: number } | { t: 'close' };

export type ToClient =
  | { t: 'open' }
  | { t: 'emit'; event: string; payload: unknown }
  | { t: 'ack'; ackId: number; result: Ack }
  | { t: 'closed' };
