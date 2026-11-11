/**
 * 中繼連線的最小抽象：房主橋接與客人端點只靠它收發，所以 Socket.IO（瀏覽器、Node 測試）
 * 或任何別的實作都能接上，這個套件不依賴 socket.io-client。
 */
export interface RelaySocket {
  readonly connected: boolean;
  /** 送出事件；ack 若提供，收到伺服器回覆時呼叫。 */
  emit(event: string, payload?: unknown, ack?: (result: unknown) => void): void;
  /** 訂閱伺服器事件。 */
  onEvent(event: string, handler: (payload: unknown) => void): void;
  /** 連線建立（含自動重連後）。 */
  onConnect(handler: () => void): void;
  onDisconnect(handler: () => void): void;
  /** 連線失敗（尚未建立）。 */
  onConnectError(handler: () => void): void;
  /** 尚未連線時開始連線（實作可以延後連線，直到真的需要）。沒有這個方法表示建立時就已在連線。 */
  connect?(): void;
  disconnect(): void;
}
