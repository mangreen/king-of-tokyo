import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EVENTS,
  PROTOCOL_VERSION,
  ServerErrorSchema,
  ServerHelloSchema,
  type ServerError,
} from '@kot/protocol';
import { buildApp, type App } from './app.js';
import type { ServerConfig } from './config.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';
const config: ServerConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  allowedOrigins: [ALLOWED_ORIGIN],
};

let app: App;
let url: string;
const clients: Socket[] = [];

function client(extraHeaders: Record<string, string> = {}): Socket {
  const socket = connect(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders,
  });
  clients.push(socket);
  return socket;
}

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (payload: T) => resolve(payload));
  });
}

beforeEach(async () => {
  app = buildApp(config, { helloTimeoutMs: 300 });
  await app.fastify.listen({ host: config.host, port: 0 });
  const { port } = app.fastify.server.address() as AddressInfo;
  url = `http://127.0.0.1:${String(port)}`;
});

afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await app.fastify.close();
});

describe('GET /healthz', () => {
  it('回傳 ok', async () => {
    const response = await app.fastify.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('Socket.IO 握手', () => {
  it('合法握手後收到 server:hello 與不可猜測的 connectionId', async () => {
    const socket = client({ Origin: ALLOWED_ORIGIN });
    const reply = once<unknown>(socket, EVENTS.serverHello);
    socket.emit(EVENTS.clientHello, { protocolVersion: PROTOCOL_VERSION, nickname: 'Mang' });
    const hello = ServerHelloSchema.parse(await reply);
    expect(hello.connectionId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('不同連線拿到不同的 connectionId', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const socket = client({ Origin: ALLOWED_ORIGIN });
      const reply = once<unknown>(socket, EVENTS.serverHello);
      socket.emit(EVENTS.clientHello, { protocolVersion: PROTOCOL_VERSION, nickname: 'Mang' });
      ids.push(ServerHelloSchema.parse(await reply).connectionId);
    }
    expect(new Set(ids).size).toBe(2);
  });

  it('協定版本不符：回傳 protocol_mismatch 並中斷', async () => {
    const socket = client({ Origin: ALLOWED_ORIGIN });
    const error = once<unknown>(socket, EVENTS.serverError);
    const closed = once<string>(socket, 'disconnect');
    socket.emit(EVENTS.clientHello, { protocolVersion: PROTOCOL_VERSION + 1, nickname: 'Mang' });
    expect(ServerErrorSchema.parse(await error).code).toBe('protocol_mismatch');
    await closed;
  });

  it('格式錯誤的握手：回傳 invalid_message 並中斷，不洩漏內部細節', async () => {
    const socket = client({ Origin: ALLOWED_ORIGIN });
    const error = once<ServerError>(socket, EVENTS.serverError);
    const closed = once<string>(socket, 'disconnect');
    socket.emit(EVENTS.clientHello, { protocolVersion: PROTOCOL_VERSION, nickname: '<script>' });
    const received = await error;
    expect(received.code).toBe('invalid_message');
    expect(JSON.stringify(received)).not.toMatch(/stack|node_modules|zod/i);
    await closed;
  });

  it('逾時未握手的連線會被中斷', async () => {
    const socket = client({ Origin: ALLOWED_ORIGIN });
    const error = once<ServerError>(socket, EVENTS.serverError);
    const closed = once<string>(socket, 'disconnect');
    expect((await error).code).toBe('invalid_message');
    await closed;
  });

  it('不在允許清單的 Origin 無法連線', async () => {
    const socket = client({ Origin: 'http://evil.example' });
    const failure = once<Error>(socket, 'connect_error');
    await failure;
    expect(socket.connected).toBe(false);
  });
});
