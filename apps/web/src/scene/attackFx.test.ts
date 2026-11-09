import { describe, expect, it } from 'vitest';
import { MONSTER_COUNT } from '@kot/protocol';
import { attackStyleOf, planAttack, STYLE_BY_KIND, type AttackStyle } from './attackFx.js';

const STYLES: readonly AttackStyle[] = STYLE_BY_KIND;

describe('attackFx', () => {
  it('每種怪獸造型各有不同的招式，且與造型數量一致', () => {
    expect(STYLE_BY_KIND).toHaveLength(MONSTER_COUNT);
    expect(new Set(STYLE_BY_KIND).size).toBe(MONSTER_COUNT);
    for (let kind = 0; kind < MONSTER_COUNT; kind++) {
      expect(attackStyleOf(kind)).toBe(STYLE_BY_KIND[kind]);
    }
    expect(attackStyleOf(99)).toBe('slam');
  });

  it('光柱型招式有顏色與時間；搥地／爪擊沒有光柱', () => {
    for (const s of STYLES) {
      const p = planAttack(s, 'medium');
      expect(p.impactDelay).toBeGreaterThan(0);
      expect(p.impactDelay).toBeLessThan(0.5);
      if (['slam', 'claw', 'scythe', 'quake'].includes(s)) expect(p.beam).toBeNull();
      else {
        expect(p.beam?.dur).toBeGreaterThan(0.2);
        expect(p.beam?.color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
    expect(planAttack('claw', 'medium').burst.slash).toBe(true);
    expect(planAttack('scythe', 'medium').burst.slashColor).toMatch(/^#/);
    expect(planAttack('slam', 'medium').burst.crack).toBe(true);
    expect(planAttack('quake', 'medium').burst.crack).toBe(true);
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
