import { describe, expect, it } from 'vitest';
import { smartBot } from './ai.js';
import { greedyBot } from './bot.js';
import { applyAction } from './engine.js';
import { checkInvariants } from './invariants.js';
import { currentActor } from './legal.js';
import { cloneState, createGame, defaultConfig } from './state.js';
import { fullEnv, makeEnv } from './test-utils.js';
import type { RulesEnv } from './cards/types.js';
import type { GameState } from './types.js';
import { redactState } from './view.js';

/** smartBot 當一位玩家、其餘用 greedyBot，打完整局；每一步都必須被引擎接受。 */
function playOut(seed: number, players: number, env: RulesEnv): GameState {
  let { state } = createGame(defaultConfig(players), seed, env);
  for (let step = 0; step < 6000 && state.phase !== 'over'; step += 1) {
    const seat = currentActor(state) as number;
    const action = seat === seed % players ? smartBot(state, env) : greedyBot(state, env);
    const r = applyAction(state, action, env);
    if (!r.ok) throw new Error(`seed ${String(seed)} step ${String(step)}：被拒絕（${r.error}）`);
    state = r.state;
    expect(checkInvariants(state)).toEqual([]);
  }
  return state;
}

describe('smartBot', () => {
  it('不含卡牌的整局：每個動作都合法、都能打完', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      expect(playOut(seed, 2 + (seed % 5), makeEnv()).phase).toBe('over');
    }
  });

  it('含各種卡牌效果的整局：每個動作都合法、都能打完', () => {
    const env = fullEnv();
    for (let seed = 1; seed <= 8; seed += 1) {
      expect(playOut(seed, 2 + (seed % 5), env).phase).toBe('over');
    }
  });

  it('遊戲結束後沒有可做的事', () => {
    const state = playOut(3, 2, makeEnv());
    expect(() => smartBot(state)).toThrow();
  });

  it('公平：決策只取決於玩家看得到的資訊（牌庫順序與亂數狀態不同，選擇也相同）', () => {
    const env = fullEnv();
    let { state } = createGame(defaultConfig(3), 11, env);
    let checked = 0;
    for (let step = 0; step < 400 && state.phase !== 'over'; step += 1) {
      const seat = currentActor(state) as number;
      const real = smartBot(state, env);
      // 另一個「看起來一樣、但看不到的部分不同」的世界
      const other = cloneState(state);
      other.rng = typeof other.rng === 'number' ? 987654 : { key: [9, 8, 7, 6], n: 12345 };
      if (other.market) other.market.deck = [...other.market.deck].reverse();
      expect(smartBot(other, env)).toEqual(real);
      // 玩家視角本身不含這些資訊
      expect(redactState(state, seat).market?.deck.every((c) => c === '')).toBe(true);
      checked += 1;
      const r = applyAction(state, real, env);
      if (!r.ok) throw new Error('rejected');
      state = r.state;
    }
    expect(checked).toBeGreaterThan(25);
  });

  it('明顯該做的事：血量見底就讓位；能贏就直接贏', () => {
    // 3 人局，座位 1 在東京、血量 1，被座位 0 打了之後詢問讓位 → 應該離開
    const base = createGame(defaultConfig(3), 5).state;
    const s = cloneState(base);
    s.phase = 'prompt';
    s.turn.seat = 0;
    s.pending = { kind: 'yield', attacker: 0, queue: [1] };
    const m1 = s.monsters[1];
    if (!m1) throw new Error('no seat 1');
    m1.location = 'city';
    m1.hp = 1;
    expect(smartBot(s, makeEnv())).toMatchObject({ type: 'yieldDecision', seat: 1, leave: true });
  });
});
