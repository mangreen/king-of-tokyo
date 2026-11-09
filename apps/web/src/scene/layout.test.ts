import { describe, expect, it } from 'vitest';
import {
  BAY_SPOT,
  BRIDGE_END,
  BRIDGE_START,
  CITY_SPOT,
  FERRIS_WHEEL,
  MAX_SEATS,
  MONSTER_FOOTPRINT,
  ODAIBA,
  ODAIBA_RADIUS,
  PLAZA_RADIUS,
  SKYTREE,
  TOKYO_TOWER,
  inWater,
  monsterSpot,
  riverX,
  ringSpot,
  seatColor,
  shoreX,
} from './layout.js';

describe('scene layout（東京灣地理）', () => {
  it('市區在西側、海灣在東側：東京市在陸地，海岸線隨 z 變化但大致在 x≈12', () => {
    expect(inWater(CITY_SPOT.x, CITY_SPOT.z)).toBe(false);
    expect(inWater(-20, 0)).toBe(false);
    expect(inWater(30, 0)).toBe(true);
    for (let z = -40; z <= 40; z += 4) {
      expect(shoreX(z)).toBeGreaterThan(8);
      expect(shoreX(z)).toBeLessThan(17);
    }
  });

  it('隅田川從北方流入海灣', () => {
    expect(inWater(riverX(-20), -20)).toBe(true);
    expect(inWater(riverX(-20) - 6, -20)).toBe(false); // 西岸是陸地
    expect(inWater(5, 5)).toBe(false); // 河口以南沒有河
    expect(inWater(-3, -20, 0)).toBe(false);
  });

  it('東京灣站位在台場（海上的人工島），與岸邊隔著水', () => {
    expect(Math.hypot(BAY_SPOT.x - ODAIBA.x, BAY_SPOT.z - ODAIBA.z)).toBeLessThan(ODAIBA_RADIUS);
    expect(inWater(ODAIBA.x - ODAIBA_RADIUS, ODAIBA.z)).toBe(true);
    expect(Math.hypot(BAY_SPOT.x, BAY_SPOT.z)).toBeGreaterThan(PLAZA_RADIUS + MONSTER_FOOTPRINT);
    // 摩天輪在島上、不與站位重疊
    expect(Math.hypot(FERRIS_WHEEL.x - ODAIBA.x, FERRIS_WHEEL.z - ODAIBA.z)).toBeLessThan(
      ODAIBA_RADIUS,
    );
    expect(Math.hypot(FERRIS_WHEEL.x - BAY_SPOT.x, FERRIS_WHEEL.z - BAY_SPOT.z)).toBeGreaterThan(
      MONSTER_FOOTPRINT,
    );
  });

  it('彩虹大橋從岸邊接到島上；東京鐵塔在陸地且不在怪獸站位上；晴空塔在陸地', () => {
    expect(inWater(BRIDGE_START.x, BRIDGE_START.z)).toBe(false);
    expect(Math.hypot(BRIDGE_END.x - ODAIBA.x, BRIDGE_END.z - ODAIBA.z)).toBeLessThan(
      ODAIBA_RADIUS,
    );
    expect(inWater(TOKYO_TOWER.x, TOKYO_TOWER.z)).toBe(false);
    expect(Math.hypot(TOKYO_TOWER.x - CITY_SPOT.x, TOKYO_TOWER.z - CITY_SPOT.z)).toBeGreaterThan(
      MONSTER_FOOTPRINT,
    );
    expect(inWater(SKYTREE.x, SKYTREE.z, 1)).toBe(false);
  });

  it.each([2, 3, 4, 5, 6])('%i 人局：外圍座位在陸地、互不重疊、不壓到地標與東京站位', (n) => {
    const spots = Array.from({ length: n }, (_, seat) => ringSpot(seat, n));
    for (const [i, a] of spots.entries()) {
      expect(inWater(a.x, a.z, 3)).toBe(false);
      expect(Math.hypot(a.x, a.z)).toBeGreaterThan(PLAZA_RADIUS + MONSTER_FOOTPRINT);
      expect(Math.hypot(a.x - TOKYO_TOWER.x, a.z - TOKYO_TOWER.z)).toBeGreaterThan(
        MONSTER_FOOTPRINT + 1,
      );
      expect(Math.hypot(a.x - BAY_SPOT.x, a.z - BAY_SPOT.z)).toBeGreaterThan(MONSTER_FOOTPRINT * 2);
      for (const b of spots.slice(i + 1)) {
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(MONSTER_FOOTPRINT * 2);
      }
    }
  });

  it('座位位置固定：不隨存活人數或位置變動', () => {
    expect(monsterSpot(3, 6, null)).toEqual(ringSpot(3, 6));
    expect(monsterSpot(3, 6, 'city')).toEqual(CITY_SPOT);
    expect(monsterSpot(3, 6, 'bay')).toEqual(BAY_SPOT);
  });

  it('外圍怪獸面向東京中心', () => {
    const s = ringSpot(1, 4);
    const len = Math.hypot(s.x, s.z);
    expect(Math.sin(s.yaw)).toBeCloseTo(-s.x / len);
    expect(Math.cos(s.yaw)).toBeCloseTo(-s.z / len);
  });

  it('座位顏色循環且不會是 undefined', () => {
    for (let s = 0; s < MAX_SEATS * 2; s++) expect(seatColor(s)).toMatch(/^#[0-9a-f]{6}$/);
    expect(seatColor(0)).toBe(seatColor(MAX_SEATS));
    expect(seatColor(-1)).toMatch(/^#/);
  });
});
