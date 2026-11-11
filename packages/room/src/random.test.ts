import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cryptoRandomInt, hashToken, randomHex, randomSeed } from './random.js';

describe('可攜的亂數與雜湊（不依賴 node:crypto）', () => {
  it('cryptoRandomInt 落在範圍內、各值都出現（無明顯偏差）', () => {
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 6000; i += 1) {
      const n = cryptoRandomInt(6);
      expect(Number.isInteger(n) && n >= 0 && n < 6).toBe(true);
      counts[n] = (counts[n] ?? 0) + 1;
    }
    for (const c of counts) expect(c).toBeGreaterThan(800); // 期望 1000，極寬鬆的下限
    expect(cryptoRandomInt(1)).toBe(0);
  });

  it('cryptoRandomInt 拒絕不合法的範圍', () => {
    expect(() => cryptoRandomInt(0)).toThrow(RangeError);
    expect(() => cryptoRandomInt(-1)).toThrow(RangeError);
    expect(() => cryptoRandomInt(1.5)).toThrow(RangeError);
  });

  it('randomHex 長度正確且每次不同；randomSeed 為 128 位元', () => {
    expect(randomHex(8)).toMatch(/^[0-9a-f]{16}$/);
    expect(randomHex(8)).not.toBe(randomHex(8));
    expect(randomSeed()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('hashToken 與 node:crypto 的 SHA-256 相同（與升級前存的雜湊格式一致）', () => {
    for (const token of ['', 'abc', '東京之王😀', '混合 mixed text '.repeat(300), randomHex(32)]) {
      expect(hashToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
    }
  });
});
