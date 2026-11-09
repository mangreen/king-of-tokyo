/**
 * 場景座標與座位配置（純函式，不依賴 Three.js，可單元測試）。
 *
 * 地理仿照真實的東京灣（從南方往北看，x 向右＝東、z 朝向畫面前方＝南）：
 * 市區在西側，**東京鐵塔**在東京市（中央廣場）旁；東側是海灣，隅田川從北方流入，
 * **彩虹大橋**跨過海面通往**台場**（遊戲的「東京灣」位置，有摩天輪）；遠處是晴空塔，
 * 北方有皇居的綠地。單位：一層樓 ≈ 0.6，怪獸約 5.5 高，一般建築 1.8–7.2，東京鐵塔 17。
 */

export interface Spot {
  readonly x: number;
  readonly z: number;
  /** 繞 y 軸的朝向（弧度）；模型本身面向 +z。 */
  readonly yaw: number;
}

export interface Point {
  readonly x: number;
  readonly z: number;
}

/** 外圍怪獸所在圓圈的半徑。 */
export const RING_RADIUS = 13.5;
/** 單隻怪獸占地半徑（建築與地標都要避開）。 */
export const MONSTER_FOOTPRINT = 3.2;
/** 東京市中央廣場半徑。 */
export const PLAZA_RADIUS = 5.6;
export const MAX_SEATS = 6;

/** 面向原點的 yaw。 */
export function facingOrigin(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

// ── 水域 ─────────────────────────────────────────

/** 海岸線：x > shoreX(z) 是東京灣（海岸大致南北走向，微微傾斜並有起伏）。 */
export function shoreX(z: number): number {
  return 12 + 0.1 * z + 0.6 * Math.sin(z * 0.45);
}

/** 隅田川：從北方流入海灣，中心線 x（只在 z < RIVER_MOUTH_Z 的區段）。 */
export const RIVER_MOUTH_Z = -3;
export const RIVER_HALF_WIDTH = 1.3;
export function riverX(z: number): number {
  return shoreX(RIVER_MOUTH_Z) + 0.35 * (z - RIVER_MOUTH_Z);
}

/** 該點（加上 margin 的安全邊界）是否落在水中。 */
export function inWater(x: number, z: number, margin = 0): boolean {
  if (x > shoreX(z) - margin) return true;
  if (z < RIVER_MOUTH_Z + margin && Math.abs(x - riverX(z)) < RIVER_HALF_WIDTH + margin)
    return true;
  return false;
}

// ── 地標 ─────────────────────────────────────────

/** 東京鐵塔：在中央廣場的西北側，怪獸站在廣場上、鐵塔在身後。 */
export const TOKYO_TOWER: Point = { x: -6.2, z: -4.8 };
export const TOKYO_TOWER_HEIGHT = 17;
/** 晴空塔：遠處隅田川東岸。 */
export const SKYTREE: Point = { x: 9, z: -23 };
export const SKYTREE_HEIGHT = 27;
/** 台場（人工島）：在海灣中，「東京灣」位置的怪獸站在這裡。 */
export const ODAIBA: Point = { x: 21.5, z: 5 };
export const ODAIBA_RADIUS = 5.6;
/** 彩虹大橋：從岸邊（芝浦）到台場。 */
export const BRIDGE_START: Point = { x: 10.8, z: -0.6 };
export const BRIDGE_END: Point = { x: 17.9, z: 2.6 };
/** 台場摩天輪（島上偏東北）。 */
export const FERRIS_WHEEL: Point = { x: 23.4, z: 2.6 };
/** 皇居的綠地與護城河（北方）。 */
export const PALACE: Point = { x: -3, z: -16 };

export const LANDMARK_CLEARANCE: readonly { at: Point; radius: number }[] = [
  { at: TOKYO_TOWER, radius: 4.4 },
  { at: SKYTREE, radius: 4 },
  { at: BRIDGE_START, radius: 4.2 },
  { at: PALACE, radius: 6.2 },
];

// ── 站位 ─────────────────────────────────────────

export const CITY_SPOT: Spot = { x: 0, z: 0.4, yaw: 0 };

export const BAY_SPOT: Spot = {
  x: ODAIBA.x - 1.2,
  z: ODAIBA.z + 0.6,
  yaw: facingOrigin(ODAIBA.x - 1.2, ODAIBA.z + 0.6),
};

/** 外圍座位排在西側（市區側）半圈，避開海灣。角度：x = cos、z = sin，90° = 南。 */
const RING_START = (75 * Math.PI) / 180;
const RING_SPAN = (210 * Math.PI) / 180;
/**
 * 東京鐵塔會擋住這段圓弧後方的怪獸（鏡頭從東南往西北看）：座位要跳過它。
 * 範圍由 occlusion.ts 的檢查得出（215°–250° 之間會被擋）。
 */
export const BLOCKED_ARC = {
  start: (212 * Math.PI) / 180,
  end: (252 * Math.PI) / 180,
} as const;

/** 座位固定對應圓圈上的位置（不隨存活人數變動，怪獸才不會跳來跳去）。 */
export function ringSpot(seat: number, playerCount: number): Spot {
  const n = Math.max(1, Math.min(MAX_SEATS, playerCount));
  // 可用圓弧 = 整段半圈扣掉被鐵塔擋住的一段；座位均分可用圓弧，再把落在缺口之後的角度補回去
  const gap = BLOCKED_ARC.end - BLOCKED_ARC.start;
  const usable = RING_SPAN - gap;
  let angle = RING_START + (usable / n) * (seat + 0.5);
  if (angle >= BLOCKED_ARC.start) angle += gap;
  const x = Math.cos(angle) * RING_RADIUS;
  const z = Math.sin(angle) * RING_RADIUS;
  return { x, z, yaw: facingOrigin(x, z) };
}

export type SceneLocation = 'city' | 'bay' | null;

/** 怪獸此刻應該站的位置。 */
export function monsterSpot(seat: number, playerCount: number, location: SceneLocation): Spot {
  if (location === 'city') return CITY_SPOT;
  if (location === 'bay') return BAY_SPOT;
  return ringSpot(seat, playerCount);
}

/** 座位顏色（卡通高飽和，輪廓用深色）。 */
export const SEAT_COLORS = [
  '#e4572e', // 紅橘
  '#3a86ff', // 藍
  '#2ec27e', // 綠
  '#ffbe0b', // 黃
  '#b565e6', // 紫
  '#ff6fb5', // 粉
] as const;

export function seatColor(seat: number): string {
  return (
    SEAT_COLORS[((seat % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length] ??
    '#ffffff'
  );
}
