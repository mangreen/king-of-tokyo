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
  RoomReplicaSchema,
  type ProxyRequest,
  type RelayedHost,
  type RoomReplica,
  type ToClient,
  type ToHost,
} from '@kot/room';
import originalCardSet from '../../../../card-sets/original/set.json';
import { createIdbRoomStore } from './idbStore.js';
import type {
  WorkerCtl,
  WorkerInit,
  WorkerPath,
  WorkerReply,
  WorkerRestore,
} from './workerInit.js';

/** 只宣告用到的 Worker 全域，避免和 DOM 型別衝突。 */
const scope = self as unknown as {
  postMessage(message: ToClient | ProxyRequest | WorkerPath | WorkerRestore | WorkerReply): void;
  onmessage: ((event: { data: ToHost | WorkerInit | WorkerCtl }) => void) | null;
  close(): void;
};

const cardSet = loadCardSetFromJson(originalCardSet, 'original');
let receive: ((message: ToHost) => void) | null = null;
let proxy: ReturnType<typeof createProxyConnector> | null = null;
/** manual 模式：等頁面的 connect 控制訊息才接上頁面。 */
let relayed: RelayedHost | null = null;
let pageSend: ((message: ToClient) => void) | null = null;
let manual = false;

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
  // 房主的房間持續存檔到 IndexedDB：重新整理後可以接回（不可用時降級成「重新整理就結束」）
  const store = createIdbRoomStore();
  void store.prune();
  manual = init.manual === true;
  pageSend = send;
  const host = createRelayedHost({
    cardSet,
    store,
    socket: createRelaySocket(init.relayUrl, { lazy: true }),
    ...(proxy === null ? {} : { bridge: { direct: proxy.connector } }),
  });
  relayed = host;
  host.bridge.onPath((info) => {
    scope.postMessage({ k: 'path', ...info });
  });
  host.bridge.onStatus((status) => {
    // 被新房主取代（M9）：通知頁面的角色切換端點，由它降級成客人
    if (status.state === 'closed' && status.reason === 'superseded') {
      scope.postMessage({ k: 'superseded' });
    }
  });
  if (init.resume !== undefined) {
    // 要在頁面握手之前完成（start 結束前，頁面訊息都在佇列裡）
    const result = await host.restore(init.resume);
    scope.postMessage(
      result.ok ? { k: 'restore', ok: true } : { k: 'restore', ok: false, reason: result.reason },
    );
  }
  if (!manual) receive = host.connectPage(send);
}

/** 頁面的控制訊息（manual 模式）：接上頁面、還原複本、接手、交接。 */
function control(message: WorkerCtl): void {
  const host = relayed;
  if (host === null) return;
  switch (message.op) {
    case 'connect':
      if (receive === null && pageSend !== null) {
        receive = host.connectPage(pageSend);
        for (const queued of queue.splice(0)) receive(queued);
      }
      return;
    case 'prepare': {
      const parsed = RoomReplicaSchema.safeParse(message.replica);
      const result = parsed.success
        ? host.prepare(parsed.data as unknown as RoomReplica)
        : ({ ok: false, reason: '複本格式不符' } as const);
      scope.postMessage(
        result.ok
          ? { k: 'prepared', id: message.id, ok: true }
          : { k: 'prepared', id: message.id, ok: false, reason: result.reason },
      );
      return;
    }
    case 'takeover':
      void host.takeover(message.code, message.key).then((result) => {
        scope.postMessage(
          result.ok
            ? { k: 'takeover', id: message.id, ok: true, epoch: result.epoch }
            : {
                k: 'takeover',
                id: message.id,
                ok: false,
                reason: result.reason,
                ...(result.retryInMs === undefined ? {} : { retryInMs: result.retryInMs }),
              },
        );
      });
      return;
    case 'handover':
      void host.bridge.handover(message.playerId).then((result) => {
        scope.postMessage(
          result.ok
            ? { k: 'handover', id: message.id, ok: true }
            : { k: 'handover', id: message.id, ok: false, reason: result.reason },
        );
      });
      return;
  }
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
  if (message.t === 'ctl') {
    control(message);
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
