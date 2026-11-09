import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@kot/rules';
import { FACE_ROTATION, cubeTransform, nextSpins, rotationOf, spinIndexes } from './dice.js';

describe('3D dice', () => {
  it('六個面各有不同朝向', () => {
    const faces = [1, 2, 3, 'attack', 'heal', 'energy'] as const;
    const keys = new Set(faces.map((f) => `${String(rotationOf(f).x)},${String(rotationOf(f).y)}`));
    expect(keys.size).toBe(6);
    expect(Object.keys(FACE_ROTATION)).toHaveLength(6);
  });

  it('轉動只加整圈，最終朝向不變', () => {
    expect(cubeTransform('attack', 0)).toBe('rotateX(0deg) rotateY(90deg)');
    expect(cubeTransform('attack', 2)).toBe('rotateX(1440deg) rotateY(1530deg)');
    expect(1530 % 360).toBe(90);
  });

  it('哪些事件會讓骰子轉動', () => {
    const events: GameEvent[] = [
      {
        type: 'dice_rolled',
        seat: 0,
        rollNumber: 2,
        dice: [1, 2, 3, 'attack', 'heal', 'energy'],
        rerolled: [1, 4],
      },
      { type: 'die_changed', seat: 0, index: 2, face: 'attack' },
      { type: 'die_rerolled', by: 1, seat: 0, index: 1, face: 3 },
      { type: 'energy_gained', seat: 0, amount: 1 },
    ];
    expect(spinIndexes(events).sort()).toEqual([1, 2, 4]);
    expect(spinIndexes([{ type: 'round_ended', round: 1 }])).toEqual([]);
  });

  it('nextSpins 累加、不改動原陣列、會擴充長度', () => {
    const prev = [0, 1];
    const events: GameEvent[] = [
      {
        type: 'dice_rolled',
        seat: 0,
        rollNumber: 1,
        dice: [1, 1, 1, 1, 1, 1],
        rerolled: [0, 1, 2, 3, 4, 5],
      },
    ];
    const next = nextSpins(prev, events);
    expect(next).toEqual([1, 2, 1, 1, 1, 1]);
    expect(prev).toEqual([0, 1]);
    expect(nextSpins(prev, [])).toEqual([0, 1]);
  });
});
