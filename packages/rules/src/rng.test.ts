import { describe, expect, it } from 'vitest';
import { nextInt, nextUint32, seedToState } from './rng.js';

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
