/**
 * 模擬與屬性測試：用機器人和隨機動作把引擎跑過大量局面，
 * 驗證不變條件、可重現性、終止性（M1-4）。
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { greedyBot, randomBot } from './bot.js';
import { applyAction } from './engine.js';
import { checkInvariants } from './invariants.js';
import { legalActions } from './legal.js';
import { replay } from './replay.js';
import { seedToState } from './rng.js';
import { createGame, defaultConfig } from './state.js';
import type { Action, GameEvent, GameState } from './types.js';

const MAX_ACTIONS = 5000;

interface Played {
  state: GameState;
  actions: Action[];
  events: GameEvent[];
}

function play(
  playerCount: number,
  seed: number,
  pick: (state: GameState, index: number) => Action,
): Played {
  const created = createGame(defaultConfig(playerCount), seed);
  let state = created.state;
  const events = [...created.events];
  const actions: Action[] = [];
  for (let i = 0; i < MAX_ACTIONS && state.phase !== 'over'; i += 1) {
    const action = pick(state, i);
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(`機器人送出了被拒絕的動作：${result.error} ${JSON.stringify(action)}`);
    }
    expect(checkInvariants(result.state)).toEqual([]);
    state = result.state;
    events.push(...result.events);
    actions.push(action);
  }
  return { state, actions, events };
}

function randomGame(playerCount: number, seed: number): Played {
  let botRng = seedToState(seed * 7919 + 13);
  return play(playerCount, seed, (state) => {
    const [action, next] = randomBot(state, botRng);
    botRng = next;
    return action;
  });
}

function checkFinished(played: Played, playerCount: number, seed: number): void {
  const { state, actions, events } = played;
  expect(state.phase).toBe('over'); // 終止性：在上限內一定會結束
  expect(state.outcome).not.toBeNull();

  // 結果的一致性
  const outcome = state.outcome;
  if (!outcome) return;
  const last = events[events.length - 1];
  expect(last).toEqual({ type: 'game_over', winners: outcome.winners, reason: outcome.reason });
  expect(events.filter((e) => e.type === 'game_over')).toHaveLength(1);
  const alive = state.monsters.filter((m) => m.alive);
  if (outcome.reason === 'lastStanding') {
    expect(alive).toHaveLength(1);
    expect(outcome.winners).toEqual([alive[0]?.seat]);
  } else {
    for (const seat of outcome.winners) {
      expect(state.monsters[seat]?.vp).toBeGreaterThanOrEqual(state.config.victoryPoints);
    }
  }

  // 可重現性：seed + 動作日誌 → 完全相同的狀態與事件
  const again = replay(defaultConfig(playerCount), seed, actions);
  expect(again.state).toEqual(state);
  expect(again.events).toEqual(events);
}

describe('模擬：隨機機器人', () => {
  for (const players of [2, 3, 4, 5, 6]) {
    it(`${String(players)} 人局，40 場都能正常結束，不變條件全程成立，且可重放`, () => {
      for (let seed = 1; seed <= 40; seed += 1) {
        checkFinished(randomGame(players, seed), players, seed);
      }
    });
  }
});

describe('模擬：固定策略機器人', () => {
  for (const players of [2, 3, 4, 5, 6]) {
    it(`${String(players)} 人局，40 場都能正常結束且可重放`, () => {
      for (let seed = 100; seed < 140; seed += 1) {
        checkFinished(
          play(players, seed, (state) => greedyBot(state)),
          players,
          seed,
        );
      }
    });
  }

  it('所有勝者都是存活者；平均每場有合理的長度', () => {
    let total = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const played = play(4, seed, (state) => greedyBot(state));
      total += played.actions.length;
      for (const seat of played.state.outcome?.winners ?? []) {
        expect(played.state.monsters[seat]?.alive).toBe(true);
      }
    }
    expect(total / 30).toBeGreaterThan(10);
    expect(total / 30).toBeLessThan(MAX_ACTIONS);
  });
});

describe('屬性測試（fast-check）', () => {
  const playersArb = fc.integer({ min: 2, max: 6 });
  const seedArb = fc.integer({ min: 0, max: 2 ** 31 });
  const choicesArb = fc.array(fc.nat(10_000), { minLength: 1, maxLength: 400 });

  /** 依 choices 從合法動作中挑選，直到用完或遊戲結束。 */
  function follow(playerCount: number, seed: number, choices: number[]): Played {
    const created = createGame(defaultConfig(playerCount), seed);
    let state = created.state;
    const events = [...created.events];
    const actions: Action[] = [];
    for (const choice of choices) {
      if (state.phase === 'over') break;
      const legal = legalActions(state);
      const action = legal[choice % legal.length] as Action;
      const result = applyAction(state, action);
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      state = result.state;
      events.push(...result.events);
      actions.push(action);
    }
    return { state, actions, events };
  }

  it('任何合法動作序列：永遠被接受、不變條件成立、VP 與回合數不會倒退、死者不復活', () => {
    fc.assert(
      fc.property(playersArb, seedArb, choicesArb, (players, seed, choices) => {
        let state = createGame(defaultConfig(players), seed).state;
        for (const choice of choices) {
          if (state.phase === 'over') break;
          const legal = legalActions(state);
          const result = applyAction(state, legal[choice % legal.length] as Action);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const next = result.state;
          expect(checkInvariants(next)).toEqual([]);
          expect(next.version).toBe(state.version + 1);
          expect(next.round).toBeGreaterThanOrEqual(state.round);
          for (const m of next.monsters) {
            const prev = state.monsters[m.seat];
            expect(m.vp).toBeGreaterThanOrEqual(prev?.vp ?? 0);
            if (prev && !prev.alive) expect(m.alive).toBe(false);
          }
          state = next;
        }
      }),
      { numRuns: 150 },
    );
  });

  it('相同 seed 與動作日誌，重放結果完全相同', () => {
    fc.assert(
      fc.property(playersArb, seedArb, choicesArb, (players, seed, choices) => {
        const played = follow(players, seed, choices);
        const again = replay(defaultConfig(players), seed, played.actions);
        expect(again.state).toEqual(played.state);
        expect(again.events).toEqual(played.events);
      }),
      { numRuns: 100 },
    );
  });

  it('套用動作不會修改傳入的狀態（不可變性）', () => {
    fc.assert(
      fc.property(playersArb, seedArb, choicesArb, (players, seed, choices) => {
        let state = createGame(defaultConfig(players), seed).state;
        for (const choice of choices) {
          if (state.phase === 'over') break;
          const legal = legalActions(state);
          const snapshot = JSON.stringify(state);
          const result = applyAction(state, legal[choice % legal.length] as Action);
          expect(JSON.stringify(state)).toBe(snapshot);
          if (!result.ok) return;
          state = result.state;
        }
      }),
      { numRuns: 80 },
    );
  });

  it('任意（可能不合法的）動作：不會丟出例外；被拒絕時狀態不變、錯誤碼穩定', () => {
    const actionArb: fc.Arbitrary<Action> = fc.oneof(
      fc.record({
        type: fc.constant('roll' as const),
        seat: fc.integer({ min: -2, max: 8 }),
        keep: fc.array(fc.integer({ min: -2, max: 8 }), { maxLength: 8 }),
      }),
      fc.record({
        type: fc.constant('endRolling' as const),
        seat: fc.integer({ min: -2, max: 8 }),
      }),
      fc.record({
        type: fc.constant('yieldDecision' as const),
        seat: fc.integer({ min: -2, max: 8 }),
        leave: fc.boolean(),
      }),
    );
    const codes = new Set([
      'game_over',
      'not_your_turn',
      'wrong_phase',
      'invalid_keep',
      'no_rolls_left',
      'roll_first',
    ]);
    fc.assert(
      fc.property(
        playersArb,
        seedArb,
        fc.array(actionArb, { maxLength: 60 }),
        (players, seed, actions) => {
          let state = createGame(defaultConfig(players), seed).state;
          for (const action of actions) {
            const snapshot = JSON.stringify(state);
            const result = applyAction(state, action);
            if (result.ok) {
              expect(checkInvariants(result.state)).toEqual([]);
              state = result.state;
            } else {
              expect(codes.has(result.error)).toBe(true);
              expect(JSON.stringify(state)).toBe(snapshot);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('每一場遊戲，事件序列中 turn_started 與 turn_ended 成對出現', () => {
    fc.assert(
      fc.property(playersArb, seedArb, choicesArb, (players, seed, choices) => {
        const { events, state } = follow(players, seed, choices);
        let open = 0;
        for (const e of events) {
          if (e.type === 'turn_started') open += 1;
          if (e.type === 'turn_ended') open -= 1;
          expect(open).toBeGreaterThanOrEqual(0);
          expect(open).toBeLessThanOrEqual(1);
        }
        // 結束時：遊戲進行中有 1 個進行中的回合；回合中途結束（最後存活）時最多 1 個
        expect(open === 0 || open === 1).toBe(true);
        if (state.phase !== 'over') expect(open).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});
