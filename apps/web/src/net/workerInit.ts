/** 頁面送給離線／房主 Worker 的第一則訊息：決定它是純離線，還是要向中繼登記的房主。 */
export interface WorkerInit {
  t: 'init';
  /** 有值＝房主模式：用這個伺服器網址的 /relay 登記房號並接客人。 */
  relayUrl?: string;
  /** 房主模式：嘗試與客人建立 WebRTC 直連（實際的 RTCPeerConnection 在主執行緒，Worker 透過代理使用）。 */
  direct?: boolean;
  /** 房主模式：重新整理後要接回的房號。Worker 先從 IndexedDB 還原房間，完成後才處理頁面的握手。 */
  resume?: string;
}

/** Worker 回報還原結果（只有 init 帶了 resume 才會送）。 */
export interface WorkerRestore {
  k: 'restore';
  ok: boolean;
  reason?: string;
}

/** Worker 回報給頁面的連線方式（房主模式）。 */
export interface WorkerPath {
  k: 'path';
  direct: number;
  relay: number;
  parked: boolean;
}
