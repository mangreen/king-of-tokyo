import { describe, expect, it } from 'vitest';
import { greedyBot, randomBot } from './bot.js';
import { applyAction } from './engine.js';
import { checkInvariants } from './invariants.js';
import { currentActor, defaultAction } from './legal.js';
import { replay } from './replay.js';
import { seedToState } from './rng.js';
import { createGame, defaultConfig } from './state.js';
import { fullEnv } from './test-utils.js';
import type { RulesEnv } from './cards/types.js';
import type { Action, GameEvent, GameState } from './types.js';
import { redactState } from './view.js';

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
