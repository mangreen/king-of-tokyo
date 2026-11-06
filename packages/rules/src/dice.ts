import { nextInt } from './rng.js';
import type { RngState } from './rng.js';
import { FACES } from './types.js';
import type { Face } from './types.js';

/** 擲一顆骰子。 */
export function rollDie(rng: RngState): [face: Face, nextRng: RngState] {
  const [index, next] = nextInt(rng, FACES.length);
  return [FACES[index] as Face, next];
}

/** 統計各面的數量。 */
export function countFaces(dice: readonly Face[]): Record<string, number> {
  const counts: Record<string, number> = { '1': 0, '2': 0, '3': 0, energy: 0, attack: 0, heal: 0 };
  for (const face of dice) {
    counts[String(face)] = (counts[String(face)] ?? 0) + 1;
  }
  return counts;
}

/**
 * 數字面的 VP。R-DICE-04
 * 三顆相同的 N 得 N 分；每多一顆相同的再 +1。不足三顆得 0。
 */
export function numberVp(dice: readonly Face[]): number {
  let total = 0;
  for (const n of [1, 2, 3] as const) {
    const count = dice.filter((face) => face === n).length;
    if (count >= 3) {
      total += n + (count - 3);
    }
  }
  return total;
}
