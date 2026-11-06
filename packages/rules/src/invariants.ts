import { isBayOpen } from './state.js';
import type { GameState } from './types.js';

/**
 * 檢查狀態是否違反不變條件，回傳違規說明（空陣列表示正常）。
 * 測試與（M5）伺服器的除錯模式使用；不會修改狀態。
 */
export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const { config } = state;

  if (state.monsters.length !== config.playerCount) {
    problems.push('怪獸數量與 playerCount 不符');
  }

  const city: number[] = [];
  const bay: number[] = [];
  for (const m of state.monsters) {
    if (m.alive) {
      if (m.hp < 1 || m.hp > m.maxHp) {
        problems.push(
          `座位 ${String(m.seat)}：存活但 HP=${String(m.hp)}（上限 ${String(m.maxHp)}）`,
        );
      }
    } else {
      if (m.hp !== 0) problems.push(`座位 ${String(m.seat)}：已淘汰但 HP 不是 0`);
      if (m.location !== null) problems.push(`座位 ${String(m.seat)}：已淘汰卻還在東京`);
      if (m.energy !== 0) problems.push(`座位 ${String(m.seat)}：已淘汰卻還有能量`);
      if (m.cards.length > 0) problems.push(`座位 ${String(m.seat)}：已淘汰卻還有卡牌`);
    }
    if (m.vp < 0 || m.energy < 0 || !Number.isInteger(m.vp) || !Number.isInteger(m.energy)) {
      problems.push(`座位 ${String(m.seat)}：VP 或能量不是非負整數`);
    }
    if (m.location === 'city') city.push(m.seat);
    if (m.location === 'bay') bay.push(m.seat);
  }

  if (city.length > 1) problems.push('東京市有多位怪獸');
  if (bay.length > 1) problems.push('東京灣有多位怪獸');

  if (state.phase !== 'over') {
    // 回合邊界（擲骰階段）：東京灣只在存活 ≥5 時有人。讓位等待中可能暫時違反（關閉在進入東京之後才檢查）
    if (state.phase === 'roll' && bay.length > 0 && !isBayOpen(state)) {
      problems.push('東京灣已關閉卻仍有怪獸');
    }
    const actor = state.monsters[state.turn.seat];
    if (!actor?.alive) {
      problems.push('目前回合的怪獸不是存活狀態');
    }
    if (state.turn.rollsUsed > config.maxRolls) {
      problems.push('擲骰次數超過上限');
    }
    if (state.turn.dice.length !== 0 && state.turn.dice.length !== config.diceCount) {
      problems.push('骰子數量不符');
    }
    if (state.phase === 'roll' && bay.length > 0 && city.length === 0) {
      problems.push('東京灣有人但東京市是空的');
    }
    if (state.phase === 'yield') {
      const pending = state.pending;
      if (!pending) {
        problems.push('讓位階段沒有等待中的決定');
      } else {
        if (pending.queue.length === 0) problems.push('讓位佇列是空的');
        if (new Set(pending.queue).size !== pending.queue.length)
          problems.push('讓位佇列有重複座位');
        if (pending.attacker !== state.turn.seat) problems.push('讓位的攻擊者不是目前回合的怪獸');
        for (const seat of pending.queue) {
          const m = state.monsters[seat];
          if (!m?.alive || m.location === null)
            problems.push(`讓位佇列中的座位 ${String(seat)} 不在東京或已淘汰`);
        }
      }
    }
    if (state.phase === 'roll' && state.pending) {
      problems.push('擲骰階段不應有等待中的讓位');
    }
    if (state.outcome) {
      problems.push('遊戲未結束卻已有結果');
    }
  } else {
    if (!state.outcome) {
      problems.push('遊戲結束但沒有結果');
    } else {
      for (const seat of state.outcome.winners) {
        if (!state.monsters[seat]?.alive) {
          problems.push(`勝者 ${String(seat)} 不是存活狀態`);
        }
      }
      if (state.outcome.winners.length === 0 && state.outcome.reason !== 'allEliminated') {
        problems.push('沒有勝者但原因不是全員淘汰');
      }
    }
  }

  return problems;
}
