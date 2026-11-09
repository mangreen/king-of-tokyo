import type { GameState } from '@kot/rules';
import type { RoomSnapshot } from '@kot/protocol';
import type { SceneSnapshot } from './SceneRenderer.js';

/** 把房間與遊戲狀態轉成場景需要的最小快照（純函式）。 */
export function toSnapshot(
  room: Pick<RoomSnapshot, 'players'>,
  state: Pick<GameState, 'config' | 'monsters'>,
  actorSeat: number | null,
  selfId: string,
): SceneSnapshot {
  const nameOf = (seat: number): string =>
    room.players.find((p) => p.seat === seat)?.nickname ?? `座位 ${String(seat)}`;
  return {
    playerCount: state.config.playerCount,
    activeSeat: actorSeat,
    mySeat: room.players.find((p) => p.id === selfId)?.seat ?? null,
    monsters: state.monsters.map((m) => ({
      seat: m.seat,
      name: nameOf(m.seat),
      alive: m.alive,
      hp: m.hp,
      maxHp: m.maxHp,
      vp: m.vp,
      energy: m.energy,
      location: m.location,
    })),
  };
}
