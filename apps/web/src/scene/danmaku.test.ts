import { describe, expect, it } from 'vitest';
import {
  clampRange,
  DANMAKU_AREA,
  estimateWidth,
  LANE_GAP_PX,
  LanePlanner,
  layoutFor,
  MAX_WAIT_MS,
} from './danmaku.js';

describe('estimateWidth', () => {
  it('全形字比半形字寬，字越大越寬', () => {
    expect(estimateWidth('你好', 20)).toBeGreaterThan(estimateWidth('ab', 20));
    expect(estimateWidth('hello', 30)).toBeGreaterThan(estimateWidth('hello', 20));
    expect(estimateWidth('', 20)).toBe(0);
  });
});

describe('LanePlanner', () => {
  it('第一則直接出發；空軌道優先，所以同時進來的訊息分散到不同軌道', () => {
    const p = new LanePlanner(3);
    const a = p.place(1000, 200, 0.1);
    const b = p.place(1000, 200, 0.1);
    const c = p.place(1000, 200, 0.1);
    expect([a?.startAt, b?.startAt, c?.startAt]).toEqual([1000, 1000, 1000]);
    expect(new Set([a?.lane, b?.lane, c?.lane]).size).toBe(3);
  });

  it('軌道都忙時延後出發，直到前一則的尾巴完全進場（含空隙）', () => {
    const p = new LanePlanner(1);
    const speed = 0.2;
    const a = p.place(0, 300, speed);
    const b = p.place(0, 100, speed);
    expect(a?.startAt).toBe(0);
    expect(b?.startAt).toBeCloseTo((300 + LANE_GAP_PX) / speed);
  });

  it('不變式：隨機訊息序列中，同一軌道上相鄰彈幕任何時刻都不重疊', () => {
    const speed = 0.15;
    const p = new LanePlanner(4);
    const placed: { lane: number; start: number; width: number }[] = [];
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let now = 0;
    for (let i = 0; i < 400; i += 1) {
      now += rnd() * 900;
      const width = 60 + Math.floor(rnd() * 500);
      const r = p.place(now, width, speed);
      if (r) placed.push({ lane: r.lane, start: r.startAt, width });
    }
    expect(placed.length).toBeGreaterThan(50);
    for (let lane = 0; lane < 4; lane += 1) {
      const items = placed.filter((x) => x.lane === lane);
      for (let i = 1; i < items.length; i += 1) {
        const prev = items[i - 1];
        const cur = items[i];
        if (!prev || !cur) continue;
        // 等速：後者的左緣（右側進場）永遠在前者右緣之後 ⇔ 出發時間差 ≥ 前者寬度／速度
        expect(cur.start - prev.start).toBeGreaterThanOrEqual(prev.width / speed);
      }
    }
  });

  it('等太久就丟棄，之後空了又能接收', () => {
    const p = new LanePlanner(1);
    const speed = 0.05;
    expect(p.place(0, 600, speed)).not.toBeNull(); // 軌道忙到 (632)/0.05 ≈ 12.6 秒
    expect(p.place(0, 100, speed)).toBeNull();
    expect(p.place(13_000, 100, speed)).not.toBeNull();
    expect(MAX_WAIT_MS).toBeGreaterThan(0);
  });
});

describe('layoutFor', () => {
  it('彈幕只佔場景上方一帶，軌道數有上下限', () => {
    const big = layoutFor(1200, 800, 22);
    expect(big.lanes).toBeGreaterThanOrEqual(1);
    expect(big.lanes).toBeLessThanOrEqual(8);
    expect(big.top + big.lanes * big.laneHeight).toBeLessThanOrEqual(
      800 * DANMAKU_AREA + big.laneHeight,
    );
    const tiny = layoutFor(300, 100, 40);
    expect(tiny.lanes).toBe(1);
    expect(layoutFor(1200, 800, 40).lanes).toBeLessThanOrEqual(layoutFor(1200, 800, 14).lanes);
  });

  it('速度跟寬度成正比（穿過畫面的時間大致固定），有下限', () => {
    expect(layoutFor(1800, 800, 22).speed).toBeGreaterThan(layoutFor(900, 800, 22).speed);
    expect(layoutFor(10, 800, 22).speed).toBeGreaterThan(0);
  });
});

describe('clampRange', () => {
  const r = { min: 1, max: 5, def: 3 };
  it('夾在範圍內，壞值退回預設', () => {
    expect(clampRange(0, r)).toBe(1);
    expect(clampRange(9, r)).toBe(5);
    expect(clampRange(2.5, r)).toBe(2.5);
    expect(clampRange('x', r)).toBe(3);
    expect(clampRange(Number.NaN, r)).toBe(3);
  });
});
