import type { Seed } from '@kot/rules';
import type { CardSetInfo } from '@kot/protocol';
import type { LoadedCardSet } from '@kot/cardsets/pure';
import { Gateway } from './gateway.js';
import { RoomManager } from './manager.js';
import { cryptoRandomInt, randomSeed } from './random.js';
import { DEFAULT_TIMINGS, type Room, type Timings } from './room.js';
import type { RoomReplica } from './replica.js';
import type { Scheduler } from './scheduler.js';
import { SessionStore } from './sessions.js';

/** 斷線且不在任何房間的身分保留多久（毫秒）。 */
export const SESSION_TTL_MS = 10 * 60_000;
export const HELLO_TIMEOUT_MS = 5_000;

export interface GameHostOptions {
  scheduler: Scheduler;
  cardSets: ReadonlyMap<string, LoadedCardSet>;
  defaultCardSetId: string;
  maxRooms: number;
  /** 0＝不踢閒置連線。 */
  idleKickMs: number;
  helloTimeoutMs?: number;
  timings?: Timings;
  newSeed?: () => Seed;
  /** 回傳 [0, max) 的整數（CSPRNG）。 */
  randomInt?: (maxExclusive: number) => number;
  sessionTtlMs?: number;
  /** 房間內容改變時通知（持久化用）。 */
  onRoomChange?: (code: string) => void;
  /** 房間關閉時通知。 */
  onRoomClosed?: (code: string) => void;
}

export interface GameHost {
  gateway: Gateway;
  rooms: RoomManager;
  sessions: SessionStore;
  cardSetInfos: CardSetInfo[];
  /** 把房間序列化成複本（含成員的 token 雜湊）；沒有這個房間時為 null。 */
  exportRoom(code: string): RoomReplica | null;
  /**
   * 從複本還原房間與成員身分（房主重新整理後接回）。成功後成員用原本的 token 重新握手就會接回座位。
   */
  importRoom(replica: RoomReplica, graceMs: number): { ok: true } | { ok: false; reason: string };
}

/** 復原寬限的預設值：還原後這麼久之內，輪到離線玩家時不會太快代打。 */
export const RECOVERY_GRACE_MS = 20_000;

/**
 * 組裝「一個遊戲主機」：房間管理、身分、閘道。伺服器權威模式在 Node 建一個，
 * 離線（以及之後的房主）模式在瀏覽器 Worker 建一個；兩者跑的是同一份程式。
 */
export function createGameHost(options: GameHostOptions): GameHost {
  const cardSetInfos: CardSetInfo[] = [...options.cardSets.values()].map((loaded) => ({
    id: loaded.set.id,
    name: loaded.set.name,
    cardCount: loaded.set.cards.length,
  }));

  // Gateway 提供 publisher，RoomManager 又要用它：先建立兩者再互相接上。
  let gateway: Gateway | null = null;
  const publisher = {
    roomState: (...args: Parameters<Gateway['publisher']['roomState']>) => {
      gateway?.publisher.roomState(...args);
    },
    gameCards: (...args: Parameters<Gateway['publisher']['gameCards']>) => {
      gateway?.publisher.gameCards(...args);
    },
    gameUpdate: (...args: Parameters<Gateway['publisher']['gameUpdate']>) => {
      gateway?.publisher.gameUpdate(...args);
    },
  };

  const rooms = new RoomManager({
    scheduler: options.scheduler,
    publisher,
    newSeed: options.newSeed ?? randomSeed,
    timings: options.timings ?? DEFAULT_TIMINGS,
    randomInt: options.randomInt ?? cryptoRandomInt,
    maxRooms: options.maxRooms,
    cardSets: options.cardSets,
    defaultCardSetId: options.defaultCardSetId,
    ...(options.onRoomChange === undefined
      ? {}
      : {
          onRoomChange: (room: Room) => {
            options.onRoomChange?.(room.code);
          },
        }),
    ...(options.onRoomClosed === undefined
      ? {}
      : {
          onRoomClosed: (room: Room) => {
            options.onRoomClosed?.(room.code);
          },
        }),
  });
  const sessions = new SessionStore(
    options.scheduler,
    options.sessionTtlMs ?? SESSION_TTL_MS,
    (id) => rooms.hasRoom(id),
  );
  gateway = new Gateway({
    scheduler: options.scheduler,
    sessions,
    rooms,
    cardSets: cardSetInfos,
    defaultCardSetId: options.defaultCardSetId,
    helloTimeoutMs: options.helloTimeoutMs ?? HELLO_TIMEOUT_MS,
    idleKickMs: options.idleKickMs,
  });

  return {
    gateway,
    rooms,
    sessions,
    cardSetInfos,
    exportRoom(code) {
      const room = rooms.room(code);
      return room ? room.toReplica(0, (id) => sessions.get(id)?.tokenHash ?? null) : null;
    },
    importRoom(replica, graceMs) {
      const result = rooms.restoreRoom(replica, { graceMs });
      if (!result.ok) return result;
      for (const m of replica.members) {
        if (m.bot || m.tokenHash === null) continue;
        sessions.restore({ playerId: m.id, nickname: m.nickname, tokenHash: m.tokenHash });
      }
      return result;
    },
  };
}
