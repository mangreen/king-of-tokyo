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
  seaSpot,
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

  it.each([2, 3, 4, 5, 6])(
    '%i 人局：外圍座位都在東京灣的海面上、互不重疊、不壓到地標與兩個占領位置',
    (n) => {
      const spots = Array.from({ length: n }, (_, seat) => seaSpot(seat, n));
      const bridge = { dx: BRIDGE_END.x - BRIDGE_START.x, dz: BRIDGE_END.z - BRIDGE_START.z };
      const bridgeLen2 = bridge.dx ** 2 + bridge.dz ** 2;
      for (const [i, a] of spots.entries()) {
        // 離岸邊至少 3（腳邊的水波與身體都在水面上）
        expect(inWater(a.x, a.z, 3)).toBe(true);
        // 不在台場島上、不壓到摩天輪
        expect(Math.hypot(a.x - ODAIBA.x, a.z - ODAIBA.z)).toBeGreaterThan(
          ODAIBA_RADIUS + MONSTER_FOOTPRINT,
        );
        expect(Math.hypot(a.x - FERRIS_WHEEL.x, a.z - FERRIS_WHEEL.z)).toBeGreaterThan(
          MONSTER_FOOTPRINT + 3,
        );
        // 與彩虹大橋（線段）保持距離
        const t = Math.max(
          0,
          Math.min(
            1,
            ((a.x - BRIDGE_START.x) * bridge.dx + (a.z - BRIDGE_START.z) * bridge.dz) / bridgeLen2,
          ),
        );
        expect(
          Math.hypot(
            a.x - (BRIDGE_START.x + bridge.dx * t),
            a.z - (BRIDGE_START.z + bridge.dz * t),
          ),
        ).toBeGreaterThan(MONSTER_FOOTPRINT + 2);
        expect(Math.hypot(a.x - BAY_SPOT.x, a.z - BAY_SPOT.z)).toBeGreaterThan(
          MONSTER_FOOTPRINT * 2,
        );
        expect(Math.hypot(a.x - CITY_SPOT.x, a.z - CITY_SPOT.z)).toBeGreaterThan(
          MONSTER_FOOTPRINT * 2,
        );
        for (const b of spots.slice(i + 1)) {
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(MONSTER_FOOTPRINT * 2);
        }
      }
    },
  );

  it('沒有佔領東京的座位不在陸地上（包含 6 人局的每一個座位）', () => {
    for (let n = 1; n <= MAX_SEATS; n++) {
      for (let seat = 0; seat < n; seat++) {
        const s = monsterSpot(seat, n, null);
        expect(inWater(s.x, s.z), `seat ${String(seat)}/${String(n)}`).toBe(true);
      }
    }
    // 佔領東京市的在陸地；佔領東京灣的在台場島上（島在海灣中，仍算陸地姿態，見 seaness）
    expect(inWater(CITY_SPOT.x, CITY_SPOT.z)).toBe(false);
    expect(Math.hypot(BAY_SPOT.x - ODAIBA.x, BAY_SPOT.z - ODAIBA.z)).toBeLessThan(ODAIBA_RADIUS);
  });

  it('座位位置固定：不隨存活人數或位置變動', () => {
    expect(monsterSpot(3, 6, null)).toEqual(ringSpot(3, 6));
    expect(monsterSpot(3, 6, 'city')).toEqual(CITY_SPOT);
    expect(monsterSpot(3, 6, 'bay')).toEqual(BAY_SPOT);
  });

  it('海上的怪獸面向東京中心', () => {
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
