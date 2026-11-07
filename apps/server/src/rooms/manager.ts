import type { AckErrorCode } from '@kot/protocol';
import type { LoadedCardSet } from '@kot/cardsets';
import { Room, type Publisher, type Result, type RoomDeps, type Timings } from './room.js';
import { generateRoomCode } from './roomCode.js';
import type { Scheduler } from './scheduler.js';

export interface ManagerDeps {
  scheduler: Scheduler;
  publisher: Publisher;
  newSeed: () => number;
  timings: Timings;
  /** 回傳 [0, max) 的整數（CSPRNG）。 */
  randomInt: (maxExclusive: number) => number;
  maxRooms: number;
  /** 可用的卡牌組（id → 內容）與預設值。 */
  cardSets: ReadonlyMap<string, LoadedCardSet>;
  defaultCardSetId: string;
}

export type CreateResult = { ok: true; code: string } | { ok: false; code: AckErrorCode };

export interface Identity {
  id: string;
  nickname: string;
}

const MAX_CODE_ATTEMPTS = 20;

/** 管理所有房間，以及「玩家目前在哪個房間」。一位玩家同時只能在一個房間。 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly playerRoom = new Map<string, string>();

  constructor(private readonly deps: ManagerDeps) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  hasRoom(playerId: string): boolean {
    return this.playerRoom.has(playerId);
  }

  roomOf(playerId: string): Room | undefined {
    const code = this.playerRoom.get(playerId);
    return code === undefined ? undefined : this.rooms.get(code);
  }

  createRoom(host: Identity, cardSetId?: string): CreateResult {
    const cardSet = this.deps.cardSets.get(cardSetId ?? this.deps.defaultCardSetId);
    if (!cardSet) return { ok: false, code: 'unknown_card_set' };
    if (this.playerRoom.has(host.id)) return { ok: false, code: 'already_in_room' };
    if (this.rooms.size >= this.deps.maxRooms) return { ok: false, code: 'too_many_rooms' };

    let code = '';
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const candidate = generateRoomCode(this.deps.randomInt);
      if (!this.rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (code === '') return { ok: false, code: 'too_many_rooms' };

    const room = new Room(code, host, cardSet, this.roomDeps());
    this.rooms.set(code, room);
    this.playerRoom.set(host.id, code);
    return { ok: true, code };
  }

  joinRoom(code: string, player: Identity): Result {
    if (this.playerRoom.has(player.id)) return { ok: false, code: 'already_in_room' };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, code: 'room_not_found' };
    const result = room.join(player);
    if (result.ok) this.playerRoom.set(player.id, code);
    return result;
  }

  leave(playerId: string): Result {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, code: 'not_in_room' };
    const result = room.leave(playerId);
    if (result.ok) {
      this.playerRoom.delete(playerId);
      this.deps.publisher.roomState(playerId, null);
    }
    return result;
  }

  private roomDeps(): RoomDeps {
    return {
      scheduler: this.deps.scheduler,
      publisher: this.deps.publisher,
      newSeed: this.deps.newSeed,
      timings: this.deps.timings,
      onMemberRemoved: (playerId) => {
        this.playerRoom.delete(playerId);
        this.deps.publisher.roomState(playerId, null);
      },
      onClose: (room) => {
        this.rooms.delete(room.code);
        for (const id of room.memberIds()) {
          this.playerRoom.delete(id);
          this.deps.publisher.roomState(id, null);
        }
      },
    };
  }
}
