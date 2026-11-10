/**
 * 機器人對戰量測：smartBot 對上 greedyBot / randomBot，統計勝率與每步耗時。
 *
 *   pnpm --filter @kot/rules run arena -- --players 4 --games 200 --vs greedy --cards 1
 *   --vs greedy|random|base（base = 預設權重的 smartBot；--weights '{"tokyo":1}' 覆寫候選權重）
 *
 * 每場讓 smartBot 輪流坐不同座位（消除先後手差異）。只用於開發與驗證。
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_WEIGHTS, smartBot } from '../src/ai.js';
import type { AiWeights } from '../src/ai.js';
import { greedyBot, randomBot } from '../src/bot.js';
import { NO_CARDS } from '../src/cards/types.js';
import type { CardDef, RulesEnv } from '../src/cards/types.js';
import { applyAction } from '../src/engine.js';
import { checkInvariants } from '../src/invariants.js';
import { currentActor } from '../src/legal.js';
import { seedToState } from '../src/rng.js';
import { createGame, defaultConfig } from '../src/state.js';
import type { Action, GameState } from '../src/types.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

function loadEnv(): RulesEnv {
  const url = new URL('../../../card-sets/original/set.json', import.meta.url);
  const set = JSON.parse(readFileSync(url, 'utf8')) as { cards: CardDef[] };
  return { cards: Object.fromEntries(set.cards.map((c) => [c.id, c])) };
}

const players = Number(arg('players', '4'));
const games = Number(arg('games', '100'));
const vs = arg('vs', 'greedy');
const withCards = arg('cards', '1') === '1';
const smartCount = Number(arg('smart', '1')); // 同時有幾位 smartBot（其餘是對手）
const weights: AiWeights = {
  ...DEFAULT_WEIGHTS,
  ...(JSON.parse(arg('weights', '{}')) as Partial<AiWeights>),
};
const env = withCards ? loadEnv() : NO_CARDS;

let smartMs = 0;
let smartCalls = 0;
let maxMs = 0;
const wins = { smart: 0, other: 0 };
let shared = 0;
let capped = 0;
let turns = 0;

for (let g = 0; g < games; g += 1) {
  const smartSeats = new Set(Array.from({ length: smartCount }, (_, i) => (g + i) % players));
  let { state } = createGame(defaultConfig(players), 1000 + g, env);
  let rng = seedToState(g * 7919 + 13);
  let steps = 0;
  for (; steps < 8000 && state.phase !== 'over'; steps += 1) {
    const seat = currentActor(state) as number;
    let action: Action;
    if (smartSeats.has(seat)) {
      const t0 = performance.now();
      action = smartBot(state, env, weights);
      const dt = performance.now() - t0;
      smartMs += dt;
      smartCalls += 1;
      maxMs = Math.max(maxMs, dt);
    } else if (vs === 'base') {
      action = smartBot(state, env); // 預設權重的 smartBot（比較不同權重用）
    } else if (vs === 'random') {
      const [a, next] = randomBot(state, rng, env);
      rng = next;
      action = a;
    } else {
      action = greedyBot(state, env);
    }
    const r = applyAction(state, action, env);
    if (!r.ok) {
      throw new Error(
        `game ${String(g)} step ${String(steps)} ${JSON.stringify(action)}：${r.error}`,
      );
    }
    state = r.state;
    const problems = checkInvariants(state);
    if (problems.length > 0) throw new Error(`game ${String(g)}：${problems.join('；')}`);
  }
  if (state.phase !== 'over') {
    capped += 1;
    continue;
  }
  turns += state.round;
  const w = (state as GameState).outcome?.winners ?? [];
  if (w.length > 1) shared += 1;
  if (w.some((s) => smartSeats.has(s))) wins.smart += 1;
  else wins.other += 1;
}

const done = games - capped;
const fair = smartCount / players;
console.log(
  JSON.stringify(
    {
      players,
      games: done,
      vs,
      cards: withCards,
      smartBots: smartCount,
      smartWinRate: Number((wins.smart / done).toFixed(3)),
      fairShare: Number(fair.toFixed(3)),
      sharedWins: shared,
      notFinished: capped,
      avgRounds: Number((turns / done).toFixed(1)),
      avgMsPerDecision: Number((smartMs / Math.max(1, smartCalls)).toFixed(2)),
      maxMsPerDecision: Number(maxMs.toFixed(1)),
    },
    null,
    2,
  ),
);
