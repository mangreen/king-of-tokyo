/**
 * 規則引擎的文字版介面：用機器人跑整場遊戲，列印事件，或統計多場結果。
 *
 *   pnpm --filter @kot/rules run play -- --players 4 --seed 7
 *   pnpm --filter @kot/rules run play -- --players 5 --games 500
 *
 * 只用於開發與驗證，不屬於遊戲本身。
 */
import { greedyBot } from '../src/bot.js';
import { applyAction } from '../src/engine.js';
import { checkInvariants } from '../src/invariants.js';
import { describeEvent } from '../src/format.js';
import { createGame, defaultConfig } from '../src/state.js';
import type { GameEvent, GameState } from '../src/types.js';

function parseArgs(argv: string[]): { players: number; seed: number; games: number } {
  const get = (name: string, fallback: number): number => {
    const index = argv.indexOf(`--${name}`);
    const value = index >= 0 ? Number(argv[index + 1]) : fallback;
    if (!Number.isInteger(value)) {
      throw new Error(`--${name} 必須是整數`);
    }
    return value;
  };
  return { players: get('players', 4), seed: get('seed', 1), games: get('games', 1) };
}

function playOne(
  players: number,
  seed: number,
  verbose: boolean,
): { state: GameState; actions: number } {
  const created = createGame(defaultConfig(players), seed);
  let state = created.state;
  let actions = 0;
  const print = (events: GameEvent[]): void => {
    if (!verbose) return;
    for (const e of events) {
      const line = describeEvent(e);
      if (line) console.log(line);
    }
  };
  print(created.events);
  while (state.phase !== 'over') {
    const result = applyAction(state, greedyBot(state));
    if (!result.ok) throw new Error(`動作被拒絕：${result.error}`);
    const problems = checkInvariants(result.state);
    if (problems.length > 0) throw new Error(`不變條件被破壞：${problems.join('；')}`);
    state = result.state;
    actions += 1;
    print(result.events);
    if (actions > 10_000) throw new Error('超過 10000 個動作仍未結束');
  }
  return { state, actions };
}

const { players, seed, games } = parseArgs(process.argv.slice(2));
if (games === 1) {
  const { state, actions } = playOne(players, seed, true);
  console.log(`\n${actions} 個動作；最終：`);
  for (const m of state.monsters) {
    console.log(
      `  座位 ${m.seat}：VP ${m.vp}、HP ${m.hp}、能量 ${m.energy}${m.alive ? '' : '（淘汰）'}`,
    );
  }
} else {
  const reasons: Record<string, number> = {};
  let totalActions = 0;
  let totalRounds = 0;
  for (let i = 0; i < games; i += 1) {
    const { state, actions } = playOne(players, seed + i, false);
    const reason = state.outcome?.reason ?? 'unknown';
    reasons[reason] = (reasons[reason] ?? 0) + 1;
    totalActions += actions;
    totalRounds += state.round;
  }
  console.log(`${games} 場 ${players} 人局（固定策略機器人，seed ${seed}…${seed + games - 1}）`);
  console.log(
    `  平均動作數：${(totalActions / games).toFixed(1)}，平均輪數：${(totalRounds / games).toFixed(1)}`,
  );
  console.log(`  結束原因：${JSON.stringify(reasons)}`);
}
