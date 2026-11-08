import { describe, expect, it } from 'vitest';
import { applyAction, createGame, defaultConfig, greedyBot, redactState, replay } from './index.js';
import type { Action } from './index.js';

const SEED = 'f3a9c2d41b7e08650a1d9c3b7e2f4a68';

describe('密鑰式亂數用在整場對局', () => {
  it('字串 seed 可打完整局，重放得到相同結果，且狀態可 JSON 序列化', () => {
    const config = defaultConfig(3);
    const created = createGame(config, SEED);
    let state = created.state;
    const log: Action[] = [];
    for (let i = 0; i < 5000 && state.phase !== 'over'; i += 1) {
      const action = greedyBot(state);
      const result = applyAction(state, action);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
      log.push(action);
    }
    expect(state.phase).toBe('over');
    const again = replay(config, SEED, log);
    expect(again.state).toEqual(state);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('不同字串 seed 的開局骰子不同；同一個 seed 完全相同', () => {
    const a = createGame(defaultConfig(2), SEED).state;
    const b = createGame(defaultConfig(2), SEED).state;
    expect(a).toEqual(b);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const seed = `${String(i).padStart(2, '0')}${SEED.slice(2)}`;
      const s = createGame(defaultConfig(2), seed).state;
      seen.add(JSON.stringify(s.rng));
    }
    expect(seen.size).toBe(20);
  });

  it('視角過濾會抹掉密鑰；過濾後的狀態不含原本的密鑰', () => {
    const state = createGame(defaultConfig(2), SEED).state;
    const secret = JSON.stringify(state.rng);
    const view = redactState(state, 0);
    expect(view.rng).toEqual({ key: [0, 0, 0, 0], n: 0 });
    expect(JSON.stringify(view)).not.toContain(secret);
    // 原狀態未被改動
    expect(JSON.stringify(state.rng)).toBe(secret);
  });
});
