import type { LocalEndpoint, ToClient } from '@kot/room';
import type { WorkerInit } from './workerInit.js';

/** 建立真實的主機 Worker。Vite 會把 local.worker.ts 另外打包，只有離線／房主模式才會載入。 */
export function createWorkerEndpoint(options: { relayUrl?: string } = {}): LocalEndpoint {
  const worker = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' });
  const init: WorkerInit = {
    t: 'init',
    ...(options.relayUrl === undefined ? {} : { relayUrl: options.relayUrl }),
  };
  worker.postMessage(init);
  return {
    post: (message) => {
      worker.postMessage(message);
    },
    listen: (handler) => {
      worker.onmessage = (event: MessageEvent<ToClient>) => {
        handler(event.data);
      };
    },
    terminate: () => {
      worker.terminate();
    },
  };
}
