import type { AuditInput, AuditReport, AuditVerifier } from '@kot/room';
import type { AuditRequest, AuditResponse } from './audit.worker.js';

/** 只用到的 Worker 介面（測試可用替身）。 */
export interface AuditWorkerLike {
  postMessage(message: AuditRequest): void;
  onmessage: ((event: { data: AuditResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}

/** 真實的稽核 Worker；Vite 會把 audit.worker.ts 另外打包，只有局後才載入。 */
export function createAuditWorker(): AuditWorkerLike {
  return new Worker(new URL('./audit.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as AuditWorkerLike;
}

/** 每次稽核開一個 Worker，做完就結束它。Worker 出錯或逾時視為稽核失敗（拒絕）。 */
export function createAuditVerifier(
  makeWorker: () => AuditWorkerLike = createAuditWorker,
  timeoutMs = 60_000,
): AuditVerifier {
  let serial = 0;
  return (input: AuditInput) =>
    new Promise<AuditReport>((resolve, reject) => {
      serial += 1;
      const id = serial;
      const worker = makeWorker();
      const finish = (): void => {
        clearTimeout(timer);
        worker.terminate();
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error('稽核逾時'));
      }, timeoutMs);
      worker.onmessage = (event) => {
        if (event.data.id !== id) return;
        finish();
        if ('report' in event.data) resolve(event.data.report);
        else reject(new Error(event.data.error));
      };
      worker.onerror = () => {
        finish();
        reject(new Error('稽核程式無法執行'));
      };
      worker.postMessage({ id, input });
    });
}
