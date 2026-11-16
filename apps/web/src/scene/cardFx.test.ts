import { Group } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CardDef } from '@kot/rules';
import originalCardSet from '../../../../card-sets/original/set.json';
import { THEME_STYLE, themeOf, type CardTheme } from './cardFx.js';
import { CardFxSystem } from './cardShow.js';

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

describe('煙霧彈與擲骰類卡牌的主題', () => {
  const themeById = (id: string): CardTheme | undefined => {
    const c = cards.find((x) => x.id === id);
    return c ? themeOf(c) : undefined;
  };

  it('煙霧彈用專屬的煙幕主題；其他換擲骰機會的卡是骰子主題', () => {
    expect(themeById('o-smoke-bomb')).toBe('smoke');
    expect(themeById('o-mind-link')).toBe('dice');
  });

  it('煙幕特效：噴出煙霧粒子（不會丟例外），其他主題也都能播', () => {
    const emit = vi.fn();
    const burst = vi.fn();
    const fire = vi.fn();
    const deps = {
      dust: { emit },
      debris: { burst },
      waves: { fire },
      shields: { pop: vi.fn() },
      faces: {},
      scale: () => 1,
      shake: vi.fn(),
    } as never;
    const fx = new CardFxSystem(new Group(), deps);
    const spot = { x: 0, z: 0 };
    fx.play('smoke', spot, [spot], [spot]);
    expect(emit).toHaveBeenCalled();
    expect(fire).toHaveBeenCalled();
    for (const theme of Object.keys(THEME_STYLE) as CardTheme[]) {
      expect(() => {
        fx.play(theme, spot, [spot], [spot]);
      }).not.toThrow();
    }
  });
});
