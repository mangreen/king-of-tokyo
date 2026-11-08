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
import { testCardSets } from './rooms/testing.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';
const config: ServerConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  allowedOrigins: [ALLOWED_ORIGIN],
  maxRooms: 50,
  cardSetsDir: 'card-sets',
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
  app = buildApp(config, { helloTimeoutMs: 300, cardSets: testCardSets() });
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
  it('合法握手後收到 server:hello：不可猜測的 token、公開的 playerId', async () => {
    const socket = client({ Origin: ALLOWED_ORIGIN });
    const reply = once<unknown>(socket, EVENTS.serverHello);
    socket.emit(EVENTS.clientHello, { protocolVersion: PROTOCOL_VERSION, nickname: 'Mang' });
    const hello = ServerHelloSchema.parse(await reply);
    expect(hello.sessionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(hello.playerId).toMatch(/^[0-9a-f]{16}$/);
    expect(hello.playerId).not.toBe(hello.sessionToken.slice(0, 16));
    expect(hello).toMatchObject({ resumed: false, nickname: 'Mang' });
  });

  it('不同連線拿到不同的 playerId 與 token', async () => {
    const hellos: { playerId: string; sessionToken: string }[] = [];
    for (let i = 0; i < 2; i += 1) {
      const socket = client({ Origin: ALLOWED_ORIGIN });
      const reply = once<unknown>(socket, EVENTS.serverHello);
      socket.emit(EVENTS.clientHello, { protocolVersion: PROTOCOL_VERSION, nickname: 'Mang' });
      hellos.push(ServerHelloSchema.parse(await reply));
    }
    expect(new Set(hellos.map((h) => h.playerId)).size).toBe(2);
    expect(new Set(hellos.map((h) => h.sessionToken)).size).toBe(2);
  });

  it('握手後收到 room:state（目前不在任何房間）', async () => {
    const socket = client({ Origin: ALLOWED_ORIGIN });
    const state = once<unknown>(socket, EVENTS.roomState);
    socket.emit(EVENTS.clientHello, { protocolVersion: PROTOCOL_VERSION, nickname: 'Mang' });
    expect(await state).toEqual({ room: null });
  });

  it('帶著有效 token 重新握手會接回原身分（沿用原暱稱），舊連線被取代', async () => {
    const first = client({ Origin: ALLOWED_ORIGIN });
    const helloA = once<unknown>(first, EVENTS.serverHello);
    first.emit(EVENTS.clientHello, { protocolVersion: PROTOCOL_VERSION, nickname: 'Mang' });
    const original = ServerHelloSchema.parse(await helloA);

    const replaced = once<ServerError>(first, EVENTS.serverError);
    const second = client({ Origin: ALLOWED_ORIGIN });
    const helloB = once<unknown>(second, EVENTS.serverHello);
    second.emit(EVENTS.clientHello, {
      protocolVersion: PROTOCOL_VERSION,
      nickname: 'Other',
      sessionToken: original.sessionToken,
    });
    const resumed = ServerHelloSchema.parse(await helloB);
    expect(resumed).toMatchObject({
      resumed: true,
      playerId: original.playerId,
      sessionToken: original.sessionToken,
      nickname: 'Mang',
    });
    expect((await replaced).code).toBe('session_replaced');
  });

  it('未知的 token 視為新玩家，不報錯也不洩漏 token 是否存在', async () => {
    const socket = client({ Origin: ALLOWED_ORIGIN });
    const reply = once<unknown>(socket, EVENTS.serverHello);
    socket.emit(EVENTS.clientHello, {
      protocolVersion: PROTOCOL_VERSION,
      nickname: 'Mang',
      sessionToken: 'cd'.repeat(32),
    });
    const hello = ServerHelloSchema.parse(await reply);
    expect(hello.resumed).toBe(false);
    expect(hello.sessionToken).not.toBe('cd'.repeat(32));
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
