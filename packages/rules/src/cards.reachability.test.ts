import { describe, expect, it } from 'vitest';
import { CAP, EFFECTS } from './cards/effects.js';
import { cloneState } from './state.js';
import { legalActions } from './legal.js';
import { card, makeEnv, makeState } from './test-utils.js';

/**
 * 卡牌「可觸發性」稽核：每一個 effectId 都必須至少有一個會被引擎呼叫的觸發點，
 * 否則買了也不會有任何效果（永遠無法被觸發的卡）。
 */
describe('卡牌可觸發性稽核', () => {
  const caps = new Set<string>(Object.values(CAP));
  const META = new Set(['kind', 'requiredParams', 'initialCharges']);

  it('每個 effectId 都有至少一個觸發 hook，或是引擎直接辨識的能力開關（CAP）', () => {
    const dead = Object.entries(EFFECTS)
      .filter(([id, e]) => !caps.has(id) && Object.keys(e).every((k) => META.has(k)))
      .map(([id]) => id);
    expect(dead).toEqual([]);
  });
});

describe('寄生觸手（buy_from_others）：買牌階段列出別人持有的 Keep 卡', () => {
  const env = makeEnv(
    card('parasite', 'buy_from_others', { cost: 4 }),
    card('armor', 'armor', { cost: 4 }),
    card('inst', 'instant', { cost: 1, params: { ops: [{ op: 'vp', n: 1 }] } }),
    card('x', 'instant', { cost: 1, params: { ops: [{ op: 'vp', n: 1 }] } }),
  );
  const buyPhase = (energy: number, mine: string[]) => {
    const s = cloneState(
      makeState({
        players: 2,
        env,
        faceUp: ['x'],
        deck: [],
        monsters: { 0: { cards: mine, energy }, 1: { cards: ['armor'] } },
      }),
    );
    s.phase = 'buy';
    return s;
  };

  it('持有寄生觸手且買得起：出現 from=對手 的購買動作', () => {
    const acts = legalActions(buyPhase(5, ['parasite']), env);
    expect(acts).toContainEqual({ type: 'buy', seat: 0, cardId: 'armor', from: 1 });
  });

  it('買不起、或沒有寄生觸手：不出現', () => {
    expect(
      legalActions(buyPhase(3, ['parasite']), env).some((a) => a.type === 'buy' && a.from === 1),
    ).toBe(false);
    expect(legalActions(buyPhase(9, []), env).some((a) => a.type === 'buy' && a.from === 1)).toBe(
      false,
    );
  });
});
