import { describe, expect, it } from 'vitest';
import { MONSTER_NAMES } from './roster.js';
import { BAY_SPOT, CITY_SPOT, MAX_SEATS, monsterSpot } from './layout.js';
import { KO_SINK, SEA_OFFSET, STANCES, seaLift, seaness, stanceOf } from './seaStance.js';

describe('海上站姿', () => {
  it('站姿表與怪獸名冊一一對應', () => {
    expect(STANCES).toHaveLength(MONSTER_NAMES.length);
  });

  it('飛行的是有翅膀的飛龍與螳螂；章魚人、巨龜游泳；其餘涉水', () => {
    const named = (s: string): number[] =>
      STANCES.flatMap((x, i) => (x === s ? [MONSTER_NAMES[i] ?? '?'] : [])).map((_, i) => i);
    expect(STANCES.map((s, i) => [MONSTER_NAMES[i], s]).filter(([, s]) => s === 'fly')).toEqual([
      ['飛龍', 'fly'],
      ['螳螂', 'fly'],
    ]);
    expect(STANCES.map((s, i) => [MONSTER_NAMES[i], s]).filter(([, s]) => s === 'swim')).toEqual([
      ['章魚人', 'swim'],
      ['巨龜', 'swim'],
    ]);
    expect(named('wade').length).toBe(8);
    expect(stanceOf(5)).toBe('fly');
    expect(stanceOf(5 + STANCES.length)).toBe('fly');
    expect(stanceOf(-1)).toBe(STANCES[STANCES.length - 1]);
  });

  it('seaness：沒佔領東京的座位在海上，東京市與台場（東京灣）在陸地', () => {
    for (let n = 1; n <= MAX_SEATS; n++) {
      for (let seat = 0; seat < n; seat++) {
        const s = monsterSpot(seat, n, null);
        expect(seaness(s.x, s.z)).toBe(1);
      }
    }
    expect(seaness(CITY_SPOT.x, CITY_SPOT.z)).toBe(0);
    expect(seaness(BAY_SPOT.x, BAY_SPOT.z)).toBe(0);
  });

  it('陸地上完全沒有偏移（跳回東京市時恢復原樣）', () => {
    for (const st of ['fly', 'swim', 'wade'] as const) {
      expect(seaLift(st, 0, 1, 3.3)).toBe(0);
    }
  });

  it('海上：飛行懸空（高於水面）、涉水與游泳沉入水面以下，游泳比涉水更深', () => {
    for (let t = 0; t < 10; t += 0.37) {
      expect(seaLift('fly', 1, 1, t)).toBeGreaterThan(1.5);
      expect(seaLift('wade', 1, 1, t)).toBeLessThan(-0.5);
      expect(seaLift('swim', 1, 1, t)).toBeLessThan(seaLift('wade', 1, 1, t) - 0.5);
    }
    expect(SEA_OFFSET.fly).toBeGreaterThan(0);
  });

  it('倒下：飛行的墜落到水面，涉水／游泳的再往下沉', () => {
    expect(seaLift('fly', 1, 0, 1.2)).toBe(0);
    expect(seaLift('wade', 1, 0, 0)).toBeCloseTo(seaLift('wade', 1, 1, 0) - KO_SINK, 10);
    expect(seaLift('swim', 1, 0, 0)).toBeCloseTo(seaLift('swim', 1, 1, 0) - KO_SINK, 10);
  });

  it('過渡中（0 < 海上程度 < 1）偏移連續，不會瞬間跳動', () => {
    const half = seaLift('fly', 0.5, 1, 0);
    expect(half).toBeCloseTo(seaLift('fly', 1, 1, 0) / 2, 10);
  });
});
