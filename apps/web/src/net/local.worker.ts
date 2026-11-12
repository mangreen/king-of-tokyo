/**
 * 主機 Worker 進入點：房間邏輯、計時與電腦玩家的計算都在這裡跑，不佔用畫面（3D 渲染）所在的主執行緒。
 * - 離線：只接頁面自己的連線
 * - 房主模式（有 relayUrl）：另外把中繼上的客人接進來；socket.io-client 只在這個模式才載入
 * - 直連：RTCPeerConnection 不能在 Worker 用，所以這裡的「連線器」只是代理，真正的連線在主執行緒
 */
import { loadCardSetFromJson } from '@kot/cardsets/pure';
import {
  createLocalHost,
  createProxyConnector,
  createRelayedHost,
  type ProxyRequest,
  type ToClient,
  type ToHost,
} from '@kot/room';
import originalCardSet from '../../../../card-sets/original/set.json';
import type { WorkerInit, WorkerPath } from './workerInit.js';

/** 只宣告用到的 Worker 全域，避免和 DOM 型別衝突。 */
const scope = self as unknown as {
  postMessage(message: ToClient | ProxyRequest | WorkerPath): void;
  onmessage: ((event: { data: ToHost | WorkerInit }) => void) | null;
  close(): void;
};

const cardSet = loadCardSetFromJson(originalCardSet, 'original');
let receive: ((message: ToHost) => void) | null = null;
let proxy: ReturnType<typeof createProxyConnector> | null = null;

async function start(init: WorkerInit): Promise<void> {
  const send = (message: ToClient): void => {
    scope.postMessage(message);
  };
  if (init.relayUrl === undefined) {
    receive = createLocalHost({ cardSet }).connect(send);
    return;
  }
  const { createRelaySocket } = await import('./relaySocket.js');
  if (init.direct === true) {
    proxy = createProxyConnector((message) => {
      scope.postMessage(message);
    });
  }
  const host = createRelayedHost({
    cardSet,
    socket: createRelaySocket(init.relayUrl, { lazy: true }),
    ...(proxy === null ? {} : { bridge: { direct: proxy.connector } }),
  });
  host.bridge.onPath((info) => {
    scope.postMessage({ k: 'path', ...info });
  });
  receive = host.connectPage(send);
}

// init 之前不會有其他訊息（頁面先送 init）；start 是非同步的，期間到達的訊息先排隊
const queue: ToHost[] = [];
scope.onmessage = (event) => {
  const message = event.data;
  if (message.t === 'init') {
    void start(message).then(() => {
      for (const queued of queue.splice(0)) receive?.(queued);
    });
    return;
  }
  // 主執行緒轉來的直連事件（協商資料、通道開關、訊框）
  if (proxy?.handle(message)) return;
  if (receive === null) {
    queue.push(message);
    return;
  }
  receive(message);
  if (message.t === 'close') scope.close();
};
