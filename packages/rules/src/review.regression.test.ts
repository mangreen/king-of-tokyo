/** 獨立審查（M3）發現的缺陷的回歸測試。每個測試都先在修正前失敗過。 */
import { describe, expect, it } from 'vitest';
import { applyAction } from './engine.js';
import { greedyBot } from './bot.js';
import { checkInvariants } from './invariants.js';
import { legalActions } from './legal.js';
import { cloneState } from './state.js';
import { card, makeEnv, makeState, mon, must, resolveWith, withDice } from './test-utils.js';
import type { Face, GameState } from './types.js';

const A: Face = 'attack';
const E: Face = 'energy';
const check = (s: GameState): void => expect(checkInvariants(s)).toEqual([]);

const thorns = card('thorns', 'tokyo_target_bonus', { params: { n: 0, yieldDamage: 2 } });

describe('遊戲結束後不能繼續（讓位傷害／反應傷害淘汰了攻擊者）', () => {
  it('讓位傷害殺死攻擊者：遊戲立刻結束，沒有後續回合事件，之後的動作都被拒絕', () => {
    const env = makeEnv(thorns);
    const state = makeState({
      players: 2,
      env,
      monsters: { 0: { hp: 1 }, 1: { location: 'city', cards: ['thorns'] } },
    });
    const r = resolveWith(state, [A, 1, 2, 3, E, E], env);
    expect(r.state.pending).toMatchObject({ kind: 'yield' });
    const y = must(r.state, { type: 'yieldDecision', seat: 1, leave: true }, env);
    expect(y.state.phase).toBe('over');
    expect(y.state.pending).toBeNull();
    expect(y.state.outcome?.winners).toEqual([1]);
    const types = y.events.map((e) => e.type);
    expect(types).toContain('game_over');
    expect(types.slice(types.indexOf('game_over') + 1)).toEqual([]);
    expect(applyAction(y.state, { type: 'roll', seat: 0, keep: [] }, env)).toEqual({
      ok: false,
      error: 'game_over',
    });
    check(y.state);
  });

  it('離開東京的反應傷害殺死攻擊者：同樣立刻結束', () => {
    const env = makeEnv(thorns, card('jets', 'jets'));
    const state = makeState({
      players: 2,
      env,
      monsters: { 0: { hp: 1 }, 1: { location: 'city', cards: ['thorns', 'jets'], energy: 5 } },
    });
    const r = resolveWith(state, [A, 1, 2, 3, E, E], env);
    expect(r.state.pending).toMatchObject({ kind: 'react', seat: 1 });
    const used = must(r.state, { type: 'reactDecision', seat: 1, cardId: 'jets' }, env);
    expect(used.state.phase).toBe('over');
    expect(used.state.outcome?.winners).toEqual([1]);
    const types = used.events.map((e) => e.type);
    expect(types.slice(types.indexOf('game_over') + 1)).toEqual([]);
    check(used.state);
  });
});

describe('讓位換卡：攻擊者已被讓位傷害淘汰', () => {
  it('不會把卡交給已淘汰的怪獸，也不再詢問後面的怪獸', () => {
    const env = makeEnv(
      card('dna', 'swap_on_yield'),
      card('k', 'reroll_threes'),
      card('thorns', 'tokyo_target_bonus', { params: { n: 0, yieldDamage: 2 } }),
    );
    const state = makeState({
      players: 3,
      env,
      monsters: {
        0: { hp: 1, cards: ['k'] },
        1: { location: 'city', cards: ['dna', 'thorns'] },
      },
    });
    const r = resolveWith(state, [A, 1, 2, 3, E, E], env);
    const y = must(r.state, { type: 'yieldDecision', seat: 1, leave: true, takeCard: 'k' }, env);
    expect(mon(y.state, 0).alive).toBe(false);
    expect(mon(y.state, 0).cards).toEqual([]);
    expect(mon(y.state, 1).cards).toEqual(expect.arrayContaining(['dna', 'thorns']));
    expect(y.events.some((e) => e.type === 'card_swapped')).toBe(false);
    expect(y.state.phase).not.toBe('over'); // 還有兩位存活
    check(y.state);
  });
});

describe('代打機器人永遠給出引擎接受的動作', () => {
  it('持有「只重擲 3」的卡、次數用完：機器人不會送出被拒絕的保留組合', () => {
    const env = makeEnv(card('r', 'reroll_threes'));
    const base = makeState({ players: 2, env, monsters: { 0: { cards: ['r'] } } });
    for (const dice of [
      [A, 3, 3, 2, A, 3],
      [3, 3, 1, 1, 2, 2],
      [A, 3, A, A, 'heal', 'heal'],
      [3, 3, 3, 3, 3, 3],
    ] as Face[][]) {
      const state = withDice(base, dice);
      state.turn.rollsUsed = state.config.maxRolls;
      const action = greedyBot(state, env);
      const result = applyAction(state, action, env);
      expect(result.ok, `${JSON.stringify(dice)} → ${JSON.stringify(action)}`).toBe(true);
    }
  });

  it('各種卡牌下，機器人的每個動作都被接受（整局模擬）', () => {
    const defs = [
      card('r', 'reroll_threes'),
      card('dna', 'swap_on_yield'),
      thorns,
      card('jets', 'jets'),
    ];
    const env = makeEnv(...defs);
    for (let seed = 1; seed <= 30; seed += 1) {
      let state = makeState({
        players: 3,
        env,
        seed,
        monsters: {
          0: { cards: ['r'] },
          1: { cards: ['dna', 'thorns'] },
          2: { cards: ['jets'], energy: 3 },
        },
      });
      for (let i = 0; i < 3000 && state.phase !== 'over'; i += 1) {
        const action = greedyBot(state, env);
        const result = applyAction(state, action, env);
        expect(result.ok, `seed ${String(seed)} step ${String(i)}`).toBe(true);
        if (!result.ok) break;
        state = result.state;
      }
    }
  });
});

describe('向別人買牌：不接受買家指定的參數', () => {
  const defs = [
    card('bat', 'batteries', { params: { cap: 6 } }),
    card('mim', 'mimic'),
    card('buyer', 'buy_from_others'),
    card('x', 'instant', { cost: 0, params: { ops: [{ op: 'energy', n: 8 }] as never } }),
  ];
  const env = makeEnv(...defs);

  it('買別人的電池卡：energy 參數被忽略，累積的能量跟著卡走，買家能量不會變負', () => {
    const state = makeState({
      players: 2,
      env,
      monsters: { 0: { cards: ['buyer'], energy: 10 }, 1: { cards: ['bat'] } },
    });
    const s = cloneState(state);
    s.phase = 'buy';
    (s.monsters[1] as { cardData: Record<string, { n: number; ref: string | null }> }).cardData[
      'bat'
    ] = { n: 4, ref: null };
    const r = must(s, { type: 'buy', seat: 0, cardId: 'bat', from: 1, energy: 99 }, env);
    expect(mon(r.state, 0).energy).toBe(7);
    expect(mon(r.state, 0).cardData['bat']).toEqual({ n: 4, ref: null });
    check(r.state);
  });

  it('買別人的模仿卡：複製對象不能被買家改掉，也不會憑空獲得被指定卡的買下效果', () => {
    const state = makeState({
      players: 2,
      env,
      monsters: { 0: { cards: ['buyer'], energy: 10 }, 1: { cards: ['mim'], energy: 0 } },
    });
    const s = cloneState(state);
    s.phase = 'buy';
    const r = must(s, { type: 'buy', seat: 0, cardId: 'mim', from: 1, target: 'x' }, env);
    expect(mon(r.state, 0).energy).toBe(7); // 10 − 3，沒有被 x 的 +8 能量影響
    expect(mon(r.state, 0).cardData['mim']?.ref).toBeNull();
    check(r.state);
  });

  it('商店買模仿卡並複製電池卡：電池的存放上限也要檢查', () => {
    const state = makeState({
      players: 2,
      env,
      faceUp: ['mim'],
      deck: [],
      monsters: { 0: { cards: ['bat'], energy: 5 } },
    });
    const s = cloneState(state);
    s.phase = 'buy';
    const r = applyAction(
      s,
      { type: 'buy', seat: 0, cardId: 'mim', target: 'bat', energy: 99 },
      env,
    );
    expect(r).toEqual({ ok: false, error: 'not_enough_energy' });
  });
});

describe('偷看牌庫頂：牌庫頂換掉後，偷看結果作廢', () => {
  it('偷看後買商店的牌：不再提供買牌庫頂的動作，且可以重新偷看', () => {
    const env = makeEnv(
      card('peek', 'peek_buy'),
      card('c1', 'max_hp', { cost: 1, params: { n: 2 } }),
      card('d1', 'max_hp', { cost: 1, params: { n: 2 } }),
      card('d2', 'max_hp', { cost: 1, params: { n: 2 } }),
      card('d3', 'max_hp', { cost: 1, params: { n: 2 } }),
      card('d4', 'max_hp', { cost: 1, params: { n: 2 } }),
    );
    const state = makeState({
      players: 2,
      env,
      faceUp: ['c1'],
      deck: ['d1', 'd2', 'd3', 'd4'],
      monsters: { 0: { cards: ['peek'], energy: 9 } },
    });
    let s = cloneState(state);
    s.phase = 'buy';
    s = must(s, { type: 'useCard', seat: 0, cardId: 'peek', args: {} }, env).state;
    expect(s.turn.peek).toBe('d1');
    s = must(s, { type: 'buy', seat: 0, cardId: 'c1' }, env).state; // 補牌會用掉牌庫頂的 d1
    expect(s.turn.peek).toBeNull();
    const actions = legalActions(s, env);
    expect(actions.some((a) => a.type === 'buy' && a.from === 'deck')).toBe(false);
    const again = applyAction(s, { type: 'useCard', seat: 0, cardId: 'peek', args: {} }, env);
    expect(again).toMatchObject({ ok: true });
  });
});

describe('R-CARD-42 只剩一組搭檔時共同勝利', () => {
  it('第三者被淘汰、剩下互為搭檔的兩人：遊戲結束，兩人同勝', () => {
    const env = makeEnv();
    const state = makeState({
      players: 3,
      env,
      turnSeat: 2,
      monsters: {
        1: { sidekickOf: 0, sidekickUsed: true },
        2: { tokens: { poison: 9, shrink: 0 }, hp: 3 },
      },
    });
    const s = cloneState(state);
    s.phase = 'buy';
    const r = must(s, { type: 'endTurn', seat: 2 }, env);
    expect(r.state.phase).toBe('over');
    expect(r.state.outcome).toEqual({ winners: [0, 1], reason: 'lastStanding' });
  });

  it('剩下的兩人不是搭檔：遊戲照常繼續', () => {
    const env = makeEnv();
    const state = makeState({
      players: 3,
      env,
      turnSeat: 2,
      monsters: { 2: { tokens: { poison: 9, shrink: 0 }, hp: 3 } },
    });
    const s = cloneState(state);
    s.phase = 'buy';
    const r = must(s, { type: 'endTurn', seat: 2 }, env);
    expect(r.state.phase).not.toBe('over');
  });
});
