import { useSyncExternalStore } from 'react';

/** 連線品質（客人／伺服器模式：對房主或伺服器的往返時間）。null＝還沒有量測。 */
export type Quality =
  { level: 'good' | 'fair' | 'poor'; rttMs: number } | { level: 'unresponsive' } | null;

/** 往返時間門檻（毫秒）：回合制遊戲不需要很低的延遲，超過 400ms 才開始影響操作手感。 */
export const GOOD_RTT_MS = 150;
export const FAIR_RTT_MS = 400;
/** 取最近幾次的中位數，避免單次抖動讓指示一直跳。 */
export const WINDOW = 3;
/** 連續幾次沒有回應就算無回應。 */
export const FAILURES_UNRESPONSIVE = 2;

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function classifyRtt(rttMs: number): 'good' | 'fair' | 'poor' {
  if (rttMs <= GOOD_RTT_MS) return 'good';
  return rttMs <= FAIR_RTT_MS ? 'fair' : 'poor';
}

/** 量測紀錄器：餵進每次 ping 的結果，得到要顯示的品質。純邏輯，方便測試。 */
export class QualityMeter {
  private samples: number[] = [];
  private failures = 0;

  success(rttMs: number): Quality {
    this.failures = 0;
    this.samples = [...this.samples, rttMs].slice(-WINDOW);
    const rtt = Math.round(median(this.samples));
    return { level: classifyRtt(rtt), rttMs: rtt };
  }

  failure(): Quality {
    this.failures += 1;
    if (this.failures >= FAILURES_UNRESPONSIVE) return { level: 'unresponsive' };
    // 單次逾時：沿用上一次的結果（還沒有結果就先不顯示）
    return this.samples.length === 0 ? null : this.current();
  }

  reset(): void {
    this.samples = [];
    this.failures = 0;
  }

  private current(): Quality {
    const rtt = Math.round(median(this.samples));
    return { level: classifyRtt(rtt), rttMs: rtt };
  }
}

export function describeQuality(quality: NonNullable<Quality>): string {
  if (quality.level === 'unresponsive') return '網路品質：沒有回應，可能已斷線';
  const label = { good: '良好', fair: '普通', poor: '不佳' }[quality.level];
  return `網路品質：${label}（往返 ${String(quality.rttMs)} ms）`;
}

let current: Quality = null;
const listeners = new Set<() => void>();

export function setQuality(next: Quality): void {
  current = next;
  for (const listener of listeners) listener();
}

export function useQuality(): Quality {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
}
