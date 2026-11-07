import { ACK_ERROR_CODES, type AckErrorCode } from '@kot/protocol';

/** 伺服器回應的錯誤碼 → 給玩家看的訊息。每個錯誤碼都必須有訊息（有測試把關）。 */
export const ACK_MESSAGES: Record<AckErrorCode, string> = {
  invalid_message: '送出的資料格式不正確',
  rate_limited: '操作太頻繁，請稍等一下',
  already_in_room: '你已經在一個房間裡了',
  not_in_room: '你不在任何房間裡',
  room_not_found: '找不到這個房號',
  room_full: '房間已滿（最多 6 人）',
  game_in_progress: '對局已經開始，無法加入',
  too_many_rooms: '伺服器房間數已達上限，請稍後再試',
  not_host: '只有房主可以開始遊戲',
  not_enough_players: '至少需要 2 位玩家',
  not_ready: '還有玩家尚未準備',
  wrong_state: '目前無法執行這個操作',
  game_over: '遊戲已經結束',
  not_your_turn: '還沒輪到你',
  wrong_phase: '現在不能做這個動作',
  invalid_keep: '請至少留一顆骰子重擲（不要全部保留）',
  invalid_action: '動作不正確',
  no_rolls_left: '已經沒有重擲次數了',
  roll_first: '請先擲骰',
  not_enough_energy: '能量不足',
  card_unavailable: '這張牌現在買不到',
  cannot_use: '現在不能使用這張卡',
  unknown_card_set: '找不到這個卡牌組',
};

export function ackMessage(code: AckErrorCode): string {
  return ACK_MESSAGES[code];
}

export function hasAllAckMessages(): boolean {
  return ACK_ERROR_CODES.every((code) => ACK_MESSAGES[code].length > 0);
}
