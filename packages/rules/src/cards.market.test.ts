import { describe, expect, it } from 'vitest';
import { applyAction } from './engine.js';
import { checkInvariants } from './invariants.js';
import { createGame, defaultConfig } from './state.js';
import { card, makeEnv, makeState, mon, must, resolveWith } from './test-utils.js';
import type { Face } from './types.js';

const A: Face = 'attack';
const E: Face = 'energy';

const env = makeEnv(
  card('c1', 'instant', { cost: 3, params: { ops: [{ op: 'vp', n: 2 }] } }),
  card('c2', 'instant', { cost: 5, params: { ops: [{ op: 'energy', n: 1 }] } }),
  card('c3', 'extra_dice', { cost: 4 }),
  card('c4', 'instant', { cost: 2, params: { ops: [{ op: 'vp', n: 1 }] } }),
  card('c5', 'instant', { cost: 1, params: { ops: [{ op: 'vp', n: 1 }] } }),
  card('c6', 'instant', { cost: 1, params: { ops: [{ op: 'vp', n: 1 }] } }),
  card('c7', 'instant', { cost: 1, params: { ops: [{ op: 'vp', n: 1 }] } }),
);

function shop(extra: Parameters<typeof makeState>[0] extends infer T ? Partial<T> : never = {}) {
  return makeState({
    players: 3,
    env,
    faceUp: ['c1', 'c2', 'c3'],
    deck: ['c4', 'c5', 'c6', 'c7'],
    ...extra,
  });
}

/** 沒有人在東京、擲出的骰子不產生任何效果，走到買牌階段。 */
function toBuyPhase(state = shop({ monsters: { 0: { energy: 10 } } })) {
  return resolveWith(state, [1, 2, 'heal', 'heal', 1, 2], env).state;
}

describe('R-CARD-10 牌庫與開局', () => {
  it('開局洗牌並翻開 3 張，其餘在牌庫；同一個 seed 結果相同', () => {
    const a = createGame(defaultConfig(3), 11, env);
    const b = createGame(defaultConfig(3), 11, env);
    expect(a.state.market?.faceUp).toHaveLength(3);
    expect(a.state.market?.deck).toHaveLength(4);
    expect(a.state).toEqual(b.state);
    expect(a.events.filter((e) => e.type === 'card_revealed')).toHaveLength(3);
    const all = [...(a.state.market?.faceUp ?? []), ...(a.state.market?.deck ?? [])].sort();
    expect(all).toEqual(Object.keys(env.cards).sort());
  });

  it('沒有卡牌組時沒有商店，回合與 M1 相同（沒有買牌階段）', () => {
    const { state } = createGame(defaultConfig(3), 1);
    expect(state.market).toBeNull();
    const r = resolveWith(makeState({ players: 3 }), [1, 2, 'heal', 'heal', 1, 2]);
    expect(r.state.phase).toBe('roll');
    expect(r.state.turn.seat).toBe(1);
  });
});

describe('R-CARD-13/20 買牌階段', () => {
  it('結算後進入買牌階段，按 endTurn 才換下一位', () => {
    const s = toBuyPhase();
    expect(s.phase).toBe('buy');
    expect(s.turn.seat).toBe(0);
    const r = must(s, { type: 'endTurn', seat: 0 }, env);
    expect(r.state.turn.seat).toBe(1);
    expect(r.state.phase).toBe('roll');
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('不是買牌階段、不是自己的回合都被拒絕', () => {
    const s = shop({ monsters: { 0: { energy: 10 } } });
    expect(applyAction(s, { type: 'buy', seat: 0, cardId: 'c1' }, env)).toEqual({
      ok: false,
      error: 'wrong_phase',
    });
    const b = toBuyPhase();
    expect(applyAction(b, { type: 'sweep', seat: 1 }, env)).toEqual({
      ok: false,
      error: 'not_your_turn',
    });
  });
});

describe('R-CARD-11/14/15 購買', () => {
  it('付費、立即結算 Discard 卡、從牌庫補牌', () => {
    const s = toBuyPhase();
    const r = must(s, { type: 'buy', seat: 0, cardId: 'c1' }, env);
    expect(mon(r.state, 0)).toMatchObject({ energy: 7, vp: 3 }); // 進入東京 +1、卡牌 +2;
    expect(r.state.market?.faceUp).toEqual(['c2', 'c3', 'c4']);
    expect(r.state.market?.deck).toEqual(['c5', 'c6', 'c7']);
    expect(r.state.market?.discard).toEqual(['c1']);
    expect(r.events).toContainEqual({
      type: 'card_bought',
      seat: 0,
      cardId: 'c1',
      cost: 3,
      from: null,
    });
    expect(r.events).toContainEqual({ type: 'card_revealed', cardId: 'c4' });
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('Keep 卡留在面前', () => {
    const r = must(toBuyPhase(), { type: 'buy', seat: 0, cardId: 'c3' }, env);
    expect(mon(r.state, 0).cards).toEqual(['c3']);
    expect(mon(r.state, 0).energy).toBe(6);
  });

  it('能量不足、卡不在商店、不存在的卡都被拒絕，狀態不變', () => {
    const poor = toBuyPhase(shop({ monsters: { 0: { energy: 2 } } }));
    expect(applyAction(poor, { type: 'buy', seat: 0, cardId: 'c1' }, env)).toEqual({
      ok: false,
      error: 'not_enough_energy',
    });
    const s = toBuyPhase();
    expect(applyAction(s, { type: 'buy', seat: 0, cardId: 'c4' }, env)).toEqual({
      ok: false,
      error: 'card_unavailable',
    });
    expect(applyAction(s, { type: 'buy', seat: 0, cardId: 'nope' }, env)).toEqual({
      ok: false,
      error: 'card_unavailable',
    });
  });

  it('牌庫與棄牌堆都空了就不補牌', () => {
    const s = toBuyPhase(shop({ deck: [], monsters: { 0: { energy: 10 } } }));
    const r = must(s, { type: 'buy', seat: 0, cardId: 'c1' }, env);
    expect(r.state.market?.faceUp).toEqual(['c2', 'c3']);
  });

  it('R-CARD-11 牌庫空了就把棄牌堆洗回牌庫', () => {
    let s = toBuyPhase(shop({ deck: ['c4'], monsters: { 0: { energy: 20 } } }));
    s = must(s, { type: 'buy', seat: 0, cardId: 'c1' }, env).state; // 補 c4，牌庫空
    s = must(s, { type: 'buy', seat: 0, cardId: 'c2' }, env).state; // 牌庫空：把棄牌堆（c1）洗回再抽
    expect(s.market?.faceUp).toHaveLength(3);
    expect(s.market?.faceUp).toContain('c1');
  });
});

describe('R-CARD-12 掃牌', () => {
  it('花 2 能量棄掉 3 張並翻 3 張新牌，可再買', () => {
    const s = toBuyPhase();
    const r = must(s, { type: 'sweep', seat: 0 }, env);
    expect(mon(r.state, 0).energy).toBe(8);
    expect(r.state.market?.faceUp).toEqual(['c4', 'c5', 'c6']);
    expect(r.state.market?.discard).toEqual(['c1', 'c2', 'c3']);
    expect(r.events).toContainEqual({
      type: 'market_swept',
      seat: 0,
      discarded: ['c1', 'c2', 'c3'],
    });
    const r2 = must(r.state, { type: 'buy', seat: 0, cardId: 'c6' }, env);
    expect(mon(r2.state, 0).energy).toBe(7);
  });

  it('能量不足 2 不能掃牌', () => {
    const s = toBuyPhase(shop({ monsters: { 0: { energy: 1 } } }));
    expect(applyAction(s, { type: 'sweep', seat: 0 }, env)).toEqual({
      ok: false,
      error: 'not_enough_energy',
    });
  });
});

describe('R-CARD-20 順序：攻擊 → 讓位 → 進入東京 → 買牌', () => {
  it('攻擊東京內的怪獸、對方讓位後，攻擊者進入東京再買牌', () => {
    let s = shop({ monsters: { 0: { energy: 5 }, 1: { location: 'city' } } });
    s = resolveWith(s, [A, E, 1, 2, 'heal', 'heal'], env).state;
    expect(s.phase).toBe('prompt');
    s = must(s, { type: 'yieldDecision', seat: 1, leave: true }, env).state;
    expect(s.phase).toBe('buy');
    expect(mon(s, 0).location).toBe('city');
    expect(mon(s, 0).energy).toBe(6);
    expect(mon(s, 0).vp).toBe(1);
  });
});
