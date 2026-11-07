/**
 * 簡單機器人：用於模擬測試與（M6）補位。純函式，不使用系統亂數。
 */
import { NO_CARDS } from './cards/types.js';
import type { RulesEnv } from './cards/types.js';
import { nextInt } from './rng.js';
import type { RngState } from './rng.js';
import { currentActor, defaultAction, legalActions } from './legal.js';
import { getMonster } from './state.js';
import type { Action, Face, GameState } from './types.js';

/** 從合法動作中均勻隨機挑一個（亂數狀態由呼叫端持有，與遊戲 RNG 分開）。 */
export function randomBot(
  state: GameState,
  rng: RngState,
  env: RulesEnv = NO_CARDS,
): [action: Action, nextRng: RngState] {
  const actions = legalActions(state, env);
  if (actions.length === 0) {
    throw new Error('遊戲已結束，沒有合法動作');
  }
  const [index, next] = nextInt(rng, actions.length);
  return [actions[index] as Action, next];
}

function wantsToKeep(face: Face, dice: readonly Face[], canHeal: boolean): boolean {
  if (face === 'attack' || face === 'energy') return true;
  if (face === 'heal') return canHeal;
  return dice.filter((f) => f === face).length >= 2; // 有機會湊成三顆的數字
}

/**
 * 固定策略：留下攻擊、能量、（可用的）治療與成對的數字；被打殘就讓位；
 * 買牌時買買得起的最貴一張（有的話）。其他決定一律用最保守的預設。
 */
export function greedyBot(state: GameState, env: RulesEnv = NO_CARDS): Action {
  const seat = currentActor(state);
  if (seat === null) {
    throw new Error('遊戲已結束，沒有合法動作');
  }
  const me = getMonster(state, seat);
  if (state.phase === 'prompt') {
    if (state.pending?.kind === 'yield') {
      return { type: 'yieldDecision', seat, leave: me.hp <= 4 };
    }
    return defaultAction(state) as Action;
  }
  if (state.phase === 'buy') {
    let best: Action | null = null;
    let bestCost = -1;
    for (const a of legalActions(state, env)) {
      if (a.type !== 'buy' || a.from !== undefined || a.target !== undefined) continue;
      const cost = env.cards[a.cardId]?.cost ?? 0;
      const def = env.cards[a.cardId];
      if (def?.effectId === 'batteries' || def?.effectId === 'mimic') continue;
      if (cost > bestCost) {
        best = a;
        bestCost = cost;
      }
    }
    return best ?? { type: 'endTurn', seat };
  }
  const { rollsUsed, dice } = state.turn;
  if (rollsUsed === 0) {
    return { type: 'roll', seat, keep: [] };
  }
  const canHeal = me.location === null && me.hp < me.maxHp;
  const keep = dice.flatMap((face, index) => (wantsToKeep(face, dice, canHeal) ? [index] : []));
  const canRoll = legalActions(state, env).some((a) => a.type === 'roll');
  if (keep.length >= dice.length || !canRoll) {
    return { type: 'endRolling', seat };
  }
  return { type: 'roll', seat, keep };
}
