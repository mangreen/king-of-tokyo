import type { Face, GameEvent } from '@kot/rules';

/**
 * 3D 骰子（CSS 3D 立方體）。擲骰結果永遠由伺服器決定，動畫只是「轉到那一面」。
 * 純邏輯在這裡：面 → 立方體朝向、事件 → 哪幾顆骰子要轉。
 */

/** 要讓某一面朝向觀看者時，立方體需要的旋轉角（度）。 */
export const FACE_ROTATION: Record<string, { x: number; y: number }> = {
  '1': { x: 0, y: 0 },
  '2': { x: 0, y: 180 },
  '3': { x: 0, y: -90 },
  attack: { x: 0, y: 90 },
  heal: { x: -90, y: 0 },
  energy: { x: 90, y: 0 },
};

export function rotationOf(face: Face): { x: number; y: number } {
  return FACE_ROTATION[String(face)] ?? { x: 0, y: 0 };
}

/** 每次旋轉多繞兩整圈（720 的倍數不改變最終朝向）。 */
export function cubeTransform(face: Face, spin: number): string {
  const r = rotationOf(face);
  return `rotateX(${String(r.x + 720 * spin)}deg) rotateY(${String(r.y + 720 * spin)}deg)`;
}

/** 這批事件讓哪些骰子重新「轉」：重擲、卡牌改骰、他人重擲。 */
export function spinIndexes(events: readonly GameEvent[]): number[] {
  const out = new Set<number>();
  for (const e of events) {
    if (e.type === 'dice_rolled') for (const i of e.rerolled) out.add(i);
    else if (e.type === 'die_changed' || e.type === 'die_rerolled') out.add(e.index);
  }
  return [...out];
}

/** 把本批事件累加到每顆骰子的轉動次數（不可變）。 */
export function nextSpins(prev: readonly number[], events: readonly GameEvent[]): number[] {
  const idx = spinIndexes(events);
  if (idx.length === 0) return [...prev];
  const next = [...prev];
  for (const i of idx) {
    while (next.length <= i) next.push(0);
    next[i] = (next[i] ?? 0) + 1;
  }
  return next;
}
