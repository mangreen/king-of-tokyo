/** 頁面送給離線／房主 Worker 的第一則訊息：決定它是純離線，還是要向中繼登記的房主。 */
export interface WorkerInit {
  t: 'init';
  /** 有值＝房主模式：用這個伺服器網址的 /relay 登記房號並接客人。 */
  relayUrl?: string;
}
