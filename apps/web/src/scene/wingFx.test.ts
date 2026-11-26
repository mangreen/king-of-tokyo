import { describe, expect, it } from 'vitest';
import { MONSTER_COUNT } from '@kot/protocol';
import { MONSTER_NAMES } from './roster.js';
import { buildMonster } from './monsters.js';
import { STANCES } from './seaStance.js';
import { BUZZ_RATE, FLAP_RATE, WING_POSE, WING_STYLES, wingAngle, wingStyleOf } from './wingFx.js';

/** 取樣一段時間內的角度範圍。 */
function range(style: 'flap' | 'buzz', flying: number, alive = 1): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 4000; i++) {
    const a = wingAngle(style, i * 0.002, flying, alive);
    lo = Math.min(lo, a);
    hi = Math.max(hi, a);
  }
  return [lo, hi];
}

describe('翅膀拍動', () => {
  it('飛龍與螳螂有拍翅風格，其餘沒有', () => {
    expect(wingStyleOf(5)).toBe('flap');
    expect(wingStyleOf(7)).toBe('buzz');
    expect(MONSTER_NAMES[5]).toBe('飛龍');
    expect(MONSTER_NAMES[7]).toBe('螳螂');
    for (let k = 0; k < MONSTER_COUNT; k++) {
      if (k !== 5 && k !== 7) expect(wingStyleOf(k)).toBeNull();
    }
  });

  it('只有站姿是「飛」的造型有翅膀部位，且與拍翅風格一一對應', () => {
    for (let kind = 0; kind < MONSTER_COUNT; kind++) {
      const rig = buildMonster(kind, 0, 12);
      const flies = STANCES[kind] === 'fly';
      expect(rig.wingL !== null, MONSTER_NAMES[kind]).toBe(flies);
      expect(rig.wingR !== null, MONSTER_NAMES[kind]).toBe(flies);
      expect(wingStyleOf(kind) !== null, MONSTER_NAMES[kind]).toBe(flies);
      rig.dispose();
    }
    expect(Object.keys(WING_STYLES)).toHaveLength(2);
  });

  it('飛行時兩種翅膀的拍動幅度與速度各有特色：飛龍幅度大而慢，螳螂幅度小而快', () => {
    const [fLo, fHi] = range('flap', 1);
    const [bLo, bHi] = range('buzz', 1);
    expect(fHi - fLo).toBeGreaterThan(1.2);
    expect(bHi - bLo).toBeGreaterThan(0.4);
    expect(bHi - bLo).toBeLessThan(fHi - fLo);
    expect(BUZZ_RATE).toBeGreaterThan(FLAP_RATE * 5);
  });

  it('實際在動：同一時段內螳螂的翅膀換向次數遠多於飛龍', () => {
    const flips = (style: 'flap' | 'buzz'): number => {
      let n = 0;
      let prev = 0;
      let last = wingAngle(style, 0, 1, 1);
      for (let i = 1; i <= 1000; i++) {
        const a = wingAngle(style, i * 0.001, 1, 1);
        const d = a - last;
        if (prev !== 0 && Math.sign(d) !== Math.sign(prev) && d !== 0) n++;
        if (d !== 0) prev = d;
        last = a;
      }
      return n;
    };
    expect(flips('buzz')).toBeGreaterThan(flips('flap') * 5);
    expect(flips('flap')).toBeGreaterThanOrEqual(2);
  });

  it('不在飛行或倒下時收翅：只剩極輕微的起伏', () => {
    for (const style of ['flap', 'buzz'] as const) {
      const rest = WING_POSE[style].rest;
      const [lo, hi] = range(style, 0);
      expect(hi - lo).toBeLessThan(0.08);
      expect(Math.abs((lo + hi) / 2 - rest)).toBeLessThan(0.05);
      const [dLo, dHi] = range(style, 1, 0);
      expect(dHi - dLo).toBeLessThan(0.08);
    }
  });

  it('飛行程度平滑過渡（幅度隨 flying 增加）', () => {
    for (const style of ['flap', 'buzz'] as const) {
      const w = (f: number): number => {
        const [lo, hi] = range(style, f);
        return hi - lo;
      };
      expect(w(0.5)).toBeGreaterThan(w(0.1));
      expect(w(1)).toBeGreaterThan(w(0.5));
    }
  });
});
