import { describe, expect, it } from 'vitest';
import { buildLandmarks } from './landmarks.js';
import { FALL_TOTAL, HUB_Y, wheelPose } from './wheelFall.js';

describe('地標：摩天輪隨東京灣開關', () => {
  it('預設（開放）：摩天輪立著、會緩慢轉動', () => {
    const lm = buildLandmarks();
    lm.update(0);
    const z0 = lm.wheel.rotation.z;
    lm.update(5);
    expect(lm.collapse).toBe(0);
    expect(lm.wheel.position.y).toBe(HUB_Y);
    expect(lm.wheel.rotation.x).toBe(0);
    expect(lm.wheel.rotation.z).not.toBe(z0);
    lm.dispose();
  });

  it('instant 關閉（開局人數不足）：直接是倒塌狀態、不再轉動', () => {
    const lm = buildLandmarks();
    lm.setBayOpen(false, true);
    lm.update(0);
    expect(lm.collapse).toBe(1);
    expect(lm.wheel.position.y).toBeCloseTo(wheelPose(1).y, 5);
    const z = lm.wheel.rotation.z;
    lm.update(3);
    lm.update(6);
    expect(lm.wheel.rotation.z).toBeCloseTo(z, 5);
    lm.dispose();
  });

  it('遊戲中關閉：播放倒塌動畫，倒完靜止；重複設定不重播', () => {
    const lm = buildLandmarks();
    lm.update(0);
    lm.setBayOpen(false);
    let t = 0;
    const ks: number[] = [];
    while (t < FALL_TOTAL + 0.5) {
      t += 0.05;
      lm.update(t);
      ks.push(lm.collapse);
    }
    expect(ks.some((k) => k > 0 && k < 1)).toBe(true);
    expect(lm.collapse).toBe(1);
    lm.setBayOpen(false); // 已經關了：沒有動作
    lm.update(t + 0.1);
    expect(lm.collapse).toBe(1);
    lm.dispose();
  });

  it('重新開放：摩天輪立起回到原位', () => {
    const lm = buildLandmarks();
    lm.setBayOpen(false, true);
    lm.update(0);
    lm.setBayOpen(true);
    for (let t = 0.1; t < 3; t += 0.1) lm.update(t);
    expect(lm.collapse).toBe(0);
    expect(lm.wheel.position.y).toBe(HUB_Y);
    expect(lm.support.rotation.x).toBeCloseTo(0, 5);
    lm.dispose();
  });
});
