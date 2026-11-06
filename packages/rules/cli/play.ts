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
import { createGame, defaultConfig } from '../src/state.js';
import type { Face, GameEvent, GameState } from '../src/types.js';

const FACE_TEXT: Record<string, string> = { energy: '⚡', attack: '💥', heal: '❤️' };

function faces(dice: readonly Face[]): string {
  return dice.map((f) => FACE_TEXT[String(f)] ?? String(f)).join(' ');
}

const LOCATION_TEXT = { city: '東京市', bay: '東京灣' } as const;

function describe(e: GameEvent): string {
  switch (e.type) {
    case 'first_player_decided':
      return `先手：座位 ${e.firstSeat}（擲骰 ${e.rounds.length} 輪）`;
    case 'turn_started':
      return `── 第 ${e.round} 輪，座位 ${e.seat} 的回合`;
    case 'vp_gained':
      return `  座位 ${e.seat} +${e.amount} VP（${e.reason}）`;
    case 'dice_rolled':
      return `  座位 ${e.seat} 第 ${e.rollNumber} 擲：${faces(e.dice)}`;
    case 'rolling_ended':
      return `  座位 ${e.seat} 停止擲骰：${faces(e.dice)}`;
    case 'energy_gained':
      return `  座位 ${e.seat} +${e.amount} 能量`;
    case 'healed':
      return `  座位 ${e.seat} 回復 ${e.amount} HP`;
    case 'heal_ignored':
      return `  座位 ${e.seat} 在東京內，${e.faces} 個治療面無效`;
    case 'smash':
      return `  座位 ${e.attacker} 攻擊 ${e.damage} → 目標 ${e.targets.join('、')}`;
    case 'damage_taken':
      return `    座位 ${e.seat} -${e.amount} HP（剩 ${e.hp}）`;
    case 'eliminated':
      return `    座位 ${e.seat} 被淘汰`;
    case 'yield_requested':
      return `  詢問座位 ${e.seat} 是否讓位`;
    case 'yielded':
      return `  座位 ${e.seat} 讓出${LOCATION_TEXT[e.location]}`;
    case 'stayed':
      return `  座位 ${e.seat} 留在東京`;
    case 'entered_tokyo':
      return `  座位 ${e.seat} 進入${LOCATION_TEXT[e.location]}`;
    case 'bay_closed':
      return `  東京灣關閉：座位 ${e.seat} ${e.movedTo ? '移到東京市' : '離開東京'}`;
    case 'turn_ended':
      return '';
    case 'round_ended':
      return `══ 第 ${e.round} 輪結束`;
    case 'game_over':
      return `★ 遊戲結束：勝者 ${e.winners.length ? e.winners.join('、') : '（無）'}（${e.reason}）`;
  }
}

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
      const line = describe(e);
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
