import { ODAIBA, ODAIBA_RADIUS, inWater } from './layout.js';

/**
 * 怪獸在海上的站姿（純函式，不依賴 three）。
 * 沒有佔領東京的怪獸站在東京灣的海面上：會飛的懸空盤旋，會游的身體一半泡在水裡，
 * 其他怪獸涉水站立（腳部沒入水面）。位置只決定「在不在水裡」，所以跳進東京市／台場
 * 時自然回到陸地姿態。
 */
export type Stance = 'fly' | 'swim' | 'wade';

/** 依造型順序（與 roster／monsters.ts 的 BUILDERS 一致，有測試把關）。 */
export const STANCES: readonly Stance[] = [
  'wade', // 蜥蜴
  'wade', // 巨猿
  'wade', // 機甲
  'swim', // 章魚人
  'wade', // 巨蟹
  'fly', // 飛龍（有翅膀）
  'swim', // 巨龜
  'fly', // 螳螂（有翅膀）
  'wade', // 雪怪
  'wade', // 石魔
  'wade', // 蘑菇怪
  'wade', // 獨眼怪
];

export function stanceOf(archetype: number): Stance {
  const n = STANCES.length;
  return STANCES[((archetype % n) + n) % n] ?? 'wade';
}

/** 水面高度（city.ts 的海面 mesh 位置）。 */
export const WATER_Y = 0.04;

/** 各站姿在水中的高度偏移（世界單位，已含 1.3 倍怪獸縮放後的觀感）。 */
export const SEA_OFFSET = {
  /** 涉水：腳踝以下沒入水面。 */
  wade: -0.95,
  /** 游泳：身體約一半在水面下。 */
  swim: -1.9,
  /** 飛行：離開水面盤旋。 */
  fly: 2.8,
} as const;

/** 倒下時：涉水／游泳的再往下沉，飛行的墜落到水面。 */
export const KO_SINK = 1.3;

/** 這個位置算不算「海上」（0＝陸地，1＝海面）。用來決定姿態與水波。 */
export function seaness(x: number, z: number): number {
  // 台場是海灣中的人工島：島上（「東京灣」的站位）是陸地
  if (Math.hypot(x - ODAIBA.x, z - ODAIBA.z) < ODAIBA_RADIUS) return 0;
  return inWater(x, z, 0.5) ? 1 : 0;
}

/**
 * 在海上時的高度偏移。
 * @param water 0..1（平滑後的海上程度）
 * @param alive 1＝活著，0＝倒下
 */
export function seaLift(stance: Stance, water: number, alive: number, time: number): number {
  if (water <= 0) return 0;
  const bob = Math.sin(time * (stance === 'fly' ? 2.1 : 1.5));
  switch (stance) {
    case 'fly':
      // 活著時懸空並上下漂浮；倒下就墜落水面
      return water * (SEA_OFFSET.fly + 0.35 * bob) * alive;
    case 'swim':
      return water * (SEA_OFFSET.swim + 0.08 * bob - KO_SINK * (1 - alive));
    case 'wade':
      return water * (SEA_OFFSET.wade + 0.05 * bob - KO_SINK * (1 - alive));
  }
}
