/**
 * 直連（WebRTC）的最小抽象。這個套件不依賴 RTCPeerConnection：
 * 瀏覽器端用真的 WebRTC 實作它，測試用記憶體內的替身。
 * 瀏覽器的 RTCPeerConnection 不能在 Worker 裡用，所以房主端（跑在 Worker）透過 proxy.ts 把它轉到主執行緒。
 */
import type { RtcSignal } from '../local/protocol.js';

export type DirectRole = 'host' | 'guest';

/** 對等端回報給擁有者的事件。 */
export interface DirectPeerEvents {
  /** 有協商資料要送給對方（經中繼）。 */
  signal(data: RtcSignal): void;
  /** 資料通道已開啟，可以收發。 */
  open(): void;
  /** 收到對方送來的一個訊框（字串）。 */
  message(frame: string): void;
  /** 通道關閉或建立失敗（開啟前後都會呼叫，只呼叫一次）。 */
  close(): void;
}

export interface DirectPeer {
  /** 收到對方的協商資料。 */
  signal(data: RtcSignal): void;
  /** 送出一個訊框；通道未開啟時忽略。 */
  send(frame: string): void;
  close(): void;
}

/**
 * 建立一個對等端。房主端建立後立刻送出 offer；客人端等收到 offer 才回 answer。
 */
export type DirectConnector = (role: DirectRole, events: DirectPeerEvents) => DirectPeer;
