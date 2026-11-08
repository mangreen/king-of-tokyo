import { describe, expect, it } from 'vitest';
import { greedyBot, randomBot } from './bot.js';
import { applyAction } from './engine.js';
import { checkInvariants } from './invariants.js';
import { currentActor, defaultAction } from './legal.js';
import { replay } from './replay.js';
import { seedToState } from './rng.js';
import { createGame, defaultConfig } from './state.js';
import { card, makeEnv } from './test-utils.js';
import type { RulesEnv } from './cards/types.js';
import type { Action, GameEvent, GameState } from './types.js';
import { redactState } from './view.js';

/** 每種效果各一張（部分有兩張不同參數），用來讓機器人把所有路徑都跑過。 */
function fullEnv(): RulesEnv {
  const ins = (id: string, cost: number, ...ops: object[]) =>
    card(id, 'instant', { cost, params: { ops: ops as never } });
  return makeEnv(
    ins('i-vp', 4, { op: 'vp', n: 4 }),
    ins('i-vp2', 2, { op: 'vp', n: 1 }),
    ins('i-energy', 6, { op: 'energy', n: 9 }),
    ins('i-heal', 3, { op: 'heal', n: 2 }),
    ins('i-blast', 3, { op: 'damageOthers', n: 2 }),
    ins('i-bomb', 4, { op: 'damageAll', n: 3 }),
    ins('i-jet', 5, { op: 'vp', n: 5 }, { op: 'selfDamage', n: 4 }),
    ins('i-evac', 7, { op: 'othersLoseVp', n: 5 }),
    ins('i-storm', 6, { op: 'vp', n: 2 }, { op: 'othersLoseEnergyPer', per: 2 }),
    ins('i-drop', 5, { op: 'vp', n: 2 }, { op: 'takeTokyo' }),
    ins('i-extra-turn', 7, { op: 'extraTurn' }),
    ins('i-army', 2, { op: 'perCard', vp: 1, damage: 1 }),
    card('extra-dice', 'extra_dice', { cost: 7 }),
    card('extra-rolls', 'extra_rolls', { cost: 5 }),
    card('discount', 'cost_discount', { cost: 3 }),
    card('k-energy-bonus', 'energy_bonus', { cost: 3 }),
    card('regen', 'heal_bonus', { cost: 4 }),
    card('bigger', 'max_hp', { cost: 4, params: { n: 2 } }),
    card('threes', 'reroll_threes', { cost: 4 }),
    card('plot', 'die_change', { cost: 3, params: { cost: 0, to: 'any', discard: true } }),
    card('stretchy', 'die_change', { cost: 3, params: { cost: 2, to: 'any' } }),
    card('culler', 'die_change', { cost: 3, params: { cost: 0, to: 1, once: true } }),
    card('k-reroll-energy', 'reroll_energy', { cost: 4, params: { cost: 1 } }),
    card('smoke', 'reroll_charges', { cost: 4, params: { charges: 3 } }),
    card('probe', 'probe', { cost: 3 }),
    card('quills', 'triple_bonus', { cost: 3, params: { face: 2, damage: 2 } }),
    card('gourmet', 'triple_bonus', { cost: 4, params: { face: 1, vp: 2 } }),
    card('destruction', 'complete_set', { cost: 3, params: { vp: 9 } }),
    card('omni', 'straight_vp', { cost: 4, params: { vp: 2 } }),
    card('alpha', 'attack_vp', { cost: 5, params: { vp: 1 } }),
    card('tail', 'attack_bonus', { cost: 5, params: { n: 1 } }),
    card('acid', 'attack_bonus', { cost: 6, params: { n: 1, always: true } }),
    card('burrow', 'tokyo_target_bonus', { cost: 5, params: { n: 1, yieldDamage: 1 } }),
    card('k-tokyo-attacker', 'tokyo_attacker', { cost: 4 }),
    card('breath', 'neighbor_damage', { cost: 4 }),
    card('nova', 'nova', { cost: 7 }),
    card('roar', 'forced_yield', { cost: 3 }),
    card('armor', 'armor', { cost: 4 }),
    card('camo', 'camouflage', { cost: 3 }),
    card('hide', 'reflect', { cost: 6 }),
    card('stronger', 'lose_hp_energy', { cost: 3 }),
    card('wings', 'wings', { cost: 6 }),
    card('jump', 'super_jump', { cost: 4 }),
    card('jets', 'jets', { cost: 5 }),
    card('dna', 'swap_on_yield', { cost: 3 }),
    card('poison', 'counter_attack', { cost: 4, params: { counter: 'poison' } }),
    card('shrink', 'counter_attack', { cost: 6, params: { counter: 'shrink' } }),
    card('cannibal', 'lifesteal', { cost: 5 }),
    card('eater', 'death_vp', { cost: 4, params: { vp: 3 } }),
    card('child', 'revive_self', { cost: 7, params: { hp: 10 } }),
    card('sidekick', 'revive_partner', { cost: 4, params: { hp: 10 } }),
    card('news', 'vp_on_buy', { cost: 3 }),
    card('hoarder', 'end_energy_vp', { cost: 3, params: { per: 6, vp: 1 } }),
    card('solar', 'end_empty_energy', { cost: 2 }),
    card('k-peaceful', 'end_peaceful_vp', { cost: 5 }),
    card('tanker', 'big_hit_vp', { cost: 4, params: { min: 3, vp: 2 } }),
    card('k-underdog', 'end_underdog', { cost: 3 }),
    card('stomp', 'stomp', { cost: 3, params: { min: 4 } }),
    card('batteries', 'batteries', { cost: 2 }),
    card('mimic', 'mimic', { cost: 8 }),
    card('parasite', 'buy_from_others', { cost: 4 }),
    card('lab', 'peek_buy', { cost: 2 }),
    card('opportunist', 'opportunist', { cost: 3 }),
    card('ray', 'heal_others', { cost: 4 }),
    card('metamorph', 'metamorph', { cost: 3 }),
    card('freeze', 'extra_turn_triple', { cost: 5, params: { penalty: 1 } }),
    card('rapid', 'rapid_heal', { cost: 3, params: { cost: 2, heal: 1 } }),
    card('sleep', 'energy_to_vp', { cost: 3, params: { cost: 3, vp: 1 } }),
  );
}

type Player = (s: GameState, step: number) => Action;

function play(
  seed: number,
  players: number,
  env: RulesEnv,
  pick: Player,
  onStep?: (s: GameState, a: Action, events: GameEvent[]) => void,
): { state: GameState; actions: Action[] } {
  let { state } = createGame(defaultConfig(players), seed, env);
  const actions: Action[] = [];
  for (let step = 0; step < 6000 && state.phase !== 'over'; step += 1) {
    const action = pick(state, step);
    const r = applyAction(state, action, env);
    if (!r.ok) {
      throw new Error(
        `seed ${String(seed)} step ${String(step)}：${JSON.stringify(action)} 被拒絕（${r.error}）`,
      );
    }
    state = r.state;
    actions.push(action);
    const problems = checkInvariants(state);
    if (problems.length > 0) {
      throw new Error(
        `seed ${String(seed)} step ${String(step)} ${JSON.stringify(action)}：${problems.join('；')}`,
      );
    }
    onStep?.(state, action, r.events);
  }
  return { state, actions };
}

const env = fullEnv();

describe('M3 模擬：所有卡牌效果混在一起', () => {
  it('隨機機器人：不變條件全程成立、都能結束、可重放（含牌庫順序）', () => {
    const used = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) {
      const players = 2 + (seed % 5);
      let rng = seedToState(seed * 7919);
      const { state, actions } = play(
        seed,
        players,
        env,
        (s) => {
          const [a, next] = randomBot(s, rng, env);
          rng = next;
          return a;
        },
        (_s, a) => {
          if (a.type === 'buy') used.add(a.cardId);
          if (a.type === 'useCard') used.add(a.cardId);
        },
      );
      expect(state.phase, `seed ${String(seed)} 沒有結束`).toBe('over');
      const again = replay(defaultConfig(players), seed, actions, env);
      expect(again.state).toEqual(state);
    }
    expect(used.size).toBeGreaterThan(20);
  }, 60_000);

  it('貪心機器人：買牌並完成遊戲，且至少有一場靠卡牌效果得分', () => {
    let bought = 0;
    for (let seed = 1; seed <= 25; seed += 1) {
      const { state } = play(
        seed,
        2 + (seed % 5),
        env,
        (s) => greedyBot(s, env),
        (_s, a) => {
          if (a.type === 'buy') bought += 1;
        },
      );
      expect(state.phase).toBe('over');
    }
    expect(bought).toBeGreaterThan(25);
  }, 60_000);

  it('逾時用的預設動作永遠合法，且能讓遊戲走完', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const { state } = play(seed, 3, env, (s) => {
        const a = defaultAction(s);
        if (!a) throw new Error('沒有預設動作');
        return a;
      });
      expect(state.phase).toBe('over');
    }
  });

  it('送給玩家的視角不含牌庫內容、亂數狀態與別人窺看的牌', () => {
    const { state } = play(
      3,
      4,
      env,
      (s) => greedyBot(s, env),
      (s) => {
        const view = redactState(s, 1);
        expect(view.rng).toBe(0);
        expect(view.market?.deck.every((id) => id === '')).toBe(true);
        expect(view.market?.faceUp).toEqual(s.market?.faceUp);
        expect(checkInvariants(view)).toEqual([]);
      },
    );
    expect(currentActor(state)).toBeNull();
  });
});
