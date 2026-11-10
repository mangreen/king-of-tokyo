/** 同時淘汰：反射傷害讓攻擊者先倒下時，HP 已歸零但尚未結算的受害者不能被判為勝者。 */
import { describe, expect, it } from 'vitest';
import { checkInvariants } from './invariants.js';
import { cloneState } from './state.js';
import { card, makeEnv, makeState, mon, must } from './test-utils.js';
import type { CardDef } from './cards/types.js';

const BLAST: CardDef = card('blast', 'instant', {
  cost: 3,
  params: { ops: [{ op: 'damageOthers', n: 2 }] as never },
});

describe('同時淘汰', () => {
  it('買牌傷害打死帶反射的對手、反射又打死自己：兩人都出局，結果是全員淘汰', () => {
    const env = makeEnv(BLAST, card('mirror', 'reflect', { cost: 6, params: { n: 1 } }));
    const base = makeState({
      players: 2,
      env,
      faceUp: ['blast'],
      deck: [],
      monsters: { 0: { energy: 5, hp: 1 }, 1: { cards: ['mirror'], hp: 1 } },
    });
    const state = cloneState(base);
    state.phase = 'buy';
    let r = must(state, { type: 'buy', seat: 0, cardId: 'blast' }, env);
    // 受害者有反應能力時會先詢問；不使用
    if (r.state.phase === 'prompt') {
      r = must(r.state, { type: 'reactDecision', seat: 1, cardId: null }, env);
    }
    expect(mon(r.state, 0).alive).toBe(false);
    expect(mon(r.state, 1).alive).toBe(false);
    expect(r.state.phase).toBe('over');
    expect(r.state.outcome).toEqual({ winners: [], reason: 'allEliminated' });
    expect(checkInvariants(r.state)).toEqual([]);
  });
});
