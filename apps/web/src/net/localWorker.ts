import {
  serveProxy,
  type DirectConnector,
  type HostPathInfo,
  type HostSide,
  type LocalEndpoint,
  type TakeoverResult,
  type ToClient,
} from '@kot/room';
import type {
  WorkerCtl,
  WorkerInit,
  WorkerPath,
  WorkerReply,
  WorkerRestore,
} from './workerInit.js';

type TakeoverFailure = Extract<TakeoverResult, { ok: false }>['reason'];

export interface WorkerEndpointOptions {
  relayUrl?: string;
  /** 提供就啟用直連：真正的 RTCPeerConnection 在這個（主）執行緒，Worker 透過代理使用。 */
  direct?: DirectConnector;
  /** 房主的連線方式改變。 */
  onPath?: (info: HostPathInfo) => void;
  /** 房主模式：重新整理後要接回的房號。 */
  resume?: string;
  /** 還原的結果（有 resume 才會呼叫）。 */
  onRestore?: (result: { ok: boolean; reason?: string }) => void;
}

/** 建立真實的主機 Worker。Vite 會把 local.worker.ts 另外打包，只有離線／房主模式才會載入。 */
export function createWorkerEndpoint(options: WorkerEndpointOptions = {}): LocalEndpoint {
  const worker = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' });
  const init: WorkerInit = {
    t: 'init',
    ...(options.relayUrl === undefined ? {} : { relayUrl: options.relayUrl }),
    ...(options.direct === undefined ? {} : { direct: true }),
    ...(options.resume === undefined ? {} : { resume: options.resume }),
  };
  const served =
    options.direct === undefined
      ? null
      : serveProxy(options.direct, (message) => {
          worker.postMessage(message);
        });
  worker.postMessage(init);
  return {
    post: (message) => {
      worker.postMessage(message);
    },
    listen: (handler) => {
      worker.onmessage = (event: MessageEvent<ToClient | WorkerPath | { k: string }>) => {
        const data = event.data;
        if (served?.handle(data)) return;
        if ('k' in data) {
          if (data.k === 'path' && options.onPath) {
            const { direct, relay, parked } = data as WorkerPath;
            options.onPath({ direct, relay, parked });
          }
          if (data.k === 'restore' && options.onRestore) {
            const { ok, reason } = data as WorkerRestore;
            options.onRestore(reason === undefined ? { ok } : { ok, reason });
          }
          return;
        }
        handler(data);
      };
    },
    terminate: () => {
      served?.closeAll();
      worker.terminate();
    },
  };
}

export interface WorkerHostSideOptions extends Omit<WorkerEndpointOptions, 'resume'> {
  relayUrl: string;
  /** 房主重新整理後要接回的房號（只有「一開始就是房主」會用到）。 */
  resume?: string;
}

/**
 * 角色切換用的房主（M9）：同樣是一個 Worker，但頁面不會直接接上它——
 * 由 RoleEndpoint 在「建房」或「接手成功」時才呼叫 connectPage。
 * 後備房主接手時：prepare（還原複本）→ takeover（向中繼出示金鑰）→ connectPage。
 */
export function createWorkerHostSide(options: WorkerHostSideOptions): HostSide {
  const worker = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' });
  const init: WorkerInit = {
    t: 'init',
    relayUrl: options.relayUrl,
    manual: true,
    ...(options.direct === undefined ? {} : { direct: true }),
    ...(options.resume === undefined ? {} : { resume: options.resume }),
  };
  const served =
    options.direct === undefined
      ? null
      : serveProxy(options.direct, (message) => {
          worker.postMessage(message);
        });
  let nextId = 1;
  const waiting = new Map<number, (reply: WorkerReply) => void>();
  let pageHandler: ((message: ToClient) => void) | null = null;
  let supersededHandler: (() => void) | null = null;

  worker.onmessage = (event: MessageEvent<ToClient | WorkerPath | WorkerRestore | WorkerReply>) => {
    const data = event.data;
    if (served?.handle(data)) return;
    if ('k' in data) {
      switch (data.k) {
        case 'path':
          options.onPath?.({ direct: data.direct, relay: data.relay, parked: data.parked });
          return;
        case 'restore':
          options.onRestore?.(
            data.reason === undefined ? { ok: data.ok } : { ok: data.ok, reason: data.reason },
          );
          return;
        case 'superseded':
          supersededHandler?.();
          return;
        default:
          waiting.get(data.id)?.(data);
          waiting.delete(data.id);
          return;
      }
    }
    pageHandler?.(data);
  };
  worker.postMessage(init);

  const ask = (build: (id: number) => WorkerCtl): Promise<WorkerReply> =>
    new Promise((resolve) => {
      const id = nextId;
      nextId += 1;
      waiting.set(id, resolve);
      worker.postMessage(build(id));
    });

  return {
    async prepare(replica) {
      const reply = await ask((id) => ({ t: 'ctl', op: 'prepare', id, replica }));
      if (reply.k !== 'prepared') return { ok: false, reason: '未預期的回覆' };
      return reply.ok ? { ok: true } : { ok: false, reason: reply.reason ?? '複本無法還原' };
    },
    async takeover(code, key) {
      const reply = await ask((id) => ({ t: 'ctl', op: 'takeover', id, code, key }));
      if (reply.k !== 'takeover') return { ok: false, reason: 'unreachable' };
      if (reply.ok) return { ok: true, epoch: reply.epoch ?? 0 };
      return {
        ok: false,
        reason: (reply.reason ?? 'unreachable') as TakeoverFailure,
        ...(reply.retryInMs === undefined ? {} : { retryInMs: reply.retryInMs }),
      };
    },
    async handover(playerId) {
      const reply = await ask((id) => ({ t: 'ctl', op: 'handover', id, playerId }));
      if (reply.k !== 'handover') return { ok: false, reason: '未預期的回覆' };
      return reply.ok ? { ok: true } : { ok: false, reason: reply.reason ?? '交接失敗' };
    },
    connectPage(send) {
      pageHandler = send;
      worker.postMessage({ t: 'ctl', op: 'connect' } satisfies WorkerCtl);
      return (message) => {
        worker.postMessage(message);
      };
    },
    onSuperseded(handler) {
      supersededHandler = handler;
    },
    abandon() {
      pageHandler = null;
      served?.closeAll();
      worker.terminate();
    },
  };
}
