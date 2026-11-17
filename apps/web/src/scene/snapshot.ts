import { legalActions, type GameState, type RulesEnv } from '@kot/rules';
import type { RoomSnapshot } from '@kot/protocol';
import type { SceneSnapshot } from './SceneRenderer.js';
import { monsterKindOf } from './roster.js';

/**
 * 商店狀態（飛碟入場的條件）：
 * - `buy`：買牌階段，而且行動中的玩家真的買得起商店裡的牌 → 飛碟入場，光束裡飄著商店的牌
 * - `sweep`：買牌階段，買不起任何牌、但付得起 2 能量清商店 → 飛碟照樣入場，
 *   但光束裡飄的是 ♻ 更新圖示，提醒「可以清商店」（不是卡片）
 * - `closed`：其他情況（不是買牌階段、或什麼都做不了）→ 飛碟離場
 */
export type ShopStatus = 'buy' | 'sweep' | 'closed';

export function shopStatus(state: GameState, env: RulesEnv): ShopStatus {
  if (state.phase !== 'buy') return 'closed';
  const legal = legalActions(state, env);
  if (legal.some((a) => a.type === 'buy' && a.from === undefined)) return 'buy';
  return legal.some((a) => a.type === 'sweep') ? 'sweep' : 'closed';
}

/** 商店有東西可買（飛碟帶著牌入場）。 */
export function isShopOpen(state: GameState, env: RulesEnv): boolean {
  return shopStatus(state, env) === 'buy';
}

/** 把房間與遊戲狀態轉成場景需要的最小快照（純函式）。 */
export function toSnapshot(
  room: Pick<RoomSnapshot, 'players'>,
  state: Pick<GameState, 'config' | 'monsters'> &
    Partial<Pick<GameState, 'market' | 'phase' | 'outcome'>>,
  actorSeat: number | null,
  selfId: string,
  /** 商店狀態（飛碟入場的條件）；沒給＝關著。 */
  status: ShopStatus = 'closed',
): SceneSnapshot {
  const nameOf = (seat: number): string =>
    room.players.find((p) => p.seat === seat)?.nickname ?? `座位 ${String(seat)}`;
  const kindOf = (seat: number): number =>
    monsterKindOf(seat, room.players.find((p) => p.seat === seat)?.monster);
  return {
    playerCount: state.config.playerCount,
    activeSeat: actorSeat,
    mySeat: room.players.find((p) => p.id === selfId)?.seat ?? null,
    shop: status === 'buy' ? (state.market?.faceUp ?? []) : null,
    shopRefresh: status === 'sweep',
    winners: state.phase === 'over' ? (state.outcome?.winners ?? []) : [],
    monsters: state.monsters.map((m) => ({
      seat: m.seat,
      name: nameOf(m.seat),
      kind: kindOf(m.seat),
      alive: m.alive,
      hp: m.hp,
      maxHp: m.maxHp,
      vp: m.vp,
      energy: m.energy,
      location: m.location,
      tokens: { poison: m.tokens?.poison ?? 0, shrink: m.tokens?.shrink ?? 0 },
    })),
  };
}
