import { MONSTER_COUNT } from '@kot/protocol';

/**
 * 怪獸名冊（不含 three.js，HUD 可以直接用）。造型順序要與 monsters.ts／monstersExtra.ts 的
 * 建造函式、attackFx.ts 的招式順序一致（有測試把關）。名字只描述造型，不是任何既有角色。
 */
export const MONSTER_NAMES = [
  '蜥蜴',
  '巨猿',
  '機甲',
  '章魚人',
  '巨蟹',
  '飛龍',
  '巨龜',
  '螳螂',
  '雪怪',
  '石魔',
  '蘑菇怪',
  '獨眼怪',
] as const;

export const MONSTER_KINDS = MONSTER_NAMES.length;

/** 這個座位的怪獸造型：伺服器有分配就用分配的，否則（舊伺服器／示範）依座位輪流。 */
export function monsterKindOf(seat: number, assigned: number | null | undefined): number {
  const n = MONSTER_COUNT;
  if (typeof assigned === 'number' && Number.isInteger(assigned) && assigned >= 0 && assigned < n) {
    return assigned;
  }
  return ((seat % n) + n) % n;
}

export function monsterName(kind: number): string {
  return MONSTER_NAMES[kind] ?? '怪獸';
}
