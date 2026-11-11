import type { Seed } from '@kot/rules';
import type { CardSetInfo } from '@kot/protocol';
import type { LoadedCardSet } from '@kot/cardsets/pure';
import { Gateway } from './gateway.js';
import { RoomManager } from './manager.js';
import { cryptoRandomInt, randomSeed } from './random.js';
import { DEFAULT_TIMINGS, type Timings } from './room.js';
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
}

export interface GameHost {
  gateway: Gateway;
  rooms: RoomManager;
  sessions: SessionStore;
  cardSetInfos: CardSetInfo[];
}

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

  return { gateway, rooms, sessions, cardSetInfos };
}
