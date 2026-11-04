import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server as SocketServer, type Socket } from 'socket.io';
import {
  ClientHelloSchema,
  EVENTS,
  PROTOCOL_VERSION,
  type ServerError,
  type ServerHello,
} from '@kot/protocol';
import type { ServerConfig } from './config.js';

interface ClientToServerEvents {
  [EVENTS.clientHello]: (payload: unknown) => void;
}

interface ServerToClientEvents {
  [EVENTS.serverHello]: (payload: ServerHello) => void;
  [EVENTS.serverError]: (payload: ServerError) => void;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** 握手逾時：連線後必須在此時間內送出 client:hello。 */
export const HELLO_TIMEOUT_MS = 5_000;
/** 單則訊息大小上限（bytes），遠大於合法訊息，用來擋掉濫用。 */
const MAX_MESSAGE_BYTES = 10_000;

export interface App {
  fastify: FastifyInstance;
  io: SocketServer<ClientToServerEvents, ServerToClientEvents>;
}

function rejectWith(socket: GameSocket, error: ServerError): void {
  socket.emit(EVENTS.serverError, error);
  socket.disconnect(true);
}

function handleConnection(socket: GameSocket, helloTimeoutMs: number): void {
  const timer = setTimeout(() => {
    rejectWith(socket, { code: 'invalid_message', message: '握手逾時' });
  }, helloTimeoutMs);

  socket.on('disconnect', () => {
    clearTimeout(timer);
  });

  // once：每個連線只接受一次握手，避免重複握手造成狀態混亂
  socket.once(EVENTS.clientHello, (payload) => {
    clearTimeout(timer);
    const parsed = ClientHelloSchema.safeParse(payload);
    if (!parsed.success) {
      rejectWith(socket, { code: 'invalid_message', message: '握手訊息格式錯誤' });
      return;
    }
    if (parsed.data.protocolVersion !== PROTOCOL_VERSION) {
      rejectWith(socket, {
        code: 'protocol_mismatch',
        message: `協定版本不符，伺服器為 ${PROTOCOL_VERSION}，請重新整理頁面`,
      });
      return;
    }
    // 連線識別使用 CSPRNG，不可猜測；M2 起作為重連 token 的基礎
    const connectionId = randomBytes(16).toString('hex');
    socket.emit(EVENTS.serverHello, { protocolVersion: PROTOCOL_VERSION, connectionId });
  });
}

export function buildApp(config: ServerConfig, options: { helloTimeoutMs?: number } = {}): App {
  const helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
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

  io.on('connection', (socket) => {
    handleConnection(socket, helloTimeoutMs);
  });

  fastify.addHook('onClose', async () => {
    // io.close() 會一併關閉底層 http server；Fastify 隨後的關閉對已停止的 server 是無害的
    await io.close();
  });

  return { fastify, io };
}
