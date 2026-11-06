/**
 * 簡單機器人：用於模擬測試與（M6）補位。純函式，不使用系統亂數。
 */
import { nextInt } from './rng.js';
import type { RngState } from './rng.js';
import { currentActor, legalActions } from './legal.js';
import { getMonster } from './state.js';
import type { Action, Face, GameState } from './types.js';

/** 從合法動作中均勻隨機挑一個（亂數狀態由呼叫端持有，與遊戲 RNG 分開）。 */
export function randomBot(state: GameState, rng: RngState): [action: Action, nextRng: RngState] {
  const actions = legalActions(state);
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

/** 固定策略：留下攻擊、能量、（可用的）治療與成對的數字；被打殘就讓位。 */
export function greedyBot(state: GameState): Action {
  const seat = currentActor(state);
  if (seat === null) {
    throw new Error('遊戲已結束，沒有合法動作');
  }
  const me = getMonster(state, seat);
  if (state.phase === 'yield') {
    return { type: 'yieldDecision', seat, leave: me.hp <= 4 };
  }
  const { rollsUsed, dice } = state.turn;
  if (rollsUsed === 0) {
    return { type: 'roll', seat, keep: [] };
  }
  const canHeal = me.location === null && me.hp < me.maxHp;
  const keep = dice.flatMap((face, index) => (wantsToKeep(face, dice, canHeal) ? [index] : []));
  if (keep.length >= dice.length || rollsUsed >= state.config.maxRolls) {
    return { type: 'endRolling', seat };
  }
  return { type: 'roll', seat, keep };
}
