/** OQ-C3：Discard 卡造成的傷害，受害者可以使用減傷／反應能力；卡牌傷害不是攻擊，不能讓位。 */
import { describe, expect, it } from 'vitest';
import { applyAction } from './engine.js';
import { checkInvariants } from './invariants.js';
import { currentActor, legalActions } from './legal.js';
import { cloneState } from './state.js';
import { card, makeEnv, makeState, mon, must } from './test-utils.js';
import type { CardDef } from './cards/types.js';
import type { GameState, Monster } from './types.js';

const ins = (id: string, cost: number, ...ops: object[]): CardDef =>
  card(id, 'instant', { cost, params: { ops: ops as never } });

function shop(defs: CardDef[], players: number, monsters: Record<number, Partial<Monster>>) {
  const env = makeEnv(...defs);
  const state = makeState({ players, env, faceUp: ['blast'], deck: [], monsters });
  const buy: GameState = cloneState(state);
  buy.phase = 'buy';
  return { env, state: buy };
}

const BLAST = ins('blast', 3, { op: 'damageOthers', n: 2 });
const BOMB = ins('blast', 3, { op: 'damageAll', n: 2 });

describe('OQ-C3 卡牌傷害的反應詢問', () => {
  it('受害者有可用的反應：買牌後先詢問，使用後免傷，其餘目標照常受傷，結束後回到買牌階段', () => {
    const { env, state } = shop([BLAST, card('w', 'wings')], 3, {
      0: { energy: 5 },
      1: { cards: ['w'], energy: 5 },
    });
    let r = must(state, { type: 'buy', seat: 0, cardId: 'blast' }, env);
    expect(r.state.phase).toBe('prompt');
    expect(r.state.pending).toMatchObject({ kind: 'react', seat: 1, resume: 'market' });
    expect(currentActor(r.state)).toBe(1);
    expect(mon(r.state, 1).hp).toBe(10);
    expect(mon(r.state, 2).hp).toBe(10); // 還沒處理到
    expect(
      legalActions(r.state, env).some((a) => a.type === 'reactDecision' && a.cardId === 'w'),
    ).toBe(true);
    r = must(r.state, { type: 'reactDecision', seat: 1, cardId: 'w' }, env);
    expect(mon(r.state, 1)).toMatchObject({ hp: 10, energy: 3 });
    expect(mon(r.state, 2).hp).toBe(8);
    expect(r.state.phase).toBe('buy');
    expect(r.state.pending).toBeNull();
    expect(currentActor(r.state)).toBe(0);
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('不使用反應：照常受傷', () => {
    const { env, state } = shop([BLAST, card('w', 'wings')], 3, {
      0: { energy: 5 },
      1: { cards: ['w'], energy: 5 },
    });
    let r = must(state, { type: 'buy', seat: 0, cardId: 'blast' }, env);
    r = must(r.state, { type: 'reactDecision', seat: 1, cardId: null }, env);
    expect(mon(r.state, 1).hp).toBe(8);
    expect(mon(r.state, 2).hp).toBe(8);
    expect(r.state.phase).toBe('buy');
  });

  it('沒有可用反應（能量不足）：不詢問，直接受傷', () => {
    const { env, state } = shop([BLAST, card('w', 'wings')], 3, {
      0: { energy: 5 },
      1: { cards: ['w'], energy: 1 },
    });
    const r = must(state, { type: 'buy', seat: 0, cardId: 'blast' }, env);
    expect(r.state.phase).toBe('buy');
    expect(mon(r.state, 1).hp).toBe(8);
  });

  it('傷害到所有怪獸時，買家自己也可以反應', () => {
    const { env, state } = shop([BOMB, card('w', 'wings')], 2, {
      0: { cards: ['w'], energy: 6 },
    });
    let r = must(state, { type: 'buy', seat: 0, cardId: 'blast' }, env);
    expect(r.state.pending).toMatchObject({ kind: 'react', seat: 0 });
    r = must(r.state, { type: 'reactDecision', seat: 0, cardId: 'w' }, env);
    expect(mon(r.state, 0).hp).toBe(10);
    expect(mon(r.state, 1).hp).toBe(8);
  });

  it('卡牌傷害不是攻擊：東京內的怪獸受傷也不會被詢問讓位', () => {
    const { env, state } = shop([BLAST], 3, { 0: { energy: 5 }, 1: { location: 'city' } });
    const r = must(state, { type: 'buy', seat: 0, cardId: 'blast' }, env);
    expect(mon(r.state, 1).hp).toBe(8);
    expect(r.state.phase).toBe('buy');
    expect(r.state.pending).toBeNull();
    expect(r.events.some((e) => e.type === 'yield_requested')).toBe(false);
  });

  it('傷害讓遊戲結束：不再詢問，立刻結束', () => {
    const { env, state } = shop([BLAST, card('w', 'wings')], 2, {
      0: { energy: 5 },
      1: { hp: 2 },
    });
    const r = must(state, { type: 'buy', seat: 0, cardId: 'blast' }, env);
    expect(r.state.phase).toBe('over');
    expect(r.state.outcome?.winners).toEqual([0]);
  });

  it('買牌的傷害讓目前回合的買家自己死亡：回合順利結束，不卡在買牌階段', () => {
    const { env, state } = shop([ins('blast', 3, { op: 'damageAll', n: 2 })], 3, {
      0: { energy: 5, hp: 2 },
    });
    const r = must(state, { type: 'buy', seat: 0, cardId: 'blast' }, env);
    expect(mon(r.state, 0).alive).toBe(false);
    expect(r.state.turn.seat).not.toBe(0);
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('反應詢問期間不能買牌或結束回合', () => {
    const { env, state } = shop([BLAST, card('w', 'wings')], 3, {
      0: { energy: 9 },
      1: { cards: ['w'], energy: 5 },
    });
    const r = must(state, { type: 'buy', seat: 0, cardId: 'blast' }, env);
    expect(applyAction(r.state, { type: 'endTurn', seat: 0 }, env).ok).toBe(false);
  });
});
