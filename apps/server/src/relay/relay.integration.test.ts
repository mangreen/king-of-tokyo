import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EVENTS,
  PROTOCOL_VERSION,
  RELAY_NAMESPACE,
  RELAY_PROTOCOL_VERSION,
  type Ack,
  type RoomSnapshot,
} from '@kot/protocol';
import {
  createGuestEndpoint,
  createRelayedHost,
  type GuestEndpointOptions,
  type HostBridge,
  type HostBridgeOptions,
  type LocalEndpoint,
  type RelaySocket,
  type Timings,
  type ToClient,
} from '@kot/room';
import { createFakeDirectNetwork, FakeScheduler, type FakeDirectNetwork } from '@kot/room/testing';
import { testCardSets, testCardSet } from '@kot/room/testing-fs';
import { buildApp, type App } from '../app.js';
import type { ServerConfig } from '../config.js';

const ORIGIN = 'http://localhost:5173';
const TIMINGS: Timings = {
  decisionMs: 1000,
  yieldMs: 500,
  awayConnectedMs: 200,
  awayOfflineMs: 50,
  emptyRoomMs: 10_000,
  lobbyOfflineMs: 2_000,
  overRoomMs: 30_000,
  botMs: 100,
};

let app: App | null = null;
const sockets: Socket[] = [];

async function start(graceMs = 30_000): Promise<string> {
  const config: ServerConfig = {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    allowedOrigins: [ORIGIN],
    maxRooms: 20,
    cardSetsDir: 'card-sets',
    maxConnections: 100,
    idleKickMs: 0,
    webDir: null,
    allowSameOrigin: false,
  };
  app = buildApp(config, {
    cardSets: testCardSets(),
    relayHostGraceMs: graceMs,
    // 測試用假時鐘把對局加速到比真實快得多，真實的流量上限會誤殺：放寬
    relayLimits: {
      hostBurst: 1_000_000,
      hostPerSecond: 1_000_000,
      roomBytesBurst: 1_000_000_000,
      roomBytesPerSecond: 1_000_000_000,
    },
  });
  await app.fastify.listen({ host: '127.0.0.1', port: 0 });
  return `http://127.0.0.1:${String((app.fastify.server.address() as AddressInfo).port)}`;
}

/** Socket.IO 版的 RelaySocket（瀏覽器端的轉接層做同樣的事）。 */
function relaySocket(url: string): RelaySocket {
  const socket = connect(`${url}${RELAY_NAMESPACE}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: { origin: ORIGIN },
  });
  sockets.push(socket);
  return {
    get connected() {
      return socket.connected;
    },
    emit(event, payload, ack) {
      if (ack) socket.emit(event, payload, ack);
      else if (payload === undefined) socket.emit(event);
      else socket.emit(event, payload);
    },
    onEvent: (event, handler) => socket.on(event, handler),
    onConnect: (handler) => socket.on('connect', handler),
    onDisconnect: (handler) => socket.on('disconnect', handler),
    onConnectError: (handler) => socket.on('connect_error', handler),
    connect: () => {
      if (!socket.connected) socket.connect();
    },
    pause: () => socket.disconnect(),
    disconnect: () => socket.disconnect(),
  };
}

/** 測試用的客戶端：包住一個 LocalEndpoint，收集事件、可送請求並等 ack。 */
class TestClient {
  readonly events: ToClient[] = [];
  private nextAck = 1;
  private readonly acks = new Map<number, (ack: Ack) => void>();

  constructor(readonly endpoint: LocalEndpoint) {
    endpoint.listen((message) => {
      this.events.push(message);
      if (message.t === 'ack') this.acks.get(message.ackId)?.(message.result);
    });
  }

  emit(event: string, payload?: unknown): void {
    this.endpoint.post({ t: 'event', event, payload });
  }

  request(event: string, payload: unknown): Promise<Ack> {
    const ackId = this.nextAck;
    this.nextAck += 1;
    return new Promise<Ack>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`ack 逾時：${event}`));
      }, 3000);
      this.acks.set(ackId, (ack) => {
        clearTimeout(timer);
        resolve(ack);
      });
      this.endpoint.post({ t: 'event', event, payload, ackId });
    });
  }

  last<T = Record<string, unknown>>(event: string): T | undefined {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const m = this.events[i];
      if (m?.t === 'emit' && m.event === event) return m.payload as T;
    }
    return undefined;
  }

  countOf(event: string): number {
    return this.events.filter((m) => m.t === 'emit' && m.event === event).length;
  }

  room(): RoomSnapshot | null | undefined {
    return this.last<{ room: RoomSnapshot | null }>(EVENTS.roomState)?.room;
  }

  async hello(nickname: string, sessionToken?: string): Promise<Record<string, unknown>> {
    const before = this.countOf(EVENTS.serverHello);
    this.emit(EVENTS.clientHello, {
      protocolVersion: PROTOCOL_VERSION,
      nickname,
      ...(sessionToken === undefined ? {} : { sessionToken }),
    });
    await until(() => this.countOf(EVENTS.serverHello) > before);
    return this.last(EVENTS.serverHello) ?? {};
  }
}

async function until(condition: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error('等待條件逾時');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 房主：Worker 的位置在測試裡是同一個行程；頁面端是一個 TestClient。 */
function startHost(
  url: string,
  scheduler: FakeScheduler,
  bridge?: Omit<HostBridgeOptions, 'canPark'>,
): { page: TestClient; code: () => string; bridge: HostBridge } {
  const host = createRelayedHost({
    cardSet: testCardSet(),
    scheduler,
    timings: TIMINGS,
    socket: relaySocket(url),
    ...(bridge === undefined ? {} : { bridge }),
  });
  let receive: (m: Parameters<ReturnType<typeof host.connectPage>>[0]) => void = () => undefined;
  let handler: (m: ToClient) => void = () => undefined;
  receive = host.connectPage((m) => {
    queueMicrotask(() => {
      handler(m);
    });
  });
  const page = new TestClient({
    post: (m) => {
      queueMicrotask(() => {
        receive(m);
      });
    },
    listen: (h) => {
      handler = h;
    },
    terminate: () => undefined,
  });
  return { page, code: () => host.bridge.code ?? '', bridge: host.bridge };
}

function guestClient(url: string, code: string, options?: GuestEndpointOptions): TestClient {
  return new TestClient(createGuestEndpoint(relaySocket(url), code, options));
}

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  await app?.fastify.close();
  app = null;
});

describe('房主模式：房主在瀏覽器跑房間，伺服器只中繼', () => {
  it('房主建房、兩位客人加入，三個真人經中繼玩完整局', async () => {
    const url = await start();
    const scheduler = new FakeScheduler();
    const host = startHost(url, scheduler);
    await until(() => host.page.events.some((e) => e.t === 'open'));
    await host.page.hello('房主');
    expect(await host.page.request(EVENTS.roomCreate, {})).toEqual({ ok: true });
    const code = host.code();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(app?.relay.roomCount).toBe(1);

    const guests = [guestClient(url, code), guestClient(url, code)];
    for (const [i, g] of guests.entries()) {
      await until(() => g.events.some((e) => e.t === 'open'));
      const hello = await g.hello(`客人${String(i + 1)}`);
      expect(hello['resumed']).toBe(false);
      expect(await g.request(EVENTS.roomJoin, { code })).toEqual({ ok: true });
      expect(await g.request(EVENTS.roomReady, { ready: true })).toEqual({ ok: true });
    }
    await host.page.request(EVENTS.roomReady, { ready: true });
    await until(() => host.page.room()?.players.length === 3);
    expect(await host.page.request(EVENTS.roomStart, {})).toEqual({ ok: true });
    // 伺服器端完全沒有遊戲：中繼房間以外沒有任何房間
    expect(app?.rooms.roomOf('nobody')).toBeUndefined();

    // 三位真人都不操作：逾時由代管出手，直到結束（靠假時鐘推進房主端的計時器）
    for (let i = 0; i < 3000 && host.page.room()?.phase !== 'over'; i += 1) {
      scheduler.advance(250);
      await tick(2);
    }
    expect(host.page.room()?.phase).toBe('over');
    await until(() => guests.every((g) => g.room()?.phase === 'over'));
    for (const g of guests) expect(g.last(EVENTS.gameUpdate)).toBeDefined();
  }, 60_000);

  it('找不到的房號：客人收到 room_not_found', async () => {
    const url = await start();
    const g = guestClient(url, 'ABCDE');
    await until(() => g.events.some((e) => e.t === 'error'));
    expect(g.events.find((e) => e.t === 'error')).toEqual({ t: 'error', code: 'room_not_found' });
  });

  it('客人斷線後用 token 接回同一個座位（身分由房主簽發）', async () => {
    const url = await start();
    const scheduler = new FakeScheduler();
    const host = startHost(url, scheduler);
    await until(() => host.page.events.some((e) => e.t === 'open'));
    await host.page.hello('房主');
    await host.page.request(EVENTS.roomCreate, {});
    const code = host.code();

    const first = guestClient(url, code);
    await until(() => first.events.some((e) => e.t === 'open'));
    const hello = await first.hello('客人');
    await first.request(EVENTS.roomJoin, { code });
    first.endpoint.terminate();
    await until(
      () => host.page.room()?.players.find((p) => p.nickname === '客人')?.connected === false,
    );

    const second = guestClient(url, code);
    await until(() => second.events.some((e) => e.t === 'open'));
    const again = await second.hello('客人', hello['sessionToken'] as string);
    expect(again['resumed']).toBe(true);
    expect(again['playerId']).toBe(hello['playerId']);
    await until(() => second.room()?.code === code);
    await until(
      () => host.page.room()?.players.find((p) => p.nickname === '客人')?.connected === true,
    );
  });

  it('房主斷線超過保留時間：房號釋放，客人收到連線結束', async () => {
    const url = await start(150);
    const scheduler = new FakeScheduler();
    const host = startHost(url, scheduler);
    await until(() => host.page.events.some((e) => e.t === 'open'));
    await host.page.hello('房主');
    await host.page.request(EVENTS.roomCreate, {});
    const code = host.code();
    const g = guestClient(url, code);
    await until(() => g.events.some((e) => e.t === 'open'));
    await g.hello('客人');

    host.page.endpoint.post({ t: 'close' }); // 房主離開（關閉中繼連線）
    await until(() => g.events.some((e) => e.t === 'closed'));
    await until(() => app?.relay.roomCount === 0);
  });

  it('惡意客人送格式錯誤的信封：被房主端丟掉，不影響其他人', async () => {
    const url = await start();
    const scheduler = new FakeScheduler();
    const host = startHost(url, scheduler);
    await until(() => host.page.events.some((e) => e.t === 'open'));
    await host.page.hello('房主');
    await host.page.request(EVENTS.roomCreate, {});
    const code = host.code();
    const raw = relaySocket(url);
    raw.onConnect(() => {
      raw.emit('relay:join', { relayVersion: RELAY_PROTOCOL_VERSION, code }, () => {
        raw.emit('relay:to-host', { data: { t: 'event', event: 'x'.repeat(500), payload: 1 } });
        raw.emit('relay:to-host', { data: 'garbage' });
        raw.emit('relay:to-host', { data: { t: 'nope' } });
      });
    });
    await tick(150);
    const g = guestClient(url, code);
    await until(() => g.events.some((e) => e.t === 'open'));
    expect((await g.hello('正常客人'))['nickname']).toBe('正常客人');
  });
});

const relaySockets = (): number => app?.io.of('/relay').sockets.size ?? -1;

/** 房主＋兩位客人都進房、準備好（還沒開始）。直連用記憶體內的假網路。 */
async function lobbyWithDirect(
  options: { parkRefreshMs?: number; relayCloseDelayMs?: number } = {},
) {
  const url = await start();
  const scheduler = new FakeScheduler();
  const net: FakeDirectNetwork = createFakeDirectNetwork();
  // 橋接（直連逾時、停泊刷新）用獨立的假時鐘：對局計時前進很多時，不要連帶讓這些提早觸發
  const bridgeClock = new FakeScheduler();
  const host = startHost(url, scheduler, {
    direct: net.connector,
    scheduler: bridgeClock,
    parkRefreshMs: options.parkRefreshMs ?? 24 * 3_600_000,
  });
  await until(() => host.page.events.some((e) => e.t === 'open'));
  await host.page.hello('房主');
  await host.page.request(EVENTS.roomCreate, {});
  const code = host.code();
  const guestOptions: GuestEndpointOptions = {
    direct: net.connector,
    relayCloseDelayMs: options.relayCloseDelayMs ?? 20,
    joinRetryMs: 30,
  };
  const guests = [guestClient(url, code, guestOptions), guestClient(url, code, guestOptions)];
  const tokens: string[] = [];
  for (const [i, g] of guests.entries()) {
    await until(() => g.events.some((e) => e.t === 'open'));
    const hello = await g.hello(`客人${String(i + 1)}`);
    tokens.push(hello['sessionToken'] as string);
    expect(await g.request(EVENTS.roomJoin, { code })).toEqual({ ok: true });
    expect(await g.request(EVENTS.roomReady, { ready: true })).toEqual({ ok: true });
  }
  await host.page.request(EVENTS.roomReady, { ready: true });
  await until(() => host.page.room()?.players.length === 3);
  return { url, scheduler, bridgeClock, net, host, guests, code, tokens };
}

describe('直連（M7）：中繼 → WebRTC 無縫切換與停泊', () => {
  it('客人都改走直連、開局後房主停泊：伺服器上沒有任何連線，房號仍登記；對局照常打完', async () => {
    const { scheduler, net, host, guests } = await lobbyWithDirect();
    await until(() => net.pending === 2);
    net.openAll();
    await until(() => host.bridge.directCount === 2);
    // 客人在切換完成後關掉自己的中繼連線；開局前房主還要等人（大廳不停泊），所以房主還連著
    await until(() => relaySockets() === 1);
    expect(host.bridge.isParked).toBe(false);

    expect(await host.page.request(EVENTS.roomStart, {})).toEqual({ ok: true });
    await until(() => host.bridge.isParked);
    await until(() => relaySockets() === 0);
    expect(app?.relay.roomCount).toBe(1);

    for (let i = 0; i < 3000 && host.page.room()?.phase !== 'over'; i += 1) {
      scheduler.advance(250);
      await tick(2);
    }
    expect(host.page.room()?.phase).toBe('over');
    await until(() => guests.every((g) => g.room()?.phase === 'over'));
    for (const g of guests) expect(g.last(EVENTS.gameUpdate)).toBeDefined();
    expect(relaySockets()).toBe(0); // 整局都沒有再用到伺服器連線
  }, 60_000);

  it('直連逾時沒連上：繼續走中繼，房主不停泊', async () => {
    const { bridgeClock, net, host, guests } = await lobbyWithDirect();
    await until(() => net.pending === 2);
    bridgeClock.advance(16_000); // 房主端放棄（假時鐘）；客人端的 15 秒是真時鐘，之後才放棄
    expect(await host.page.request(EVENTS.roomStart, {})).toEqual({ ok: true });
    expect(host.bridge.isParked).toBe(false);
    expect(host.bridge.directCount).toBe(0);
    await until(() => guests.every((g) => g.room()?.phase === 'playing'));
    expect(relaySockets()).toBe(3);
  });

  it('停泊後直連中斷：房主回到中繼，客人經中繼重新加入並用 token 接回原座位', async () => {
    const { net, host, guests, tokens } = await lobbyWithDirect();
    await until(() => net.pending === 2);
    net.openAll();
    await until(() => host.bridge.directCount === 2);
    await host.page.request(EVENTS.roomStart, {});
    await until(() => host.bridge.isParked);
    await until(() => relaySockets() === 0);
    const before = guests.map((g) => g.events.filter((e) => e.t === 'open').length);

    net.dropAll();
    // 房主回到中繼（回來後因為有人斷線，不會再停泊），客人重新加入
    await until(() => !host.bridge.isParked);
    await until(() =>
      guests.every((g, i) => g.events.filter((e) => e.t === 'open').length > (before[i] ?? 0)),
    );
    for (const [i, g] of guests.entries()) {
      const hello = await g.hello(`客人${String(i + 1)}`, tokens[i]);
      expect(hello['resumed']).toBe(true);
    }
    await until(() => host.page.room()?.players.every((p) => p.connected) === true);
    expect(host.bridge.isParked).toBe(false);
  }, 30_000);

  it('停泊期間定時回伺服器刷新房號期限，再重新停泊', async () => {
    const { bridgeClock, net, host } = await lobbyWithDirect({ parkRefreshMs: 60_000 });
    await until(() => net.pending === 2);
    net.openAll();
    await until(() => host.bridge.directCount === 2);
    await host.page.request(EVENTS.roomStart, {});
    await until(() => host.bridge.isParked);
    await until(() => relaySockets() === 0);

    // 房主回來刷新期限的連線很短暫（連上、接回、又停泊），用「新連線數」觀察而不是輪詢連線數
    let reconnects = 0;
    app?.io.of('/relay').on('connection', () => {
      reconnects += 1;
    });
    bridgeClock.advance(61_000);
    await until(() => reconnects === 1);
    await until(() => host.bridge.isParked && relaySockets() === 0); // 又停泊
    expect(app?.relay.roomCount).toBe(1);
  }, 30_000);
});
