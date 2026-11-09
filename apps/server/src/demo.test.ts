import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVENTS, PROTOCOL_VERSION, ServerErrorSchema } from '@kot/protocol';
import { buildApp, type App } from './app.js';
import type { ServerConfig } from './config.js';
import { testCardSets } from './rooms/testing.js';

/** 單一容器試玩版：靜態網頁、SPA 回退、安全標頭、同來源檢查、連線數上限。 */

const dirs: string[] = [];
const apps: App[] = [];
const sockets: Socket[] = [];

function webRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kot-web-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>kot</title><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  return dir;
}

function config(over: Partial<ServerConfig> = {}): ServerConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    allowedOrigins: ['http://localhost:5173'],
    maxRooms: 5,
    cardSetsDir: 'card-sets',
    maxConnections: 2,
    webDir: webRoot(),
    allowSameOrigin: true,
    ...over,
  };
}

async function start(c: ServerConfig): Promise<{ app: App; url: string; host: string }> {
  const app = buildApp(c, { helloTimeoutMs: 2000, cardSets: testCardSets() });
  apps.push(app);
  await app.fastify.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.fastify.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${String(port)}`, host: `127.0.0.1:${String(port)}` };
}

function whenConnected(s: Socket): Promise<void> {
  return new Promise((resolve) => {
    s.once('connect', () => {
      resolve();
    });
  });
}

function client(url: string, headers: Record<string, string> = {}): Socket {
  const s = connect(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: headers,
  });
  sockets.push(s);
  return s;
}

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  for (const a of apps.splice(0)) await a.fastify.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('靜態網頁', () => {
  it('首頁、帶雜湊的資源（長期快取）、SPA 路徑（回到 index.html、不快取）', async () => {
    const { app } = await start(config());
    const home = await app.fastify.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('<div id="root">');
    expect(home.headers['cache-control']).toBe('no-cache');

    const asset = await app.fastify.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const spa = await app.fastify.inject({ method: 'GET', url: '/room/ABCDE' });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('<div id="root">');
    expect(spa.headers['cache-control']).toBe('no-cache');
  });

  it('不存在的檔案 → 404（不會被當成頁面）；/healthz 仍可用', async () => {
    const { app } = await start(config());
    expect(
      (await app.fastify.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode,
    ).toBe(404);
    expect((await app.fastify.inject({ method: 'POST', url: '/anything' })).statusCode).toBe(404);
    const health = await app.fastify.inject({ method: 'GET', url: '/healthz' });
    expect(health.json()).toEqual({ status: 'ok' });
  });

  it('擋掉路徑穿越', async () => {
    const { app } = await start(config());
    for (const url of ['/../package.json', '/%2e%2e/package.json', '/assets/../../etc/passwd']) {
      const res = await app.fastify.inject({ method: 'GET', url });
      expect(res.body).not.toContain('"name"');
      expect(res.body).not.toContain('root:');
    }
  });

  it('安全標頭與 CSP', async () => {
    const { app } = await start(config());
    const res = await app.fastify.inject({ method: 'GET', url: '/' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('沒設定 WEB_DIR 時不提供網頁（開發模式）', async () => {
    const { app } = await start(config({ webDir: null }));
    expect((await app.fastify.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
  });

  it('WEB_DIR 沒有 index.html → 啟動就明確失敗', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kot-empty-'));
    dirs.push(dir);
    expect(() => buildApp(config({ webDir: dir }), { cardSets: testCardSets() })).toThrow(
      /index\.html/,
    );
  });
});

describe('同來源', () => {
  async function tryConnect(
    url: string,
    headers: Record<string, string>,
  ): Promise<'ok' | 'rejected'> {
    const s = client(url, headers);
    return new Promise((resolve) => {
      s.once('connect', () => resolve('ok'));
      s.once('connect_error', () => resolve('rejected'));
    });
  }

  it('Origin 與 Host 相同 → 允許；別的網站 → 拒絕', async () => {
    const { url, host } = await start(config());
    expect(await tryConnect(url, { Origin: `http://${host}` })).toBe('ok');
    expect(await tryConnect(url, { Origin: 'https://evil.test' })).toBe('rejected');
  });

  it('沒開同來源時，同來源也要在允許清單內', async () => {
    const { url, host } = await start(config({ allowSameOrigin: false }));
    expect(await tryConnect(url, { Origin: `http://${host}` })).toBe('rejected');
  });
});

describe('連線數上限', () => {
  it('超過上限的新連線收到 server_full 並被中斷；原本的人不受影響', async () => {
    const { app, url, host } = await start(config({ maxConnections: 2 }));
    const origin = { Origin: `http://${host}` };
    const a = client(url, origin);
    const b = client(url, origin);
    await Promise.all([whenConnected(a), whenConnected(b)]);

    const c = client(url, origin);
    const error = await new Promise<unknown>((resolve) => c.once(EVENTS.serverError, resolve));
    expect(ServerErrorSchema.parse(error).code).toBe('server_full');
    await vi.waitFor(() => {
      expect(c.connected).toBe(false);
    });
    expect(a.connected && b.connected).toBe(true);

    // 有人離開後名額釋出，新的人可以進來
    a.disconnect();
    await vi.waitFor(() => {
      expect(app.io.engine.clientsCount).toBe(1);
    });
    const d = client(url, origin);
    const hello = new Promise<unknown>((resolve) => d.once(EVENTS.serverHello, resolve));
    d.emit(EVENTS.clientHello, { protocolVersion: PROTOCOL_VERSION, nickname: 'late' });
    expect(await hello).toMatchObject({ nickname: 'late' });
  });
});

describe('優雅關閉', () => {
  it('還有玩家連著時 close() 也會結束（不會卡住，否則 docker stop／Ctrl+C 會掛住）', async () => {
    const { app, url, host } = await start(config({ maxConnections: 5 }));
    const s = client(url, { Origin: `http://${host}` });
    await whenConnected(s);
    const hello = new Promise<unknown>((resolve) => s.once(EVENTS.serverHello, resolve));
    s.emit(EVENTS.clientHello, { protocolVersion: PROTOCOL_VERSION, nickname: 'stay' });
    await hello;
    const closed = await Promise.race([
      app.fastify.close().then(() => 'closed'),
      new Promise((r) => setTimeout(() => r('hung'), 3000)),
    ]);
    expect(closed).toBe('closed');
  }, 10_000);
});
