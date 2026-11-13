import type { AckErrorCode } from '@kot/protocol';
import type { Seed } from '@kot/rules';
import type { LoadedCardSet } from '@kot/cardsets/pure';
import {
  Room,
  type Publisher,
  type RestoreOptions,
  type Result,
  type RoomDeps,
  type Timings,
} from './room.js';
import { ReplicaError, type RoomReplica } from './replica.js';
import { generateRoomCode } from './roomCode.js';
import type { Scheduler } from './scheduler.js';

export interface ManagerDeps {
  scheduler: Scheduler;
  publisher: Publisher;
  newSeed: () => Seed;
  timings: Timings;
  /** 回傳 [0, max) 的整數（CSPRNG）。 */
  randomInt: (maxExclusive: number) => number;
  maxRooms: number;
  /** 可用的卡牌組（id → 內容）與預設值。 */
  cardSets: ReadonlyMap<string, LoadedCardSet>;
  defaultCardSetId: string;
  /** 房間內容改變（成員、狀態、動作日誌）；用來做持久化。 */
  onRoomChange?: (room: Room) => void;
  /** 房間關閉（對局結束後逾時、沒人了…）。 */
  onRoomClosed?: (room: Room) => void;
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

  /** 目前所有房間都處於「對局進行中、真人都連著」狀態（沒有房間時為 false）。 */
  get allSteady(): boolean {
    if (this.rooms.size === 0) return false;
    for (const room of this.rooms.values()) if (!room.steady) return false;
    return true;
  }

  hasRoom(playerId: string): boolean {
    return this.playerRoom.has(playerId);
  }

  roomOf(playerId: string): Room | undefined {
    const code = this.playerRoom.get(playerId);
    return code === undefined ? undefined : this.rooms.get(code);
  }

  private presetRoomCode: string | null = null;

  /** 指定「下一次 createRoom」使用的房號（房主模式：房號由中繼伺服器登記）。只生效一次。 */
  presetCode(code: string): void {
    this.presetRoomCode = code;
  }

  createRoom(host: Identity, cardSetId?: string): CreateResult {
    const cardSet = this.deps.cardSets.get(cardSetId ?? this.deps.defaultCardSetId);
    if (!cardSet) return { ok: false, code: 'unknown_card_set' };
    if (this.playerRoom.has(host.id)) return { ok: false, code: 'already_in_room' };
    if (this.rooms.size >= this.deps.maxRooms) return { ok: false, code: 'too_many_rooms' };

    let code = '';
    // 房主模式：房號由中繼伺服器登記並指定（presetCode），只能用一次
    const preset = this.presetRoomCode;
    this.presetRoomCode = null;
    if (preset !== null) {
      if (this.rooms.has(preset)) return { ok: false, code: 'too_many_rooms' };
      code = preset;
    }
    for (let attempt = 0; code === '' && attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
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

  /**
   * 從複本還原一個房間（房主重新整理後接回）。成員都先視為離線，等他們用 token 重新連回來。
   * 失敗（卡牌組不存在或不一致、日誌無法重放、房號衝突、已達上限）時不會留下任何東西。
   */
  restoreRoom(
    replica: RoomReplica,
    options: RestoreOptions,
  ): { ok: true } | { ok: false; reason: string } {
    if (this.rooms.has(replica.code)) return { ok: false, reason: '房號已存在' };
    if (this.rooms.size >= this.deps.maxRooms) return { ok: false, reason: '房間數已達上限' };
    const cardSet = this.deps.cardSets.get(replica.cardSetId);
    if (!cardSet) return { ok: false, reason: `找不到卡牌組 ${replica.cardSetId}` };
    const host = replica.members.find((m) => m.id === replica.hostId);
    if (!host) return { ok: false, reason: '找不到房主' };
    for (const m of replica.members) {
      if (!m.bot && !m.left && this.playerRoom.has(m.id))
        return { ok: false, reason: '玩家已在其他房間' };
    }
    let room: Room;
    try {
      room = new Room(
        replica.code,
        { id: host.id, nickname: host.nickname },
        cardSet,
        this.roomDeps(),
        { data: replica, options },
      );
    } catch (error) {
      if (error instanceof ReplicaError) return { ok: false, reason: error.message };
      throw error;
    }
    this.rooms.set(replica.code, room);
    for (const id of room.memberIds()) this.playerRoom.set(id, replica.code);
    return { ok: true };
  }

  /** 用房號取得房間。 */
  room(code: string): Room | undefined {
    return this.rooms.get(code);
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
      ...(this.deps.onRoomChange === undefined ? {} : { onChange: this.deps.onRoomChange }),
      onClose: (room) => {
        this.rooms.delete(room.code);
        this.deps.onRoomClosed?.(room);
        for (const id of room.memberIds()) {
          this.playerRoom.delete(id);
          this.deps.publisher.roomState(id, null);
        }
      },
    };
  }
}
