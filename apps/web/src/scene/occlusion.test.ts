import { describe, expect, it } from 'vitest';
import { BAY_SPOT, CITY_SPOT, MAX_SEATS, ringSpot } from './layout.js';
import { isHiddenByLandmarks, isOccludedFrom, OCCLUDERS } from './occlusion.js';

describe('地標遮擋', () => {
  it('鏡頭被東京鐵塔擋在中間時，後方的點被判定為遮住', () => {
    // 鏡頭在鐵塔正南高處，目標在鐵塔正北
    expect(isOccludedFrom({ x: -6.2, y: 8, z: 20 }, { x: -6.2, z: -12 }, OCCLUDERS)).toBe(true);
    expect(isOccludedFrom({ x: 30, y: 8, z: 20 }, { x: -6.2, z: -12 }, OCCLUDERS)).toBe(false);
  });

  it('東京市與東京灣的站位不會被地標擋住', () => {
    expect(isHiddenByLandmarks(CITY_SPOT)).toBe(false);
    expect(isHiddenByLandmarks(BAY_SPOT)).toBe(false);
  });

  it.each([1, 2, 3, 4, 5, 6])('%i 人局：外圈座位都不會被鐵塔、大橋、摩天輪擋住', (n) => {
    for (let seat = 0; seat < n; seat++) {
      const p = ringSpot(seat, n);
      expect(isHiddenByLandmarks(p), `seat ${String(seat)} of ${String(n)}`).toBe(false);
    }
  });

  it('座位彼此保持足夠距離（怪獸不會疊在一起）', () => {
    for (let n = 2; n <= MAX_SEATS; n++) {
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const pa = ringSpot(a, n);
          const pb = ringSpot(b, n);
          expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeGreaterThan(5.5);
        }
      }
    }
  });
});
