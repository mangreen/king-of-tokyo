import type { Monster } from './types.js';

/** 勝負比較的鍵：VP → 剩餘 HP → 能量 → Keep 卡張數。R-END-07 */
function tieBreakKey(m: Monster): number[] {
  return [m.vp, m.hp, m.energy, m.cards.length];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * 從候選者中挑出勝者。比到沒有東西可比仍相同才並列。
 * 候選者為空時回傳空陣列。
 */
export function pickWinners(candidates: readonly Monster[]): number[] {
  let best: Monster[] = [];
  for (const m of candidates) {
    const first = best[0];
    if (!first) {
      best = [m];
      continue;
    }
    const cmp = compareKeys(tieBreakKey(m), tieBreakKey(first));
    if (cmp > 0) {
      best = [m];
    } else if (cmp === 0) {
      best.push(m);
    }
  }
  return best.map((m) => m.seat).sort((a, b) => a - b);
}
