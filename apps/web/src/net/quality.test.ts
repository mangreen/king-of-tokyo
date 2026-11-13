import { describe, expect, it } from 'vitest';
import { classifyRtt, describeQuality, median, QualityMeter } from './quality.js';

describe('連線品質', () => {
  it('依往返時間分級', () => {
    expect(classifyRtt(20)).toBe('good');
    expect(classifyRtt(150)).toBe('good');
    expect(classifyRtt(151)).toBe('fair');
    expect(classifyRtt(400)).toBe('fair');
    expect(classifyRtt(401)).toBe('poor');
  });

  it('中位數：奇數取中間、偶數取中間兩個的平均', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it('取最近三次的中位數，單次尖峰不會讓指示跳動', () => {
    const meter = new QualityMeter();
    meter.success(40);
    meter.success(50);
    expect(meter.success(900)).toEqual({ level: 'good', rttMs: 50 });
    expect(meter.success(900)).toEqual({ level: 'poor', rttMs: 900 });
  });

  it('單次逾時沿用上次結果；連續逾時才算無回應；回應後恢復', () => {
    const meter = new QualityMeter();
    expect(meter.failure()).toBeNull(); // 還沒量過，先不顯示
    meter.reset();
    meter.success(80);
    expect(meter.failure()).toEqual({ level: 'good', rttMs: 80 });
    expect(meter.failure()).toEqual({ level: 'unresponsive' });
    expect(meter.success(90)).toEqual({ level: 'good', rttMs: 85 });
  });

  it('描述文字', () => {
    expect(describeQuality({ level: 'fair', rttMs: 220 })).toBe('網路品質：普通（往返 220 ms）');
    expect(describeQuality({ level: 'unresponsive' })).toContain('沒有回應');
  });
});
