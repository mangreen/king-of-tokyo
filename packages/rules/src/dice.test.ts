import { describe, expect, it } from 'vitest';
import { countFaces, numberVp, rollDie } from './dice.js';
import { FACES } from './types.js';
import type { Face } from './types.js';

describe('R-DICE-04 數字面的 VP', () => {
  const cases: [Face[], number][] = [
    [[1, 1, 1, 'attack', 'heal', 'energy'], 1],
    [[2, 2, 2, 'attack', 'heal', 'energy'], 2],
    [[3, 3, 3, 'attack', 'heal', 'energy'], 3],
    [[2, 2, 2, 2, 'energy', 'attack'], 3], // G-02：三顆 2 得 2，多一顆 +1
    [[3, 3, 3, 3, 3, 3], 6], // 六顆 3：3 + 3
    [[1, 1, 2, 2, 3, 3], 0], // 不足三顆不得分
    [[1, 1, 1, 2, 2, 2], 3], // 1 + 2，兩組同時得分
    [['attack', 'attack', 'attack', 'attack', 'attack', 'attack'], 0],
  ];
  it.each(cases)('%j → %i VP', (dice, expected) => {
    expect(numberVp(dice)).toBe(expected);
  });
});

describe('countFaces', () => {
  it('統計每一面的數量', () => {
    expect(countFaces([1, 1, 'attack', 'heal', 'energy', 'energy'])).toEqual({
      '1': 2,
      '2': 0,
      '3': 0,
      energy: 2,
      attack: 1,
      heal: 1,
    });
  });
});

describe('R-DICE-03 骰面', () => {
  it('rollDie 只會擲出六種面，且每種都出現', () => {
    let rng = 42;
    const seen = new Set<Face>();
    for (let i = 0; i < 300; i += 1) {
      const [face, next] = rollDie(rng);
      rng = next;
      expect(FACES).toContain(face);
      seen.add(face);
    }
    expect(seen.size).toBe(6);
  });
});
