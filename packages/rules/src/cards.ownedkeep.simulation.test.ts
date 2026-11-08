/**
 * 每位怪獸開局就持有隨機的 Keep 卡（涵蓋所有 Keep 效果的各種組合），再讓機器人打完整局。
 * 這種「卡牌彼此互動」的情境是獨立審查找出多個缺陷的來源（遊戲結束後繼續、機器人被拒絕、
 * 淘汰者持有卡牌…），所以整局模擬在這裡檢查：每個動作都被接受、不變條件全程成立、
 * 有結果才會是 over、over 之後沒有動作。
 */
import { describe, expect, it } from 'vitest';
import { greedyBot, randomBot } from './bot.js';
import { applyAction } from './engine.js';
import { checkInvariants } from './invariants.js';
import { EFFECTS } from './cards/effects.js';
import { seedToState } from './rng.js';
import { createGame, defaultConfig } from './state.js';
import { card, makeEnv } from './test-utils.js';
import type { Action, GameState } from './types.js';

const keepIds = Object.entries(EFFECTS)
  .filter(([, effect]) => effect?.kind === 'keep')
  .map(([id]) => id);
const keepCards = keepIds.map((effectId) => card(`k-${effectId}`, effectId, { cost: 3 }));
const filler = [
  card('i-heal', 'instant', { cost: 2, params: { ops: [{ op: 'heal', n: 2 }] as never } }),
  card('i-vp', 'instant', { cost: 3, params: { ops: [{ op: 'vp', n: 2 }] as never } }),
];
const env = makeEnv(...keepCards, ...filler);

function deal(state: GameState, seed: number): GameState {
  const out = structuredCloneState(state);
  let rng = seedToState(seed * 104729);
  const pool = keepCards.map((c) => c.id);
  for (const m of out.monsters) {
    const mine = new Set<string>();
    while (mine.size < 3) {
      const [i, next] = [
        Math.floor((rng / 4294967296) * pool.length),
        (rng * 1103515245 + 12345) >>> 0,
      ];
      rng = next;
      mine.add(pool[i % pool.length] as string);
    }
    // 已被別人持有的牌不重複發（引擎假設同一張牌只在一個地方）
    for (const id of mine) {
      if (out.monsters.some((o) => o.cards.includes(id))) continue;
      m.cards.push(id);
      m.cardData[id] = { n: 0, ref: null };
    }
  }
  if (out.market) {
    const owned = new Set(out.monsters.flatMap((m) => m.cards));
    out.market.deck = out.market.deck.filter((id) => !owned.has(id));
    out.market.faceUp = out.market.faceUp.filter((id) => !owned.has(id));
    while (out.market.faceUp.length < 3 && out.market.deck.length > 0) {
      out.market.faceUp.push(out.market.deck.shift() as string);
    }
  }
  return out;
}

function structuredCloneState(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}

function run(seed: number, players: number, pick: (s: GameState) => Action): void {
  const start = createGame(defaultConfig(players), seed, env).state;
  let state = deal(start, seed);
  expect(checkInvariants(state), `seed ${String(seed)} 開局`).toEqual([]);
  for (let step = 0; step < 4000 && state.phase !== 'over'; step += 1) {
    const action = pick(state);
    const r = applyAction(state, action, env);
    if (!r.ok) {
      throw new Error(
        `seed ${String(seed)} step ${String(step)}：${JSON.stringify(action)} → ${r.error}`,
      );
    }
    state = r.state;
    const problems = checkInvariants(state);
    if (problems.length > 0) {
      throw new Error(`seed ${String(seed)} step ${String(step)}：${problems.join('；')}`);
    }
    expect(state.outcome !== null, `seed ${String(seed)} step ${String(step)}`).toBe(
      state.phase === 'over',
    );
    if (r.events.some((e) => e.type === 'game_over')) {
      const types = r.events.map((e) => e.type);
      expect(types.slice(types.indexOf('game_over') + 1), '結束後不該有事件').toEqual([]);
    }
  }
  expect(state.phase, `seed ${String(seed)} 沒有結束`).toBe('over');
  expect(applyAction(state, { type: 'endTurn', seat: 0 }, env).ok).toBe(false);
}

describe('開局就持有隨機 Keep 卡的整局模擬', () => {
  it('貪心機器人（代打用）：每個動作都被接受', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      run(seed, 2 + (seed % 5), (s) => greedyBot(s, env));
    }
  }, 120_000);

  it('隨機機器人：任何合法動作的組合都不會破壞狀態', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      let rng = seedToState(seed * 7919);
      run(seed, 2 + (seed % 5), (s) => {
        const [a, next] = randomBot(s, rng, env);
        rng = next;
        return a;
      });
    }
  }, 120_000);
});
