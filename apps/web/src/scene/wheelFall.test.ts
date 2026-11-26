import { describe, expect, it } from 'vitest';
import { FERRIS_WHEEL, ODAIBA, ODAIBA_RADIUS, BAY_SPOT } from './layout.js';
import {
  FALL_SHAKE,
  FALL_TOTAL,
  FALLEN_CENTER,
  FLAT_Y,
  HUB_Y,
  RISE_DURATION,
  fallK,
  riseK,
  shakeAmount,
  wheelPose,
} from './wheelFall.js';

describe('摩天輪倒塌', () => {
  it('倒下前先晃動（進度維持 0），之後單調倒下直到落地', () => {
    expect(fallK(0)).toBe(0);
    expect(fallK(FALL_SHAKE)).toBe(0);
    let prev = 0;
    for (let t = FALL_SHAKE; t <= FALL_SHAKE + 1.3; t += 0.02) {
      const k = fallK(t);
      expect(k).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = k;
    }
    expect(fallK(FALL_SHAKE + 1.3)).toBeCloseTo(1, 5);
  });

  it('落地後輕輕彈跳再靜止，最後完全倒下', () => {
    const mid = fallK(FALL_SHAKE + 1.3 + 0.2);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0.9);
    expect(fallK(FALL_TOTAL)).toBeCloseTo(1, 5);
    expect(fallK(FALL_TOTAL + 5)).toBeCloseTo(1, 5);
  });

  it('晃動只出現在倒下前後，之後歸零', () => {
    let max = 0;
    for (let t = 0; t < FALL_SHAKE + 0.3; t += 0.005) max = Math.max(max, Math.abs(shakeAmount(t)));
    expect(max).toBeGreaterThan(0.02);
    expect(shakeAmount(FALL_SHAKE + 0.31)).toBe(0);
    expect(shakeAmount(-1)).toBe(0);
  });

  it('立起：從倒下平滑回到站立', () => {
    expect(riseK(1, 0)).toBe(1);
    expect(riseK(1, RISE_DURATION)).toBe(0);
    expect(riseK(0.6, RISE_DURATION / 2)).toBeCloseTo(0.3, 5);
  });

  it('站立姿態＝原位；倒下姿態＝平躺在台場、輪心壓在東京灣站位附近', () => {
    const up = wheelPose(0);
    expect(up).toMatchObject({ x: FERRIS_WHEEL.x, y: HUB_Y, z: FERRIS_WHEEL.z });
    expect(up.rotX).toBeCloseTo(0, 9);
    expect(up.y).toBe(HUB_Y);
    expect(up.rotY).toBeCloseTo(0, 9);
    const down = wheelPose(1);
    expect(down.y).toBeGreaterThanOrEqual(FLAT_Y);
    expect(down.y).toBeLessThan(FLAT_Y + 0.5);
    expect(down.rotX).toBeGreaterThan(1.3); // 幾乎平躺
    expect(down.rotX).toBeLessThan(Math.PI / 2); // 但沒有完全平整（一側靠著支架）
    expect(down.supportRotX).toBeLessThan(-1); // 支架倒向北側
    expect(Math.hypot(down.x - BAY_SPOT.x, down.z - BAY_SPOT.z)).toBeLessThan(2); // 蓋住東京灣站位
    // 輪子（半徑約 3.9）整個落在台場島上，不會伸進海裡
    expect(Math.hypot(FALLEN_CENTER.x - ODAIBA.x, FALLEN_CENTER.z - ODAIBA.z) + 3.9).toBeLessThan(
      ODAIBA_RADIUS + 1.2,
    );
  });

  it('進度超出範圍會被夾住', () => {
    expect(wheelPose(-1)).toEqual(wheelPose(0));
    expect(wheelPose(2)).toEqual(wheelPose(1));
  });

  it('倒塌過程中輪子不會鑽進地面（最低點高於島面）', () => {
    for (let k = 0; k <= 1.0001; k += 0.05) {
      const p = wheelPose(k);
      // 輪面半徑 3.1（車廂 +0.5）；rotX 為倒下角，最低點 = y - R·cos(rotX)
      const lowest = p.y - 3.6 * Math.cos(p.rotX);
      expect(lowest).toBeGreaterThan(0.25);
    }
  });
});
