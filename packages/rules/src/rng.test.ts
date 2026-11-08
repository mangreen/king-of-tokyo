import { describe, expect, it } from 'vitest';
import { nextInt, nextUint32, seedToRng, seedToState } from './rng.js';

function sequence(seed: number, count: number, max: number): number[] {
  let state = seedToState(seed);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const [value, next] = nextInt(state, max);
    out.push(value);
    state = next;
  }
  return out;
}

describe('rng', () => {
  it('相同 seed 產生相同序列（可重現）', () => {
    expect(sequence(12345, 50, 6)).toEqual(sequence(12345, 50, 6));
  });

  it('不同 seed 產生不同序列', () => {
    expect(sequence(1, 50, 6)).not.toEqual(sequence(2, 50, 6));
  });

  it('不修改傳入狀態（純函式）：同一狀態重複呼叫結果相同', () => {
    const state = seedToState(99);
    expect(nextUint32(state)).toEqual(nextUint32(state));
  });

  it('nextInt 結果落在 [0, max) 且整數', () => {
    for (const value of sequence(7, 1000, 6)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
    }
  });

  it('nextInt(max=1) 永遠回傳 0', () => {
    expect(sequence(5, 20, 1).every((v) => v === 0)).toBe(true);
  });

  it('六面骰分布大致均勻（固定 seed，結果可重現）', () => {
    const counts = new Array<number>(6).fill(0);
    for (const value of sequence(2024, 60_000, 6)) {
      counts[value] = (counts[value] ?? 0) + 1;
    }
    for (const count of counts) {
      // 期望 10000，容許 ±5%
      expect(count).toBeGreaterThan(9500);
      expect(count).toBeLessThan(10500);
    }
  });

  it('會跳過超出 limit 的值（拒絕取樣）：max 不為 2 的冪時仍在範圍內', () => {
    for (const value of sequence(31337, 5000, 5)) {
      expect(value).toBeLessThan(5);
    }
  });

  it('seedToState 將負數與超大整數正規化到 uint32', () => {
    expect(seedToState(-1)).toBe(0xffff_ffff);
    expect(seedToState(0x1_0000_0000 + 5)).toBe(5);
  });

  it('非法參數會丟出 RangeError', () => {
    expect(() => nextInt(0, 0)).toThrow(RangeError);
    expect(() => nextInt(0, 1.5)).toThrow(RangeError);
    expect(() => nextInt(-1, 6)).toThrow(RangeError);
    expect(() => nextUint32(0x1_0000_0000)).toThrow(RangeError);
    expect(() => seedToState(Number.NaN)).toThrow(RangeError);
    expect(() => seedToState(1.5)).toThrow(RangeError);
  });
});

describe('密鑰式亂數（KeyedRng）', () => {
  const seedA = '0123456789abcdef0123456789abcdef';
  const seedB = '0123456789abcdef0123456789abcdee';

  function draw(seed: string, n: number): number[] {
    let rng = seedToRng(seed);
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const [v, next] = nextInt(rng, 6);
      out.push(v);
      rng = next;
    }
    return out;
  }

  it('相同 seed 相同序列；差一個字元就完全不同', () => {
    expect(draw(seedA, 200)).toEqual(draw(seedA, 200));
    expect(draw(seedA, 200)).not.toEqual(draw(seedB, 200));
  });

  it('是純函式：不改動傳入的狀態', () => {
    const rng = seedToRng(seedA);
    const copy = JSON.parse(JSON.stringify(rng)) as typeof rng;
    nextInt(rng, 6);
    expect(rng).toEqual(copy);
  });

  it('分佈大致均勻（6 面各約 1/6）', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    for (const v of draw(seedA, 6000)) counts[v] = (counts[v] ?? 0) + 1;
    for (const c of counts) expect(Math.abs(c - 1000)).toBeLessThan(150);
  });

  it('跨越區塊邊界（每 8 次取一個新區塊）仍然連續且不重複同一個字組', () => {
    let rng = seedToRng(seedA);
    const words: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const [v, next] = nextInt(rng, 0x1_0000_0000);
      words.push(v);
      rng = next;
    }
    expect(new Set(words).size).toBe(40);
  });

  it('太短的字串 seed 被拒絕；數字 seed 維持舊行為', () => {
    expect(() => seedToRng('short')).toThrow(RangeError);
    expect(seedToRng(42)).toBe(42);
  });
});
