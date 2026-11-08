import { isBayOpen } from './state.js';
import type { GameState } from './types.js';

/**
 * 檢查狀態是否違反不變條件，回傳違規說明（空陣列表示正常）。
 * 測試與（M5）伺服器的除錯模式使用；不會修改狀態。
 */
export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const { config } = state;
  const seatLabel = (seat: number): string => `座位 ${String(seat)}`;

  if (state.monsters.length !== config.playerCount) {
    problems.push('怪獸數量與 playerCount 不符');
  }

  const city: number[] = [];
  const bay: number[] = [];
  for (const m of state.monsters) {
    if (m.alive) {
      if (m.hp < 1 || m.hp > m.maxHp) {
        problems.push(`${seatLabel(m.seat)}：存活但 HP=${String(m.hp)}（上限 ${String(m.maxHp)}）`);
      }
    } else {
      if (m.hp !== 0) problems.push(`${seatLabel(m.seat)}：已淘汰但 HP 不是 0`);
      if (m.location !== null) problems.push(`${seatLabel(m.seat)}：已淘汰卻還在東京`);
      if (m.energy !== 0) problems.push(`${seatLabel(m.seat)}：已淘汰卻還有能量`);
      if (m.cards.length > 0) problems.push(`${seatLabel(m.seat)}：已淘汰卻還有卡牌`);
    }
    if (m.vp < 0 || m.energy < 0 || !Number.isInteger(m.vp) || !Number.isInteger(m.energy)) {
      problems.push(`${seatLabel(m.seat)}：VP 或能量不是非負整數`);
    }
    if (m.tokens.poison < 0 || m.tokens.shrink < 0) {
      problems.push(`${seatLabel(m.seat)}：指示物數量為負`);
    }
    for (const id of Object.keys(m.cardData)) {
      if (!m.cards.includes(id))
        problems.push(`${seatLabel(m.seat)}：卡牌資料 ${id} 沒有對應的持有卡`);
    }
    if (new Set(m.cards).size !== m.cards.length) {
      problems.push(`${seatLabel(m.seat)}：持有重複的卡牌`);
    }
    if (m.sidekickOf !== null && !state.monsters[m.sidekickOf]) {
      problems.push(`${seatLabel(m.seat)}：搭檔指向不存在的座位`);
    }
    if (m.location === 'city') city.push(m.seat);
    if (m.location === 'bay') bay.push(m.seat);
  }

  if (city.length > 1) problems.push('東京市有多位怪獸');
  if (bay.length > 1) problems.push('東京灣有多位怪獸');

  // 每張卡只會在一個地方：牌庫、面朝上、棄牌堆或某位怪獸手上
  if (state.market) {
    const seen = new Map<string, number>();
    const add = (id: string): void => {
      seen.set(id, (seen.get(id) ?? 0) + 1);
    };
    // 抹去內容的視角（deck 以空字串占位）不檢查重複
    for (const id of state.market.deck) if (id !== '') add(id);
    for (const id of state.market.faceUp) add(id);
    for (const id of state.market.discard) add(id);
    for (const m of state.monsters) for (const id of m.cards) add(id);
    for (const [id, n] of seen) {
      if (n > 1) problems.push(`卡牌 ${id} 同時出現在 ${String(n)} 個地方`);
    }
    if (state.market.faceUp.length > 3) problems.push('面朝上的牌超過 3 張');
  }

  if (state.phase !== 'over') {
    // 擲骰階段的回合邊界：東京灣只在存活 ≥5 時有人。處理中（prompt／buy）可能暫時違反
    if (state.phase === 'roll' && !state.pending && bay.length > 0 && !isBayOpen(state)) {
      problems.push('東京灣已關閉卻仍有怪獸');
    }
    const actor = state.monsters[state.turn.seat];
    if (!actor?.alive) {
      problems.push('目前回合的怪獸不是存活狀態');
    }
    if (state.turn.dice.length !== 0 && state.turn.dice.length !== state.turn.diceCount) {
      problems.push('骰子數量不符');
    }
    // 注意：東京灣有人、東京市卻是空的是合法的——東京市怪獸被卡牌或毒淘汰時位置空出、
    // 沒人接替（R-TOKYO-07），下一位進入東京的怪獸會先佔東京市。
    if (state.phase === 'prompt') {
      const p = state.pending;
      if (!p) {
        problems.push('等待決定的階段沒有待決事項');
      } else if (p.kind === 'yield') {
        if (p.queue.length === 0) problems.push('讓位佇列是空的');
        if (new Set(p.queue).size !== p.queue.length) problems.push('讓位佇列有重複座位');
        if (p.attacker !== state.turn.seat) problems.push('讓位的攻擊者不是目前回合的怪獸');
        for (const seat of p.queue) {
          const m = state.monsters[seat];
          if (!m?.alive || m.location === null) {
            problems.push(`讓位佇列中的座位 ${String(seat)} 不在東京或已淘汰`);
          }
        }
      } else if (p.kind === 'react') {
        if (!p.plan[p.index]) problems.push('反應詢問的索引超出範圍');
      } else if (p.kind === 'probe' && p.queue.length === 0) {
        problems.push('重擲佇列是空的');
      } else if (p.kind === 'opportunity' && p.queue.length === 0) {
        problems.push('新牌即買佇列是空的');
      }
    } else if (state.pending) {
      problems.push('非等待決定的階段不應有待決事項');
    }
    if (state.phase === 'buy' && !state.market) {
      problems.push('沒有卡牌卻進入買牌階段');
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
