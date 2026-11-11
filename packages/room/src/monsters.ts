import { MONSTER_COUNT } from '@kot/protocol';
import { cryptoRandomInt } from './random.js';

/**
 * 每場對局隨機、不重複地分配怪獸造型（Fisher–Yates 洗牌後取前 count 個）。
 * 純外觀：不影響規則，也不使用對局的 seed（seed 是機密，不能拿來推導任何公開資訊）。
 */
export function pickMonsters(
  count: number,
  total: number = MONSTER_COUNT,
  rand: (maxExclusive: number) => number = cryptoRandomInt,
): number[] {
  const pool = Array.from({ length: total }, (_, i) => i);
  const n = Math.min(count, total);
  for (let i = 0; i < n; i++) {
    const j = i + rand(total - i);
    [pool[i], pool[j]] = [pool[j] as number, pool[i] as number];
  }
  return pool.slice(0, n);
}
