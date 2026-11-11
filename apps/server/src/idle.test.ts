import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EVENTS,
  PROTOCOL_VERSION,
  ServerErrorSchema,
  ServerHelloSchema,
  type ServerError,
  type ServerHello,
} from '@kot/protocol';
import { buildApp, type App } from './app.js';
import type { ServerConfig } from './config.js';
import { testCardSets } from '@kot/room/testing-fs';

const ORIGIN = 'http://localhost:5173';
const IDLE_MS = 300;

function config(idleKickMs: number): ServerConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    allowedOrigins: [ORIGIN],
    maxRooms: 50,
    cardSetsDir: 'card-sets',
    maxConnections: 100,
    idleKickMs,
    webDir: null,
    allowSameOrigin: false,
  };
}

let app: App | null = null;
const sockets: Socket[] = [];

async function start(idleKickMs: number): Promise<string> {
  app = buildApp(config(idleKickMs), { helloTimeoutMs: 5000, cardSets: testCardSets() });
  await app.fastify.listen({ host: '127.0.0.1', port: 0 });
  return `http://127.0.0.1:${String((app.fastify.server.address() as AddressInfo).port)}`;
}

function client(url: string): Socket {
  const s = connect(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: { origin: ORIGIN },
  });
  sockets.push(s);
  return s;
}

function hello(s: Socket, token?: string): Promise<ServerHello> {
  return new Promise((resolve) => {
    s.once(EVENTS.serverHello, (p: unknown) => {
      resolve(ServerHelloSchema.parse(p));
    });
    s.emit(EVENTS.clientHello, {
      protocolVersion: PROTOCOL_VERSION,
      nickname: '閒置測試',
      ...(token === undefined ? {} : { sessionToken: token }),
    });
  });
}

/** 收集伺服器錯誤，並回傳「連線被中斷」的時間點（毫秒，從呼叫起算）。 */
function watchKick(s: Socket): { errors: ServerError[]; closedAt: () => number | null } {
  const errors: ServerError[] = [];
  let closed: number | null = null;
  const t0 = Date.now();
  s.on(EVENTS.serverError, (p: unknown) => errors.push(ServerErrorSchema.parse(p)));
  s.on('disconnect', () => {
    closed = Date.now() - t0;
  });
  return { errors, closedAt: () => closed };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  await app?.fastify.close();
  app = null;
});

describe('閒置踢除', () => {
  it('登入後完全沒有動作：超過閒置時間就被中斷，並告知原因', async () => {
    const url = await start(IDLE_MS);
    const s = client(url);
    await hello(s, undefined);
    const watch = watchKick(s);
    await sleep(IDLE_MS + 400);
    expect(watch.errors).toEqual([{ code: 'idle_timeout', message: expect.any(String) as string }]);
    expect(s.connected).toBe(false);
    expect(watch.closedAt()).not.toBeNull();
  });

  it('持續送 client:active 就不會被踢；停下來之後才被踢', async () => {
    const url = await start(IDLE_MS);
    const s = client(url);
    await hello(s);
    const watch = watchKick(s);
    const t0 = Date.now();
    while (Date.now() - t0 < IDLE_MS * 3) {
      s.emit(EVENTS.clientActive);
      await sleep(IDLE_MS / 3);
    }
    expect(s.connected).toBe(true);
    expect(watch.errors).toEqual([]);
    await sleep(IDLE_MS + 400);
    expect(s.connected).toBe(false);
    expect(watch.errors[0]?.code).toBe('idle_timeout');
  });

  it('一般的遊戲訊息也算有人在（不需要額外的 client:active）', async () => {
    const url = await start(IDLE_MS);
    const s = client(url);
    await hello(s);
    const t0 = Date.now();
    while (Date.now() - t0 < IDLE_MS * 2) {
      s.emit(EVENTS.roomReady, { ready: true }); // 不在房間：回錯誤也無妨，仍代表有人操作
      await sleep(IDLE_MS / 3);
    }
    expect(s.connected).toBe(true);
  });

  it('被踢後用原本的 token 重新連線，接回同一個身分', async () => {
    const url = await start(IDLE_MS);
    const first = client(url);
    const hi = await hello(first);
    await sleep(IDLE_MS + 400);
    expect(first.connected).toBe(false);
    const second = client(url);
    const again = await hello(second, hi.sessionToken);
    expect(again.resumed).toBe(true);
    expect(again.playerId).toBe(hi.playerId);
  });

  it('連線了卻一直沒握手的連線也會被收掉', async () => {
    const url = await start(IDLE_MS);
    const s = client(url);
    const watch = watchKick(s);
    await sleep(IDLE_MS + 400);
    expect(watch.errors[0]?.code).toBe('idle_timeout');
    expect(s.connected).toBe(false);
  });

  it('idleKickMs 為 0 表示不踢', async () => {
    const url = await start(0);
    const s = client(url);
    await hello(s);
    await sleep(IDLE_MS + 400);
    expect(s.connected).toBe(true);
  });
});
