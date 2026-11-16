import { describe, expect, it } from 'vitest';
import type { CardDef } from '@kot/rules';
import originalCardSet from '../../../../card-sets/original/set.json';
import { THEME_STYLE, themeOf, type CardTheme } from './cardFx.js';

const cards = (originalCardSet as { cards: CardDef[] }).cards;
const instant = (ops: unknown[]): Pick<CardDef, 'kind' | 'effectId' | 'params'> => ({
  kind: 'discard',
  effectId: 'instant',
  params: { ops: ops as never },
});

describe('themeOf', () => {
  it('即時效果：依主要步驟決定主題', () => {
    expect(themeOf(instant([{ op: 'damageAll', n: 3 }]))).toBe('meteor');
    expect(themeOf(instant([{ op: 'damageOthers', n: 2 }]))).toBe('acid');
    expect(
      themeOf(
        instant([
          { op: 'damageOthers', n: 2 },
          { op: 'vp', n: 1 },
        ]),
      ),
    ).toBe('blast');
    expect(themeOf(instant([{ op: 'takeTokyo' }]))).toBe('tokyo');
    expect(themeOf(instant([{ op: 'extraTurn' }]))).toBe('extra');
    expect(themeOf(instant([{ op: 'othersLoseVp', n: 2 }]))).toBe('drain');
    expect(themeOf(instant([{ op: 'energy', n: 9 }]))).toBe('bolt');
    expect(themeOf(instant([{ op: 'heal', n: 2 }]))).toBe('heal');
    expect(themeOf(instant([{ op: 'vp', n: 4 }]))).toBe('stars');
    expect(themeOf(instant([]))).toBe('generic');
  });

  it('持續效果依效果 id；未知的退回通用', () => {
    expect(themeOf({ kind: 'keep', effectId: 'armor', params: {} })).toBe('shield');
    expect(themeOf({ kind: 'keep', effectId: 'wings', params: {} })).toBe('wings');
    expect(themeOf({ kind: 'keep', effectId: 'no_such_effect', params: {} })).toBe('generic');
    expect(themeOf(undefined)).toBe('generic');
  });

  it('原創卡組：每張牌都有專屬主題（沒有掉到通用）', () => {
    const generic = cards.filter((c) => themeOf(c) === 'generic').map((c) => c.id);
    expect(generic).toEqual([]);
  });

  it('每個主題都有樣式', () => {
    const used = new Set<CardTheme>(cards.map(themeOf));
    for (const t of used) expect(THEME_STYLE[t].color).toMatch(/^#/);
    expect(used.size).toBeGreaterThanOrEqual(10);
  });
});
