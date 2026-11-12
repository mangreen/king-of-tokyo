/**
 * 跨執行緒的直連：房主的房間跑在 Worker，但 RTCPeerConnection 只能在主執行緒用。
 * Worker 端用 createProxyConnector 得到一個「看起來像真的」的 DirectConnector，
 * 實際工作由主執行緒的 serveProxy 用真正的 connector 完成；兩邊只靠 postMessage 傳這些小訊息。
 */
import type { RtcSignal } from '../local/protocol.js';
import type { DirectConnector, DirectPeer, DirectPeerEvents, DirectRole } from './types.js';

/** Worker → 主執行緒。 */
export type ProxyRequest =
  | { k: 'rtc-new'; id: number; role: DirectRole }
  | { k: 'rtc-signal'; id: number; d: RtcSignal }
  | { k: 'rtc-send'; id: number; frame: string }
  | { k: 'rtc-close'; id: number };

/** 主執行緒 → Worker。 */
export type ProxyEvent =
  | { k: 'rtc-signal'; id: number; d: RtcSignal }
  | { k: 'rtc-open'; id: number }
  | { k: 'rtc-frame'; id: number; frame: string }
  | { k: 'rtc-closed'; id: number };

export function isProxyRequest(value: unknown): value is ProxyRequest {
  return isRtcMessage(value, ['rtc-new', 'rtc-signal', 'rtc-send', 'rtc-close']);
}

export function isProxyEvent(value: unknown): value is ProxyEvent {
  return isRtcMessage(value, ['rtc-signal', 'rtc-open', 'rtc-frame', 'rtc-closed']);
}

function isRtcMessage(value: unknown, kinds: string[]): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const { k, id } = value as { k?: unknown; id?: unknown };
  return typeof k === 'string' && kinds.includes(k) && typeof id === 'number';
}

/**
 * Worker 端。`post` 把請求送到主執行緒；回傳的 `handle` 要在收到主執行緒的事件時呼叫
 * （回傳 true 表示這則是直連事件，已處理）。
 */
export function createProxyConnector(post: (message: ProxyRequest) => void): {
  connector: DirectConnector;
  handle(message: unknown): boolean;
} {
  const peers = new Map<number, DirectPeerEvents>();
  let nextId = 1;

  const connector: DirectConnector = (role, events): DirectPeer => {
    const id = nextId;
    nextId += 1;
    peers.set(id, events);
    post({ k: 'rtc-new', id, role });
    return {
      signal: (d) => {
        post({ k: 'rtc-signal', id, d });
      },
      send: (frame) => {
        post({ k: 'rtc-send', id, frame });
      },
      close: () => {
        if (peers.delete(id)) post({ k: 'rtc-close', id });
      },
    };
  };

  return {
    connector,
    handle(message) {
      if (!isProxyEvent(message)) return false;
      const events = peers.get(message.id);
      if (!events) return true;
      switch (message.k) {
        case 'rtc-signal':
          events.signal(message.d);
          break;
        case 'rtc-open':
          events.open();
          break;
        case 'rtc-frame':
          events.message(message.frame);
          break;
        case 'rtc-closed':
          peers.delete(message.id);
          events.close();
          break;
      }
      return true;
    },
  };
}

/**
 * 主執行緒端。`post` 把事件送回 Worker；`handle` 處理 Worker 的請求。
 * Worker 結束時呼叫 closeAll 收掉所有連線。
 */
export function serveProxy(
  connector: DirectConnector,
  post: (message: ProxyEvent) => void,
): { handle(message: unknown): boolean; closeAll(): void } {
  const peers = new Map<number, DirectPeer>();
  return {
    handle(message) {
      if (!isProxyRequest(message)) return false;
      if (message.k === 'rtc-new') {
        const { id } = message;
        if (peers.has(id)) return true;
        const peer = connector(message.role, {
          signal: (d) => {
            post({ k: 'rtc-signal', id, d });
          },
          open: () => {
            post({ k: 'rtc-open', id });
          },
          message: (frame) => {
            post({ k: 'rtc-frame', id, frame });
          },
          close: () => {
            if (peers.delete(id)) post({ k: 'rtc-closed', id });
          },
        });
        peers.set(id, peer);
        return true;
      }
      const peer = peers.get(message.id);
      if (!peer) return true;
      switch (message.k) {
        case 'rtc-signal':
          peer.signal(message.d);
          break;
        case 'rtc-send':
          peer.send(message.frame);
          break;
        case 'rtc-close':
          peers.delete(message.id);
          peer.close();
          break;
      }
      return true;
    },
    closeAll() {
      for (const peer of peers.values()) peer.close();
      peers.clear();
    },
  };
}
