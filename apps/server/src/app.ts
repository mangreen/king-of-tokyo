import { randomInt } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import type { ServerConfig } from './config.js';
import {
  createPublisher,
  handleConnection,
  randomSeed,
  type ClientToServerEvents,
  type GameSocket,
  type ServerToClientEvents,
} from './connection.js';
import { RoomManager } from './rooms/manager.js';
import { DEFAULT_TIMINGS, type Timings } from './rooms/room.js';
import { realScheduler, type Scheduler } from './rooms/scheduler.js';
import { SessionStore } from './rooms/sessions.js';

/** 握手逾時：連線後必須在此時間內送出 client:hello。 */
export const HELLO_TIMEOUT_MS = 5_000;
/** 單則訊息大小上限（bytes），遠大於合法訊息，用來擋掉濫用。 */
const MAX_MESSAGE_BYTES = 10_000;
/** 斷線且不在房間的身分保留時間。 */
const SESSION_TTL_MS = 10 * 60_000;

export interface App {
  fastify: FastifyInstance;
  io: SocketServer<ClientToServerEvents, ServerToClientEvents>;
  rooms: RoomManager;
  sessions: SessionStore;
}

export interface AppOptions {
  helloTimeoutMs?: number;
  /** 測試用：注入假時鐘與固定 seed、縮短計時。 */
  scheduler?: Scheduler;
  timings?: Timings;
  newSeed?: () => number;
}

export function buildApp(config: ServerConfig, options: AppOptions = {}): App {
  const helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const scheduler = options.scheduler ?? realScheduler;
  const fastify = Fastify({ logger: config.nodeEnv === 'production' });

  fastify.get('/healthz', () => ({ status: 'ok' as const }));

  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(fastify.server, {
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    cors: { origin: config.allowedOrigins },
    // CORS 只約束瀏覽器；這裡額外在伺服器端檢查 Origin。
    // 沒有 Origin 標頭的請求（非瀏覽器客戶端，如測試工具）允許通過，
    // 瀏覽器一定會帶 Origin，因此仍可擋掉其他網站的惡意頁面。
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, origin === undefined || config.allowedOrigins.includes(origin));
    },
  });

  const sockets = new Map<string, GameSocket>();
  const rooms: RoomManager = new RoomManager({
    scheduler,
    publisher: createPublisher(sockets),
    newSeed: options.newSeed ?? randomSeed,
    timings: options.timings ?? DEFAULT_TIMINGS,
    randomInt: (max) => randomInt(max),
    maxRooms: config.maxRooms,
  });
  const sessions = new SessionStore(scheduler, SESSION_TTL_MS, (id) => rooms.hasRoom(id));

  io.on('connection', (socket) => {
    handleConnection(socket, { sessions, rooms, scheduler, helloTimeoutMs, sockets });
  });

  fastify.addHook('onClose', async () => {
    // io.close() 會一併關閉底層 http server；Fastify 隨後的關閉對已停止的 server 是無害的
    await io.close();
  });

  return { fastify, io, rooms, sessions };
}
