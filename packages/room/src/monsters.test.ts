import { describe, expect, it } from 'vitest';
import { MONSTER_COUNT } from '@kot/protocol';
import { pickMonsters } from './monsters.js';

describe('pickMonsters', () => {
  it('不重複，且都在範圍內', () => {
    for (let n = 1; n <= 6; n++) {
      for (let k = 0; k < 50; k++) {
        const picks = pickMonsters(n);
        expect(picks).toHaveLength(n);
        expect(new Set(picks).size).toBe(n);
        for (const p of picks) {
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThan(MONSTER_COUNT);
        }
      }
    }
  });

  it('用注入的亂數時結果可重現', () => {
    expect(pickMonsters(3, 12, () => 0)).toEqual([0, 1, 2]);
    expect(pickMonsters(3, 12, (n) => n - 1)).toEqual([11, 0, 1]);
  });

  it('每場結果會變（長期分佈涵蓋所有造型）', () => {
    const seen = new Set<number>();
    for (let k = 0; k < 400; k++) for (const p of pickMonsters(2)) seen.add(p);
    expect(seen.size).toBe(MONSTER_COUNT);
  });

  it('人數超過造型數時不會爆（取全部）', () => {
    expect(pickMonsters(20, 12)).toHaveLength(12);
  });
});
