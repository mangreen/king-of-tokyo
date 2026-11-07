import type { Face, GameEvent } from './types.js';

/** 事件的繁體中文文字描述（文字版 CLI 與網頁事件日誌共用）。空字串表示不需要顯示。 */
const FACE_TEXT: Record<string, string> = { energy: '⚡', attack: '💥', heal: '❤️' };

function faces(dice: readonly Face[]): string {
  return dice.map((f) => FACE_TEXT[String(f)] ?? String(f)).join(' ');
}

const LOCATION_TEXT = { city: '東京市', bay: '東京灣' } as const;

export function describeEvent(
  e: GameEvent,
  nameOf: (seat: number) => string = (seat) => `座位 ${String(seat)}`,
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
      return `    ${nameOf(e.seat)} -${e.amount} HP（剩 ${e.hp}）`;
    case 'eliminated':
      return `    ${nameOf(e.seat)} 被淘汰`;
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
