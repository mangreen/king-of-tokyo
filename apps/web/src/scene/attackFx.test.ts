import { describe, expect, it } from 'vitest';
import { archetypeOf } from './monsters.js';
import { attackStyleOf, planAttack, STYLE_BY_ARCHETYPE, type AttackStyle } from './attackFx.js';

const STYLES: AttackStyle[] = ['breath', 'slam', 'laser', 'ink', 'claw', 'fire'];

describe('attackFx', () => {
  it('六種造型各有不同的招式', () => {
    expect(new Set(STYLE_BY_ARCHETYPE).size).toBe(6);
    const seen = new Set<AttackStyle>();
    for (let seat = 0; seat < 6; seat++) seen.add(attackStyleOf(seat));
    expect(seen.size).toBe(6);
    expect(attackStyleOf(2)).toBe(STYLE_BY_ARCHETYPE[archetypeOf(2)]);
  });

  it('光柱型招式有顏色與時間；搥地／爪擊沒有光柱', () => {
    for (const s of STYLES) {
      const p = planAttack(s, 'medium');
      expect(p.impactDelay).toBeGreaterThan(0);
      expect(p.impactDelay).toBeLessThan(0.5);
      if (s === 'slam' || s === 'claw') expect(p.beam).toBeNull();
      else {
        expect(p.beam?.dur).toBeGreaterThan(0.2);
        expect(p.beam?.color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
    expect(planAttack('claw', 'medium').burst.slash).toBe(true);
    expect(planAttack('slam', 'medium').burst.crack).toBe(true);
  });

  it('越重的攻擊越強（粒子數、衝擊波、震動）', () => {
    for (const s of STYLES) {
      const light = planAttack(s, 'light').burst;
      const heavy = planAttack(s, 'heavy').burst;
      expect(heavy.shake).toBeGreaterThan(light.shake);
      const count = (b: typeof light): number => b.dust.reduce((n, d) => n + d.count, 0);
      expect(count(heavy)).toBeGreaterThanOrEqual(count(light));
    }
  });
});
