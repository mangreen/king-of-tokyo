import {
  BRIDGE_END,
  BRIDGE_START,
  FERRIS_WHEEL,
  ODAIBA,
  SKYTREE,
  SKYTREE_HEIGHT,
  TOKYO_TOWER,
  TOKYO_TOWER_HEIGHT,
  type Point,
} from './layout.js';
import { OVERVIEW_POSE } from './shots.js';
import { FOLLOW_ZOOM } from './view.js';

/**
 * 站位遮擋檢查（純數學）：大型地標（東京鐵塔、彩虹大橋、摩天輪、台場電視台、晴空塔）
 * 近似成幾個軸對齊的方塊，判斷「從鏡頭看過去，怪獸的胸口與頭有沒有被擋住」。
 * 只用來決定站位與測試，不參與繪製。
 */
export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

const box = (cx: number, cz: number, hx: number, hz: number, y0: number, y1: number): Box => ({
  minX: cx - hx,
  maxX: cx + hx,
  minZ: cz - hz,
  maxZ: cz + hz,
  minY: y0,
  maxY: y1,
});

function buildOccluders(): Box[] {
  const out: Box[] = [];
  // 東京鐵塔：腳（寬 2.4）向上收攏；用高度分層的方塊近似，再留一點邊
  const bands: [number, number, number][] = [
    [0, 4, 2.7],
    [4, 8, 1.9],
    [8, 13, 1.1],
    [13, TOKYO_TOWER_HEIGHT, 0.35],
  ];
  for (const [y0, y1, hw] of bands) out.push(box(TOKYO_TOWER.x, TOKYO_TOWER.z, hw, hw, y0, y1));
  // 晴空塔
  out.push(box(SKYTREE.x, SKYTREE.z, 1.6, 1.6, 0, SKYTREE_HEIGHT));
  // 彩虹大橋：橋面（沿線分段）與兩座橋塔
  const dx = BRIDGE_END.x - BRIDGE_START.x;
  const dz = BRIDGE_END.z - BRIDGE_START.z;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    out.push(box(BRIDGE_START.x + dx * t, BRIDGE_START.z + dz * t, 0.9, 0.9, 2.6, 3.5));
  }
  for (const t of [0.28, 0.72])
    out.push(box(BRIDGE_START.x + dx * t, BRIDGE_START.z + dz * t, 1.0, 1.0, 0, 7.6));
  // 摩天輪（輪面朝南的薄片）與支架
  out.push(box(FERRIS_WHEEL.x, FERRIS_WHEEL.z, 3.9, 0.7, 0.4, 7.4));
  // 台場電視台風格建築（兩座塔樓＋球）
  const tv: Point = { x: ODAIBA.x - 3.4, z: ODAIBA.z - 2.8 };
  out.push(box(tv.x, tv.z, 1.9, 0.8, 0, 6.6));
  return out;
}

export const OCCLUDERS: readonly Box[] = buildOccluders();

type V = { x: number; y: number; z: number };

/** 線段 a→b（0..1）是否穿過方塊（slab 法）。 */
function segmentHitsBox(a: V, b: V, bx: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const axes: [number, number, number, number][] = [
    [a.x, b.x - a.x, bx.minX, bx.maxX],
    [a.y, b.y - a.y, bx.minY, bx.maxY],
    [a.z, b.z - a.z, bx.minZ, bx.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let s0 = (lo - o) / d;
    let s1 = (hi - o) / d;
    if (s0 > s1) [s0, s1] = [s1, s0];
    t0 = Math.max(t0, s0);
    t1 = Math.min(t1, s1);
    if (t0 > t1) return false;
  }
  return true;
}

/** 怪獸要看得清楚的高度：胸口與頭（腳被擋一點沒關係）。 */
export const VISIBLE_HEIGHTS = [3.4, 5.2] as const;

/** 從鏡頭位置看過去，目標點（x, z）上的怪獸有沒有被地標擋住。 */
export function isOccludedFrom(camera: V, spot: Point, boxes: readonly Box[] = OCCLUDERS): boolean {
  for (const h of VISIBLE_HEIGHTS) {
    const target = { x: spot.x, y: h, z: spot.z };
    // 目標前面一小段才算「擋在前面」，避免站在方塊內部時自己擋自己
    const near = { x: camera.x, y: camera.y, z: camera.z };
    for (const bx of boxes) {
      if (segmentHitsBox(near, target, bx)) return true;
    }
  }
  return false;
}

/** 預設總覽鏡頭與「跟隨」鏡頭（沿同一方向拉近）看到的兩個位置。 */
export function viewCameras(spot: Point): V[] {
  const { position: p, lookAt: l } = OVERVIEW_POSE;
  const off = {
    x: (p.x - l.x) / FOLLOW_ZOOM,
    y: (p.y - l.y) / FOLLOW_ZOOM,
    z: (p.z - l.z) / FOLLOW_ZOOM,
  };
  return [p, { x: spot.x + off.x, y: off.y, z: spot.z + off.z }];
}

export function isHiddenByLandmarks(spot: Point): boolean {
  return viewCameras(spot).some((c) => isOccludedFrom(c, spot));
}
