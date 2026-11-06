import type { Action, GameState } from './types.js';

/** 現在輪到誰做決定（遊戲結束為 null）。 */
export function currentActor(state: GameState): number | null {
  if (state.phase === 'roll') {
    return state.turn.seat;
  }
  if (state.phase === 'yield') {
    return state.pending?.queue[0] ?? null;
  }
  return null;
}

/** 目前所有合法動作（保留骰子的每一種組合都列出）。供機器人、測試與 UI 提示使用。 */
export function legalActions(state: GameState): Action[] {
  const seat = currentActor(state);
  if (seat === null) {
    return [];
  }
  if (state.phase === 'yield') {
    return [
      { type: 'yieldDecision', seat, leave: true },
      { type: 'yieldDecision', seat, leave: false },
    ];
  }

  const actions: Action[] = [];
  const { rollsUsed, dice } = state.turn;
  if (rollsUsed === 0) {
    actions.push({ type: 'roll', seat, keep: [] });
    return actions;
  }
  actions.push({ type: 'endRolling', seat });
  if (rollsUsed < state.config.maxRolls) {
    const n = dice.length;
    // 每一種「保留哪些骰子」的組合（不含全部保留）
    for (let mask = 0; mask < (1 << n) - 1; mask += 1) {
      const keep: number[] = [];
      for (let i = 0; i < n; i += 1) {
        if (mask & (1 << i)) {
          keep.push(i);
        }
      }
      actions.push({ type: 'roll', seat, keep });
    }
  }
  return actions;
}
