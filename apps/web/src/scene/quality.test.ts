import { describe, expect, it } from 'vitest';
import { AutoDegrade, QUALITY, lowerTier, parseQualitySetting, startTier } from './quality.js';

describe('quality tiers', () => {
  it('越低的等級預算越小（單調）', () => {
    const t = [QUALITY.high, QUALITY.medium, QUALITY.low];
    for (const key of ['dprCap', 'debris', 'dust', 'buildingDensity', 'segments'] as const) {
      expect(t[0]![key]).toBeGreaterThan(t[1]![key]);
      expect(t[1]![key]).toBeGreaterThan(t[2]![key]);
    }
    // ADR-0003：DPR 上限 1.5（低畫質 1.0）、碎片 ≤60／低畫質 ~20、粒子 ≤300／低畫質 100
    expect(QUALITY.high.dprCap).toBeLessThanOrEqual(1.5);
    expect(QUALITY.low.dprCap).toBe(1);
    expect(QUALITY.high.debris).toBeLessThanOrEqual(60);
    expect(QUALITY.low.dust).toBe(100);
    expect(QUALITY.low.shadowMapSize).toBe(0);
  });

  it('降級順序與解析', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBeNull();
    expect(parseQualitySetting('medium')).toBe('medium');
    expect(parseQualitySetting('ultra')).toBe('auto');
    expect(parseQualitySetting(null)).toBe('auto');
    expect(startTier('auto')).toBe('high');
    expect(startTier('low')).toBe('low');
  });
});

describe('AutoDegrade', () => {
  const feed = (d: AutoDegrade, ms: number, n: number): boolean[] =>
    Array.from({ length: n }, () => d.push(ms));

  it('順暢（60fps）不降級', () => {
    const d = new AutoDegrade();
    expect(feed(d, 16.7, 600).some(Boolean)).toBe(false);
  });

  it('暖機期間再慢也不降級，之後持續偏慢就降', () => {
    const d = new AutoDegrade({ warmupFrames: 10, windowFrames: 20 });
    expect(feed(d, 80, 10).some(Boolean)).toBe(false);
    const results = feed(d, 80, 20);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results[19]).toBe(true);
  });

  it('降級後重新暖機，不會連續誤降', () => {
    const d = new AutoDegrade({ warmupFrames: 10, windowFrames: 20 });
    feed(d, 80, 30);
    expect(feed(d, 80, 10).some(Boolean)).toBe(false);
  });

  it('偶發的長停頓（切分頁）不影響平均', () => {
    const d = new AutoDegrade({ warmupFrames: 5, windowFrames: 20 });
    feed(d, 16, 5);
    const r = [...feed(d, 16, 10), d.push(5000), ...feed(d, 16, 12)];
    expect(r.some(Boolean)).toBe(false);
  });
});
