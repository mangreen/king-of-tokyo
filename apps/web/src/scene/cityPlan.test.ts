import { describe, expect, it } from 'vitest';
import {
  CELL,
  CLASS_COUNT,
  FLOOR_COUNTS,
  FLOOR_HEIGHT,
  FOOTPRINTS,
  heightCap,
  TINT_COUNT,
  classKey,
  generateCity,
  halfExtent,
  mulberry32,
} from './cityPlan.js';
import {
  BAY_SPOT,
  LANDMARK_CLEARANCE,
  MONSTER_FOOTPRINT,
  PLAZA_RADIUS,
  inWater,
  ringSpot,
} from './layout.js';

describe('generateCity', () => {
  it('同樣的參數產生同一座城市', () => {
    expect(generateCity(7, 4)).toEqual(generateCity(7, 4));
    expect(generateCity(7, 4)).not.toEqual(generateCity(8, 4));
  });

  it('建築數量在 draw call 與畫面密度的合理範圍', () => {
    const n = generateCity(1, 6).length;
    expect(n).toBeGreaterThan(60);
    expect(n).toBeLessThan(400);
  });

  it.each([2, 4, 6])('%i 人：建築不重疊、不壓到廣場／水域／怪獸站位', (players) => {
    const city = generateCity(42, players);
    for (const [i, a] of city.entries()) {
      const ea = halfExtent(a);
      expect(Math.hypot(a.x, a.z)).toBeGreaterThan(PLAZA_RADIUS);
      expect(inWater(a.x, a.z, 1.8)).toBe(false);
      for (const l of LANDMARK_CLEARANCE) {
        expect(Math.hypot(a.x - l.at.x, a.z - l.at.z)).toBeGreaterThanOrEqual(l.radius);
      }
      expect(Math.hypot(a.x - BAY_SPOT.x, a.z - BAY_SPOT.z)).toBeGreaterThan(MONSTER_FOOTPRINT + 1);
      for (let seat = 0; seat < players; seat++) {
        const s = ringSpot(seat, players);
        expect(Math.hypot(a.x - s.x, a.z - s.z)).toBeGreaterThan(MONSTER_FOOTPRINT);
      }
      for (const b of city.slice(i + 1)) {
        const eb = halfExtent(b);
        const overlap = Math.abs(a.x - b.x) < ea.hx + eb.hx && Math.abs(a.z - b.z) < ea.hz + eb.hz;
        expect(overlap).toBe(false);
      }
    }
  });

  it('密度只會拿掉建築、不改變保留者（低畫質是高畫質的子集）', () => {
    const full = generateCity(5, 5, 1);
    const low = generateCity(5, 5, 0.6);
    expect(low.length).toBeLessThan(full.length);
    for (const b of low) expect(full).toContainEqual(b);
    expect(generateCity(5, 5, 0)).toHaveLength(0);
  });

  it('欄位都在合法範圍內，尺寸類別數量有限', () => {
    const classes = new Set<number>();
    for (const b of generateCity(3, 6)) {
      expect(b.footprint).toBeLessThan(FOOTPRINTS.length);
      expect(b.tint).toBeLessThan(TINT_COUNT);
      expect([0, Math.PI / 2]).toContain(b.yaw);
      classes.add(classKey(b));
    }
    expect(classes.size).toBeLessThanOrEqual(CLASS_COUNT);
    expect(CELL).toBeGreaterThan(Math.max(...FOOTPRINTS.map((f) => Math.max(f.w, f.d))));
  });

  it('怪獸站位與東京周圍的建築被壓低，不會擋住怪獸（樓高 ≤ 怪獸身高）', () => {
    const players = 6;
    const city = generateCity(21, players);
    for (const b of city) {
      const h = FLOOR_COUNTS[b.floors]! * FLOOR_HEIGHT;
      for (let seat = 0; seat < players; seat++) {
        const s = ringSpot(seat, players);
        if (Math.hypot(b.x - s.x, b.z - s.z) < 9) expect(h).toBeLessThanOrEqual(4.2);
      }
      if (Math.hypot(b.x - BAY_SPOT.x, b.z - BAY_SPOT.z) < 9) expect(h).toBeLessThanOrEqual(4.2);
      if (Math.hypot(b.x, b.z) < 12 && b.z > -3) expect(h).toBeLessThanOrEqual(4.2);
    }
    expect(heightCap(0, 5, 2)).toBeLessThanOrEqual(1);
  });

  it('高樓集中在中外圈（市中心與怪獸周圍壓低），再往外變矮（統計上）', () => {
    const city = generateCity(11, 2);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const inner = city
      .filter((b) => Math.hypot(b.x, b.z) > 15 && Math.hypot(b.x, b.z) < 24)
      .map((b) => b.floors);
    const outer = city.filter((b) => Math.hypot(b.x, b.z) > 30).map((b) => b.floors);
    expect(avg(inner)).toBeGreaterThan(avg(outer));
  });

  it('mulberry32 在 [0,1) 且可重現', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
