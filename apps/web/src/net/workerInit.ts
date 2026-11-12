/** 頁面送給離線／房主 Worker 的第一則訊息：決定它是純離線，還是要向中繼登記的房主。 */
export interface WorkerInit {
  t: 'init';
  /** 有值＝房主模式：用這個伺服器網址的 /relay 登記房號並接客人。 */
  relayUrl?: string;
  /** 房主模式：嘗試與客人建立 WebRTC 直連（實際的 RTCPeerConnection 在主執行緒，Worker 透過代理使用）。 */
  direct?: boolean;
}

/** Worker 回報給頁面的連線方式（房主模式）。 */
export interface WorkerPath {
  k: 'path';
  direct: number;
  relay: number;
  parked: boolean;
}
