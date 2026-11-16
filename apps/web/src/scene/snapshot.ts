import { legalActions, type GameState, type RulesEnv } from '@kot/rules';
import type { RoomSnapshot } from '@kot/protocol';
import type { SceneSnapshot } from './SceneRenderer.js';
import { monsterKindOf } from './roster.js';

/**
 * 商店開著＝買牌階段，而且行動中的玩家真的買得起商店裡的牌（飛碟入場的條件）。
 * 只算「買牌」：買不起、只剩「花能量清商店」時商店等於沒開，飛碟不該出現。
 */
export function isShopOpen(state: GameState, env: RulesEnv): boolean {
  return (
    state.phase === 'buy' &&
    legalActions(state, env).some((a) => a.type === 'buy' && a.from === undefined)
  );
}

/** 把房間與遊戲狀態轉成場景需要的最小快照（純函式）。 */
export function toSnapshot(
  room: Pick<RoomSnapshot, 'players'>,
  state: Pick<GameState, 'config' | 'monsters'> &
    Partial<Pick<GameState, 'market' | 'phase' | 'outcome'>>,
  actorSeat: number | null,
  selfId: string,
  /** 商店開著：買牌階段而且有東西可買（飛碟入場的條件）。 */
  shopOpen = false,
): SceneSnapshot {
  const nameOf = (seat: number): string =>
    room.players.find((p) => p.seat === seat)?.nickname ?? `座位 ${String(seat)}`;
  const kindOf = (seat: number): number =>
    monsterKindOf(seat, room.players.find((p) => p.seat === seat)?.monster);
  return {
    playerCount: state.config.playerCount,
    activeSeat: actorSeat,
    mySeat: room.players.find((p) => p.id === selfId)?.seat ?? null,
    shop: shopOpen ? (state.market?.faceUp ?? []) : null,
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
    })),
  };
}
