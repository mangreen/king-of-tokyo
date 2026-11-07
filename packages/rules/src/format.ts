import type { Face, GameEvent } from './types.js';

/** 事件的繁體中文文字描述（文字版 CLI 與網頁事件日誌共用）。空字串表示不需要顯示。 */
const FACE_TEXT: Record<string, string> = { energy: '⚡', attack: '💥', heal: '❤️' };

function faces(dice: readonly Face[]): string {
  return dice.map((f) => FACE_TEXT[String(f)] ?? String(f)).join(' ');
}

const CAUSE_TEXT = {
  card: '卡牌',
  poison: '毒',
  reflect: '反射',
  yield: '讓位',
  extra: '波及',
  self: '自傷',
} as const;

const COUNTER_TEXT = { poison: '毒', shrink: '縮小' } as const;

const LOCATION_TEXT = { city: '東京市', bay: '東京灣' } as const;

export function describeEvent(
  e: GameEvent,
  nameOf: (seat: number) => string = (seat) => `座位 ${String(seat)}`,
  cardName: (id: string) => string = (id) => id,
): string {
  switch (e.type) {
    case 'first_player_decided':
      return `先手：${nameOf(e.firstSeat)}（擲骰 ${e.rounds.length} 輪）`;
    case 'turn_started':
      return `── 第 ${e.round} 輪，${nameOf(e.seat)} 的回合`;
    case 'vp_gained':
      return `  ${nameOf(e.seat)} +${e.amount} VP（${e.reason}）`;
    case 'dice_rolled':
      return `  ${nameOf(e.seat)} 第 ${e.rollNumber} 擲：${faces(e.dice)}`;
    case 'rolling_ended':
      return `  ${nameOf(e.seat)} 停止擲骰：${faces(e.dice)}`;
    case 'energy_gained':
      return `  ${nameOf(e.seat)} +${e.amount} 能量`;
    case 'healed':
      return `  ${nameOf(e.seat)} 回復 ${e.amount} HP`;
    case 'heal_ignored':
      return `  ${nameOf(e.seat)} 在東京內，${e.faces} 個治療面無效`;
    case 'smash':
      return `  ${nameOf(e.attacker)} 攻擊 ${e.damage} → 目標 ${e.targets.map(nameOf).join('、')}`;
    case 'damage_taken':
      return `    ${nameOf(e.seat)} -${e.amount} HP（剩 ${e.hp}）${e.cause ? `〔${CAUSE_TEXT[e.cause]}〕` : ''}`;
    case 'damage_prevented':
      return `    ${nameOf(e.seat)} 擋下 ${e.amount} 點傷害${e.cardId ? `（${cardName(e.cardId)}）` : ''}`;
    case 'eliminated':
      return `    ${nameOf(e.seat)} 被淘汰`;
    case 'revived':
      return `    ${nameOf(e.seat)} 復活，HP ${e.hp}${e.partner === null ? '' : `，與 ${nameOf(e.partner)} 結為搭檔`}`;
    case 'vp_lost':
      return `  ${nameOf(e.seat)} -${e.amount} VP`;
    case 'energy_spent':
      return `  ${nameOf(e.seat)} 花費 ${e.amount} 能量`;
    case 'card_revealed':
      return `  翻開：${cardName(e.cardId)}`;
    case 'market_swept':
      return `  ${nameOf(e.seat)} 花 2 能量清掉商店`;
    case 'card_bought':
      return `  ${nameOf(e.seat)} 買下 ${cardName(e.cardId)}（${e.cost} 能量${e.from === null ? '' : `，向 ${nameOf(e.from)}`}）`;
    case 'card_discarded':
      return e.reason === 'instant' ? '' : `  ${cardName(e.cardId)} 被棄掉（${e.reason}）`;
    case 'card_used':
      return `  ${nameOf(e.seat)} 使用 ${cardName(e.cardId)}`;
    case 'card_swapped':
      return `  ${nameOf(e.seat)} 與 ${nameOf(e.from)} 換卡：給出 ${cardName(e.gave)}，拿走 ${cardName(e.took)}`;
    case 'die_changed':
      return `  ${nameOf(e.seat)} 把第 ${e.index + 1} 顆骰子改成 ${faces([e.face])}`;
    case 'die_rerolled':
      return `  ${nameOf(e.by)} 重擲 ${nameOf(e.seat)} 的第 ${e.index + 1} 顆骰子：${faces([e.face])}`;
    case 'counter_gained':
      return `  ${nameOf(e.seat)} 得到${COUNTER_TEXT[e.counter]}指示物（共 ${e.total}）`;
    case 'counter_removed':
      return `  ${nameOf(e.seat)} 移除${COUNTER_TEXT[e.counter]}指示物（剩 ${e.total}）`;
    case 'max_hp_changed':
      return `  ${nameOf(e.seat)} 最大 HP 變成 ${e.maxHp}`;
    case 'extra_turn_granted':
      return `  ${nameOf(e.seat)} 將再進行一個回合`;
    case 'deck_peeked':
      return e.cardId ? `  ${nameOf(e.seat)} 偷看牌庫頂：${cardName(e.cardId)}` : `  ${nameOf(e.seat)} 偷看了牌庫頂`;
    case 'dice_penalty':
      return `  全場少擲一顆骰子（${e.seats.length} 個效果）`;
    case 'yield_requested':
      return `  詢問 ${nameOf(e.seat)} 是否讓位`;
    case 'yielded':
      return `  ${nameOf(e.seat)} 讓出${LOCATION_TEXT[e.location]}`;
    case 'stayed':
      return `  ${nameOf(e.seat)} 留在東京`;
    case 'entered_tokyo':
      return `  ${nameOf(e.seat)} 進入${LOCATION_TEXT[e.location]}`;
    case 'bay_closed':
      return `  東京灣關閉：${nameOf(e.seat)} ${e.movedTo ? '移到東京市' : '離開東京'}`;
    case 'turn_ended':
      return '';
    case 'round_ended':
      return `══ 第 ${e.round} 輪結束`;
    case 'game_over':
      return `★ 遊戲結束：勝者 ${e.winners.length ? e.winners.map(nameOf).join('、') : '（無）'}（${e.reason}）`;
  }
}
