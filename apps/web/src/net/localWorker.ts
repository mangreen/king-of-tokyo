import {
  serveProxy,
  type DirectConnector,
  type HostPathInfo,
  type LocalEndpoint,
  type ToClient,
} from '@kot/room';
import type { WorkerInit, WorkerPath, WorkerRestore } from './workerInit.js';

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
