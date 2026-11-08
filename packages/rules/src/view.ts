/**
 * 視角過濾：伺服器送給玩家的狀態與事件，不能洩漏隱藏資訊（牌庫順序、亂數狀態、窺看到的牌）。
 */
import type { GameEvent, GameState } from './types.js';
import { cloneState } from './state.js';

/** viewer 為座位，旁觀者傳 null。牌庫內容以空字串占位（保留張數）。 */
export function redactState(state: GameState, viewer: number | null): GameState {
  const out = cloneState(state);
  out.rng = typeof out.rng === 'number' ? 0 : { key: [0, 0, 0, 0], n: 0 }; // 亂數狀態一旦洩漏就能預測骰子
  if (out.market) {
    out.market.deck = out.market.deck.map(() => '');
  }
  if (viewer !== out.turn.seat) {
    out.turn.peek = null;
  }
  return out;
}

export function redactEvent(event: GameEvent, viewer: number | null): GameEvent {
  if (event.type === 'deck_peeked' && event.seat !== viewer) {
    return { ...event, cardId: null };
  }
  return event;
}
