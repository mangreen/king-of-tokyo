import Fastify, { type FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { EVENTS, RELAY_MAX_GUESTS, RELAY_NAMESPACE, type CardSetInfo } from '@kot/protocol';
import type { Seed } from '@kot/rules';
import {
  createGameHost,
  cryptoRandomInt,
  randomHex,
  HELLO_TIMEOUT_MS,
  realScheduler,
  type Gateway,
  type RoomManager,
  type Scheduler,
  type SessionStore,
  type Timings,
} from '@kot/room';
import { defaultCardSetId, loadCardSets, type LoadedCardSet } from '@kot/cardsets';
import type { ServerConfig } from './config.js';
import {
  handleConnection,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from './connection.js';
import { isOriginAllowed } from './origin.js';
import { attachRelay } from './relay/namespace.js';
import { RelayRegistry, type RelayOptions } from './relay/registry.js';
import { registerWeb } from './web.js';

export { HELLO_TIMEOUT_MS };
/**
 * 單則訊息大小上限（bytes）：Socket.IO 是整個伺服器一個值，所以取中繼需要的上限
 * （卡牌目錄約 10 KB，中繼的 data 另外限制 32 KB）。伺服器權威模式的訊息都有嚴格的 zod schema，不受影響。
 */
const MAX_MESSAGE_BYTES = 65_536;
/** 房主斷線後保留房號的時間（毫秒）。 */
export const RELAY_HOST_GRACE_MS = 30_000;

export interface App {
  fastify: FastifyInstance;
  gateway: Gateway;
  relay: RelayRegistry;
  io: SocketServer<ClientToServerEvents, ServerToClientEvents>;
  rooms: RoomManager;
  sessions: SessionStore;
  /** 已載入的卡牌組摘要（記錄用）。 */
  cardSetInfos: CardSetInfo[];
}

export interface AppOptions {
  helloTimeoutMs?: number;
  /** 測試用：注入假時鐘與固定 seed、縮短計時。 */
  scheduler?: Scheduler;
  timings?: Timings;
  newSeed?: () => Seed;
  /** 測試用：房主斷線後保留房號的時間（毫秒）。 */
  relayHostGraceMs?: number;
  /** 測試用：覆寫中繼的限流（例如用假時鐘加速對局時放寬頻率與頻寬）。 */
  relayLimits?: Pick<
    RelayOptions,
    'hostBurst' | 'hostPerSecond' | 'roomBytesBurst' | 'roomBytesPerSecond'
  >;
  /** 測試用：直接提供卡牌組，不讀檔。 */
  cardSets?: ReadonlyMap<string, LoadedCardSet>;
}

export function buildApp(config: ServerConfig, options: AppOptions = {}): App {
  const helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const scheduler = options.scheduler ?? realScheduler;
  const fastify = Fastify({ logger: config.nodeEnv === 'production' });

  fastify.get('/healthz', () => ({ status: 'ok' as const }));
  if (config.webDir !== null) registerWeb(fastify, config.webDir);

  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(fastify.server, {
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    cors: { origin: config.allowedOrigins },
    // CORS 只約束瀏覽器；這裡額外在伺服器端檢查 Origin。
    // 沒有 Origin 標頭的請求（非瀏覽器客戶端，如測試工具）允許通過，
    // 瀏覽器一定會帶 Origin，因此仍可擋掉其他網站的惡意頁面。
    allowRequest: (req, callback) => {
      callback(
        null,
        isOriginAllowed(
          req.headers.origin,
          req.headers.host,
          config.allowedOrigins,
          config.allowSameOrigin,
        ),
      );
    },
  });

  const cardSets = options.cardSets ?? loadCardSets(config.cardSetsDir);
  const host = createGameHost({
    scheduler,
    cardSets,
    defaultCardSetId: defaultCardSetId(cardSets),
    maxRooms: config.maxRooms,
    idleKickMs: config.idleKickMs,
    helloTimeoutMs,
    ...(options.timings === undefined ? {} : { timings: options.timings }),
    ...(options.newSeed === undefined ? {} : { newSeed: options.newSeed }),
  });
  const { gateway, rooms, sessions, cardSetInfos } = host;

  io.on('connection', (socket) => {
    // 同時連線數上限（試玩版保護免費額度）：已連線的人不受影響，新來的被告知名額已滿
    if (io.engine.clientsCount > config.maxConnections) {
      socket.emit(EVENTS.serverError, {
        code: 'server_full',
        message: '試玩名額已滿（同時連線人數已達上限），請稍後再來',
      });
      socket.disconnect(true);
      return;
    }
    handleConnection(socket, gateway);
  });

  // 中繼：房主在瀏覽器跑房間，伺服器只登記房號、轉發不透明訊息（ADR-0007）
  const relay = new RelayRegistry({
    scheduler,
    maxRooms: config.maxRooms,
    maxGuests: RELAY_MAX_GUESTS,
    idleKickMs: config.idleKickMs,
    hostGraceMs: options.relayHostGraceMs ?? RELAY_HOST_GRACE_MS,
    ...options.relayLimits,
    randomInt: cryptoRandomInt,
    randomHex,
  });
  attachRelay(io.of(RELAY_NAMESPACE), relay, () => io.engine.clientsCount > config.maxConnections);

  // 必須在 preClose（Fastify 開始等待連線結束「之前」）就把 Socket.IO 關掉：
  // 已升級成 WebSocket 的連線不會被 Fastify 當成閒置連線關閉，若等到 onClose 才處理，
  // 只要還有玩家連著，close() 就永遠等不到結束（docker stop／Ctrl+C 會卡到被強制砍掉）。
  // io.close() 會一併關閉底層 http server；Fastify 隨後的關閉對已停止的 server 是無害的。
  fastify.addHook('preClose', async () => {
    await io.close();
  });

  return { fastify, io, gateway, relay, rooms, sessions, cardSetInfos };
}
