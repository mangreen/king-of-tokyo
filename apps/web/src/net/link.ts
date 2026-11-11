/**
 * 客戶端與「遊戲主機」之間的連線抽象。畫面與狀態只認這個介面，不知道訊息怎麼過去：
 * - 伺服器模式：Socket.IO 連到伺服器（socketLink）
 * - 離線模式：同頁 Web Worker 裡跑一份 @kot/room（localLink），不連任何伺服器
 * - 之後：連到房主的中繼／WebRTC（M6、M7）
 */
import type { Ack } from '@kot/protocol';

export interface LinkHandlers {
  /** 連線建立（含自動重連後）。通常在這裡送握手。 */
  onOpen(): void;
  onEvent(event: string, payload: unknown): void;
  onClose(): void;
  /** 連線失敗（尚未建立）。 */
  onError(): void;
}

export interface ClientLink {
  readonly connected: boolean;
  /** 送出不需要回覆的訊息。 */
  emit(event: string, payload?: unknown): void;
  /** 送出訊息並等待結果；逾時或連線中斷會 reject。 */
  request(event: string, payload: unknown, timeoutMs: number): Promise<Ack>;
  /** 關閉並解除所有監聽；之後不再呼叫 handlers。 */
  close(): void;
}

export type LinkFactory = (handlers: LinkHandlers) => ClientLink;
