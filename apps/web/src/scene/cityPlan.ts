import {
  BAY_SPOT,
  LANDMARK_CLEARANCE,
  MONSTER_FOOTPRINT,
  PLAZA_RADIUS,
  inWater,
  ringSpot,
} from './layout.js';

/**
 * 城市配置（純函式）：同一組參數產生同一座城市，所有玩家看到的一樣。
 * 建築只有「有限種尺寸」——每一種尺寸對應一個 InstancedMesh，窗格紋理的重複次數
 * 直接烘進幾何，所以實例只需要位移／朝向／色調，draw call 才會少。
 */

export interface Footprint {
  readonly w: number;
  readonly d: number;
}

export const FOOTPRINTS: readonly Footprint[] = [
  { w: 2.4, d: 2.4 },
  { w: 3.6, d: 2.4 },
  { w: 3.6, d: 3.6 },
];
/** 樓層數（每層 0.6）。 */
export const FLOOR_COUNTS: readonly number[] = [3, 5, 8, 12];
export const FLOOR_HEIGHT = 0.6;
/** 一格街區的邊長（含街道），大於最大的建築邊長。 */
export const CELL = 4.2;
export const CITY_RADIUS = 38;

export interface BuildingPlan {
  x: number;
  z: number;
  /** 0 或 π/2：只有 90 度轉向，窗格才不會歪。 */
  yaw: number;
  footprint: number;
  floors: number;
  /** 色調索引。 */
  tint: number;
}

export const TINT_COUNT = 6;

/** 小型確定性亂數（只用在外觀，與遊戲 RNG 無關）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 建築外框的半邊長（含旋轉後取最大者）。 */
export function halfExtent(b: Pick<BuildingPlan, 'footprint' | 'yaw'>): { hx: number; hz: number } {
  const f = FOOTPRINTS[b.footprint] ?? FOOTPRINTS[0]!;
  const rotated = Math.abs(Math.sin(b.yaw)) > 0.5;
  return rotated ? { hx: f.d / 2, hz: f.w / 2 } : { hx: f.w / 2, hz: f.d / 2 };
}

function blocked(x: number, z: number, playerCount: number): boolean {
  if (Math.hypot(x, z) < PLAZA_RADIUS + 2.2) return true;
  // 建築半邊長最大 1.8，再留一點岸邊空間
  if (inWater(x, z, 2.4)) return true;
  for (const l of LANDMARK_CLEARANCE)
    if (Math.hypot(x - l.at.x, z - l.at.z) < l.radius) return true;
  // 怪獸占地半徑 + 最大建築的半邊長（1.8），避免穿模
  const clear = MONSTER_FOOTPRINT + 1.4;
  if (Math.hypot(x - BAY_SPOT.x, z - BAY_SPOT.z) < clear) return true;
  for (let seat = 0; seat < playerCount; seat++) {
    const s = ringSpot(seat, playerCount);
    if (Math.hypot(x - s.x, z - s.z) < clear) return true;
  }
  return false;
}

/** 該位置允許的最高樓層類別（0–3）。 */
export function heightCap(x: number, z: number, playerCount: number): number {
  const top = FLOOR_COUNTS.length - 1;
  let cap = top;
  const dist = Math.hypot(x, z);
  // 鏡頭在南方：中心南側（z > 0）的建築最容易擋住東京怪獸
  if (dist < 12 && z > -3) cap = Math.min(cap, 1);
  else if (dist < 15) cap = Math.min(cap, 2);
  if (Math.hypot(x - BAY_SPOT.x, z - BAY_SPOT.z) < 9) cap = Math.min(cap, 1);
  for (let seat = 0; seat < playerCount; seat++) {
    const s = ringSpot(seat, playerCount);
    if (Math.hypot(x - s.x, z - s.z) < 9) cap = Math.min(cap, 1);
  }
  return cap;
}

/**
 * 產生建築清單。density（0–1）只會「拿掉」建築，不會改變留下者的位置，
 * 所以低畫質的城市是高畫質的子集。
 */
export function generateCity(seed: number, playerCount: number, density = 1): BuildingPlan[] {
  const rand = mulberry32(seed);
  const all: (BuildingPlan & { rank: number })[] = [];
  const span = Math.ceil(CITY_RADIUS / CELL);
  for (let i = -span; i <= span; i++) {
    for (let j = -span; j <= span; j++) {
      // 每 5 格留一條街，市區才有街廓感
      const street = i % 5 === 0 || j % 5 === 0;
      const jitterX = (rand() - 0.5) * 0.3;
      const jitterZ = (rand() - 0.5) * 0.3;
      const rFoot = rand();
      const rHeight = rand();
      const rYaw = rand();
      const rTint = rand();
      const rank = rand();
      const x = i * CELL + jitterX;
      const z = j * CELL + jitterZ;
      const dist = Math.hypot(x, z);
      if (street || dist > CITY_RADIUS || blocked(x, z, playerCount)) continue;
      // 越靠近市中心越高，但怪獸周圍與鏡頭前方要壓低，才不會遮住怪獸
      const centerBias = 1 - Math.min(1, dist / CITY_RADIUS);
      const floors = Math.min(
        heightCap(x, z, playerCount),
        Math.floor(rHeight * (1.6 + centerBias * 2.6)),
      );
      const footprint = Math.min(FOOTPRINTS.length - 1, Math.floor(rFoot * FOOTPRINTS.length));
      all.push({
        x,
        z,
        yaw: rYaw < 0.5 ? 0 : Math.PI / 2,
        footprint,
        floors,
        tint: Math.min(TINT_COUNT - 1, Math.floor(rTint * TINT_COUNT)),
        rank,
      });
    }
  }
  const keep = Math.max(0, Math.min(1, density));
  return all.filter((b) => b.rank < keep).map(({ rank: _rank, ...b }) => b);
}

/** 尺寸類別代號（footprint × floors），對應一個 InstancedMesh。 */
export function classKey(b: Pick<BuildingPlan, 'footprint' | 'floors'>): number {
  return b.footprint * FLOOR_COUNTS.length + b.floors;
}

export const CLASS_COUNT = FOOTPRINTS.length * FLOOR_COUNTS.length;
