import { describe, expect, it, vi } from 'vitest';
import type { AuditInput, AuditReport } from '@kot/room';
import { createAuditVerifier, type AuditWorkerLike } from './auditRunner.js';
import type { AuditRequest } from './audit.worker.js';

const input = { observed: {}, seat: 0, playerId: 'p', mine: null } as unknown as AuditInput;
const report: AuditReport = {
  ok: true,
  checks: [],
  compared: 0,
  attempt: null,
  missing: [],
  actionCount: 0,
};

function fakeWorker(reply: (request: AuditRequest, worker: AuditWorkerLike) => void) {
  const worker: AuditWorkerLike & { terminated: number } = {
    terminated: 0,
    onmessage: null,
    onerror: null,
    postMessage(request) {
      reply(request, worker);
    },
    terminate() {
      worker.terminated += 1;
    },
  };
  return worker;
}

describe('createAuditVerifier', () => {
  it('把輸入交給 Worker、拿回報告，並結束 Worker', async () => {
    const worker = fakeWorker((request, w) => {
      w.onmessage?.({ data: { id: request.id, report } });
    });
    await expect(createAuditVerifier(() => worker)(input)).resolves.toEqual(report);
    expect(worker.terminated).toBe(1);
  });

  it('Worker 回報錯誤、無法執行、逾時：都拒絕（呼叫端會把它當成稽核失敗）', async () => {
    const failing = fakeWorker((request, w) => {
      w.onmessage?.({ data: { id: request.id, error: '壞了' } });
    });
    await expect(createAuditVerifier(() => failing)(input)).rejects.toThrow('壞了');
    const crashing = fakeWorker((_r, w) => {
      w.onerror?.({});
    });
    await expect(createAuditVerifier(() => crashing)(input)).rejects.toThrow('無法執行');

    vi.useFakeTimers();
    const silent = fakeWorker(() => undefined);
    const pending = createAuditVerifier(() => silent, 1_000)(input);
    const assertion = expect(pending).rejects.toThrow('逾時');
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
    expect(silent.terminated).toBe(1);
    vi.useRealTimers();
  });
});
