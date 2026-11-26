import { FERRIS_WHEEL, ODAIBA } from './layout.js';

/**
 * 東京灣沒開放（存活怪獸不到 5 隻）時，台場的摩天輪倒塌、壓在東京灣的站位上（純數學，不依賴 three）。
 *
 * 倒塌的演出：先吱嘎晃動 → 朝島中央加速倒下 → 落地彈跳一下後靜止。
 * 東京灣重新開放（新的一場）時，摩天輪慢慢立起來。
 */

/** 摩天輪輪心高度（站立時）。 */
export const HUB_Y = 3.9;
/** 輪面完全平躺時輪心離地的高度（實際倒下時略高，因為一側靠著支架、沒有完全平躺）。 */
export const FLAT_Y = 0.95;
/** 倒下後的輪心（世界座標）：壓在島中央偏西，蓋住東京灣的站位。 */
export const FALLEN_CENTER = { x: ODAIBA.x - 0.8, z: ODAIBA.z + 0.35 } as const;
/** 倒下時輪面繞 y 軸歪的角度（不要擺得太工整）。 */
export const FALLEN_YAW = -0.5;
/** 倒下後輪面沒有完全平躺（一側靠在斷掉的支架上）。 */
export const FALLEN_TILT = 0.1;
/** 支架往島外（北側）倒下的角度。 */
export const SUPPORT_FALL = 1.2;

/** 吱嘎晃動 → 倒下 → 彈跳 的總長（秒）。 */
export const FALL_SHAKE = 0.6;
export const FALL_DURATION = 1.3;
export const FALL_BOUNCE = 0.7;
export const FALL_TOTAL = FALL_SHAKE + FALL_DURATION + FALL_BOUNCE;
/** 重新立起來的時間（秒）。 */
export const RISE_DURATION = 1.8;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * 倒塌進度（0＝站立、1＝倒在地上）。t：從開始倒塌算起的秒數。
 * 落地（第一次到 1）後會彈回一點再落下。
 */
export function fallK(t: number): number {
  if (t <= FALL_SHAKE) return 0;
  const u = t - FALL_SHAKE;
  if (u < FALL_DURATION) return Math.pow(u / FALL_DURATION, 2.2);
  const b = clamp01((u - FALL_DURATION) / FALL_BOUNCE);
  // 落地後彈起約 7% 再落下，阻尼
  return 1 - 0.07 * Math.sin(Math.PI * b) * (1 - b);
}

/** 倒下前的晃動幅度（弧度，輪子繞 z 軸）。 */
export function shakeAmount(t: number): number {
  if (t < 0 || t >= FALL_SHAKE + 0.3) return 0;
  const grow = clamp01(t / FALL_SHAKE);
  const fade = t > FALL_SHAKE ? 1 - (t - FALL_SHAKE) / 0.3 : 1;
  return 0.05 * grow * fade * Math.sin(t * 38);
}

/** 重新立起來的進度（1＝倒下、0＝站立）：從 from 平滑回到 0。 */
export function riseK(from: number, t: number): number {
  const u = clamp01(t / RISE_DURATION);
  return from * (1 - u * u * (3 - 2 * u));
}

export interface WheelPose {
  /** 輪心位置（世界座標）。 */
  x: number;
  y: number;
  z: number;
  /** 繞 x 軸（倒向南側）與繞 y 軸（歪斜）的旋轉。 */
  rotX: number;
  rotY: number;
  /** 支架（以支架底部為軸）倒向北側的角度與歪斜。 */
  supportRotX: number;
  supportRotY: number;
}

/** 摩天輪與支架在倒塌進度 k（0..1）時的姿態。 */
export function wheelPose(k: number): WheelPose {
  const c = clamp01(k);
  const rotX = (Math.PI / 2 - FALLEN_TILT) * c;
  return {
    x: FERRIS_WHEEL.x + (FALLEN_CENTER.x - FERRIS_WHEEL.x) * c,
    // 輪心高度跟著輪面的立起程度走：轉動過程中輪緣最低點永遠不會鑽進地面
    y: HUB_Y + (FLAT_Y - HUB_Y) * (1 - Math.cos(rotX)),
    z: FERRIS_WHEEL.z + (FALLEN_CENTER.z - FERRIS_WHEEL.z) * c,
    rotX,
    rotY: FALLEN_YAW * c,
    supportRotX: -SUPPORT_FALL * c,
    supportRotY: 0.3 * c,
  };
}
