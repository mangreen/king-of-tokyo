/**
 * 翅膀動畫（純函式，不依賴 three）。
 *
 * 會飛的怪獸依各自的特性拍翅：
 * - flap（飛龍）：厚重的大翅膀，約每秒一下，下拍有力、上舉較慢。
 * - buzz（螳螂）：薄翅高速震動，約每秒 10 下，幅度小。
 *
 * 角度採「向上為正」：左翼 rotation.z = a、右翼 rotation.z = -a（左右鏡像）。
 * 不在飛行時（站在東京市、倒下）翅膀收起：飛龍垂在身側，螳螂向上併攏。
 */
export type WingStyle = 'flap' | 'buzz';

/** 造型順序同 monsters.ts 的 BUILDERS（有測試把關：有翅膀部位的造型一定有拍翅風格）。 */
export const WING_STYLES: Readonly<Record<number, WingStyle>> = {
  5: 'flap', // 飛龍
  7: 'buzz', // 螳螂
};

export function wingStyleOf(archetype: number): WingStyle | null {
  return WING_STYLES[archetype] ?? null;
}

/** 拍翅角速度（弧度／秒）。 */
export const FLAP_RATE = 6.4;
export const BUZZ_RATE = 64;

/** 收起的角度與飛行時的中心角度、振幅。 */
export const WING_POSE = {
  flap: { rest: -0.85, center: 0.18, amp: 0.78 },
  buzz: { rest: 1.25, center: 0.42, amp: 0.3 },
} as const;

/**
 * 翅膀此刻的角度。
 * @param flying 0..1：飛行程度（平滑；0＝收翅）
 * @param alive 1＝活著，0＝倒下（翅膀垂下收起）
 */
export function wingAngle(style: WingStyle, time: number, flying: number, alive: number): number {
  const pose = WING_POSE[style];
  const f = Math.max(0, Math.min(1, flying)) * Math.max(0, Math.min(1, alive));
  // 收翅時只有極輕微的呼吸般起伏
  const idle = 0.03 * Math.sin(time * 1.9);
  if (style === 'flap') {
    const x = time * FLAP_RATE;
    // 下拍快、上舉慢：疊一點二倍頻
    const stroke = Math.sin(x) + 0.22 * Math.sin(2 * x + 0.6);
    return pose.rest + idle * (1 - f) + (pose.center - pose.rest) * f + pose.amp * f * stroke;
  }
  const stroke = Math.sin(time * BUZZ_RATE);
  return pose.rest + idle * (1 - f) + (pose.center - pose.rest) * f + pose.amp * f * stroke;
}
