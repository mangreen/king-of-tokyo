/**
 * 整合測試：真實的 Socket.IO 連線，從大廳走到對局結束，並驗證重連與限流。
 */
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EVENTS,
  PROTOCOL_VERSION,
  type Ack,
  type GameActionInput,
  type GameCardsMessage,
  type GameUpdateMessage,
  type RoomSnapshot,
  type ServerHello,
} from '@kot/protocol';
import { defaultAction } from '@kot/rules';
import { buildApp, type App } from './app.js';
import type { ServerConfig } from './config.js';
import { testCardSets } from './rooms/testing.js';

const ORIGIN = 'http://localhost:5173';
const config: ServerConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  allowedOrigins: [ORIGIN],
  maxRooms: 10,
  cardSetsDir: 'card-sets',
  maxConnections: 100,
  webDir: null,
  allowSameOrigin: false,
  idleKickMs: 0,
};

let app: App;
let url: string;
const sockets: Socket[] = [];

class TestClient {
  readonly socket: Socket;
  hello: ServerHello | null = null;
  room: RoomSnapshot | null | undefined = undefined;
  game: GameUpdateMessage | null = null;
  cards: GameCardsMessage | null = null;
  cardsReceived = 0;
  readonly gameUpdates: GameUpdateMessage[] = [];
  private waiters: (() => void)[] = [];

  constructor(readonly nickname: string) {
    this.socket = connect(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Origin: ORIGIN },
    });
    sockets.push(this.socket);
    this.socket.on(EVENTS.serverHello, (hello: ServerHello) => {
      this.hello = hello;
      this.notify();
    });
    this.socket.on(EVENTS.roomState, (message: { room: RoomSnapshot | null }) => {
      this.room = message.room;
      this.notify();
    });
    this.socket.on(EVENTS.gameCards, (message: GameCardsMessage) => {
      this.cards = message;
      this.cardsReceived += 1;
      this.notify();
    });
    this.socket.on(EVENTS.gameUpdate, (update: GameUpdateMessage) => {
      this.game = update;
      this.gameUpdates.push(update);
      this.notify();
    });
  }

  private notify(): void {
    const current = this.waiters;
    this.waiters = [];
    for (const waiter of current) waiter();
  }

  /** 送出握手並等到 server:hello 與第一個 room:state。 */
  async hi(sessionToken?: string): Promise<this> {
    this.socket.emit(EVENTS.clientHello, {
      protocolVersion: PROTOCOL_VERSION,
      nickname: this.nickname,
      ...(sessionToken === undefined ? {} : { sessionToken }),
    });
    await this.until(() => this.hello !== null && this.room !== undefined);
    return this;
  }

  until(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('等待逾時'));
      }, timeoutMs);
      const check = (): void => {
        if (predicate()) {
          clearTimeout(timer);
          resolve();
        } else {
          this.waiters.push(check);
        }
      };
      check();
    });
  }

  send(event: string, payload: unknown = {}): Promise<Ack> {
    return this.socket.timeout(2000).emitWithAck(event, payload) as Promise<Ack>;
  }

  act(action: GameActionInput): Promise<Ack> {
    return this.send(EVENTS.gameAction, action);
  }

  get seat(): number | null {
    return this.room?.players.find((p) => p.id === this.hello?.playerId)?.seat ?? null;
  }
}

beforeEach(async () => {
  app = buildApp(config, { helloTimeoutMs: 2000, cardSets: testCardSets() });
  await app.fastify.listen({ host: config.host, port: 0 });
  const { port } = app.fastify.server.address() as AddressInfo;
  url = `http://127.0.0.1:${String(port)}`;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  await app.fastify.close();
});

async function twoInRoom(): Promise<{ a: TestClient; b: TestClient; code: string }> {
  const a = await new TestClient('Alice').hi();
  const b = await new TestClient('Bob').hi();
  expect(await a.send(EVENTS.roomCreate)).toEqual({ ok: true });
  await a.until(() => Boolean(a.room));
  const code = a.room?.code ?? '';
  expect(await b.send(EVENTS.roomJoin, { code })).toEqual({ ok: true });
  expect(await b.send(EVENTS.roomReady, { ready: true })).toEqual({ ok: true });
  await a.until(() => a.room?.players.length === 2 && a.room.players[1]?.ready === true);
  return { a, b, code };
}

describe('大廳流程', () => {
  it('建立房間、加入（房號不分大小寫）、準備、開始；雙方都收到初始對局狀態', async () => {
    const { a, b, code } = await twoInRoom();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(a.room?.hostId).toBe(a.hello?.playerId);
    expect(await b.send(EVENTS.roomStart)).toEqual({ ok: false, code: 'not_host' });
    expect(await a.send(EVENTS.roomStart)).toEqual({ ok: true });
    await a.until(() => a.game !== null);
    await b.until(() => b.game !== null);
    expect(a.game?.state.config.playerCount).toBe(2);
    expect([a.seat, b.seat].sort()).toEqual([0, 1]);
    expect(a.game?.remainingMs).toBeGreaterThan(0);
  });

  it('小寫房號可以加入', async () => {
    const a = await new TestClient('Alice').hi();
    const b = await new TestClient('Bob').hi();
    await a.send(EVENTS.roomCreate);
    await a.until(() => Boolean(a.room));
    expect(await b.send(EVENTS.roomJoin, { code: (a.room?.code ?? '').toLowerCase() })).toEqual({
      ok: true,
    });
  });

  it('錯誤情況回穩定的錯誤碼', async () => {
    const a = await new TestClient('Alice').hi();
    expect(await a.send(EVENTS.roomJoin, { code: 'ZZZZZ' })).toEqual({
      ok: false,
      code: 'room_not_found',
    });
    expect(await a.send(EVENTS.roomJoin, { code: 'bad' })).toEqual({
      ok: false,
      code: 'invalid_message',
    });
    expect(await a.send(EVENTS.roomStart)).toEqual({ ok: false, code: 'not_in_room' });
    expect(await a.act({ type: 'endRolling' })).toEqual({ ok: false, code: 'not_in_room' });
    expect(await a.send(EVENTS.roomCreate, { extra: 1 })).toEqual({
      ok: false,
      code: 'invalid_message',
    });
    expect(await a.send(EVENTS.roomCreate)).toEqual({ ok: true });
    expect(await a.send(EVENTS.roomCreate)).toEqual({ ok: false, code: 'already_in_room' });
    expect(await a.send(EVENTS.roomStart)).toEqual({ ok: false, code: 'not_enough_players' });
    expect(await a.act({ type: 'roll', keep: [] })).toEqual({ ok: false, code: 'wrong_state' });
    expect(await a.send(EVENTS.gameAction, { type: 'cheat' })).toEqual({
      ok: false,
      code: 'invalid_message',
    });
  });

  it('握手回傳可用卡牌組與預設值；建房可指定卡牌組，未知的被拒絕', async () => {
    const a = await new TestClient('Alice').hi();
    expect(a.hello?.defaultCardSetId).toBe('original');
    expect(a.hello?.cardSets.map((c) => c.id)).toContain('original');
    expect(await a.send(EVENTS.roomCreate, { cardSetId: 'nope' })).toEqual({
      ok: false,
      code: 'unknown_card_set',
    });
    expect(await a.send(EVENTS.roomCreate, { cardSetId: 'original' })).toEqual({ ok: true });
    await a.until(() => Boolean(a.room));
    expect(a.room?.cardSet.id).toBe('original');
  });

  it('開局時收到卡牌目錄，且狀態不含牌庫內容；重連後再收到一次', async () => {
    const { a, b } = await twoInRoom();
    await a.send(EVENTS.roomStart);
    await a.until(() => a.game !== null && a.cards !== null);
    expect(a.cards?.cards.length).toBeGreaterThan(10);
    expect(a.game?.state.rng).toEqual({ key: [0, 0, 0, 0], n: 0 });
    expect(a.game?.state.market?.deck.every((c) => c === '')).toBe(true);
    await b.until(() => b.cards !== null);
    const token = b.hello?.sessionToken ?? '';
    b.socket.disconnect();
    const b2 = await new TestClient('Bob').hi(token);
    await b2.until(() => b2.cards !== null && b2.game !== null);
    expect(b2.cardsReceived).toBe(1);
  });

  it('離開房間後收到 room:null', async () => {
    const a = await new TestClient('Alice').hi();
    await a.send(EVENTS.roomCreate);
    await a.until(() => Boolean(a.room));
    expect(await a.send(EVENTS.roomLeave)).toEqual({ ok: true });
    await a.until(() => a.room === null);
    expect(app.rooms.roomCount).toBe(0);
  });
});

describe('對局', () => {
  /** 簡單策略：擲一次就停；被打了就留下。直到遊戲結束。 */
  function autoPlay(client: TestClient): void {
    client.socket.on(EVENTS.gameUpdate, (update: GameUpdateMessage) => {
      if (update.actorSeat === null || update.actorSeat !== client.seat) return;
      const { state } = update;
      // 最保守的動作（擲一次就停、不買牌、不讓位）；座位由伺服器決定，所以去掉 seat
      const fallback = defaultAction(state);
      if (!fallback) return;
      const intent = Object.fromEntries(Object.entries(fallback).filter(([key]) => key !== 'seat'));
      // 限流是正常行為（每連線每秒補 5 則）：被限流就稍後重送同一個動作
      const send = (): void => {
        void client.act(intent as GameActionInput).then((ack) => {
          if (!ack.ok && ack.code === 'rate_limited') setTimeout(send, 250);
        });
      };
      send();
    });
  }

  it('兩位玩家透過 Socket.IO 完整打完一局，雙方看到相同的結果', async () => {
    const { a, b } = await twoInRoom();
    await a.send(EVENTS.roomStart);
    await a.until(() => a.seat !== null && a.game !== null);
    await b.until(() => b.seat !== null && b.game !== null);
    autoPlay(a);
    autoPlay(b);
    // 已經收到的第一個更新不會再觸發，手動踢一下
    for (const c of [a, b]) {
      if (c.game && c.game.actorSeat === c.seat) {
        void c.act({ type: 'roll', keep: [] });
      }
    }
    await a.until(() => a.game?.state.phase === 'over', 15_000);
    await b.until(() => b.game?.state.phase === 'over', 15_000);
    expect(a.game?.state.outcome).toEqual(b.game?.state.outcome);
    expect(a.game?.actorSeat).toBeNull();
    await a.until(() => a.room?.phase === 'over');
  });

  it('不是你的回合 → not_your_turn', async () => {
    const { a, b } = await twoInRoom();
    await a.send(EVENTS.roomStart);
    await a.until(() => a.game !== null && a.seat !== null);
    const actor = a.game?.actorSeat === a.seat ? a : b;
    const other = actor === a ? b : a;
    expect(await other.act({ type: 'roll', keep: [] })).toEqual({
      ok: false,
      code: 'not_your_turn',
    });
    expect(await actor.act({ type: 'roll', keep: [] })).toEqual({ ok: true });
  });
});

describe('重連', () => {
  it('對局中斷線後帶 token 重連：接回同一座位，收到完整狀態（不含事件）', async () => {
    const { a, b } = await twoInRoom();
    await a.send(EVENTS.roomStart);
    await b.until(() => b.game !== null);
    const token = b.hello?.sessionToken ?? '';
    const seatBefore = b.seat;

    b.socket.disconnect();
    await a.until(() => a.room?.players.find((p) => !p.connected) !== undefined);

    const b2 = await new TestClient('Ignored').hi(token);
    expect(b2.hello?.resumed).toBe(true);
    expect(b2.hello?.playerId).toBe(b.hello?.playerId);
    await b2.until(() => b2.game !== null);
    expect(b2.seat).toBe(seatBefore);
    expect(b2.game?.events).toEqual([]);
    expect(b2.game?.version).toBe(a.game?.version);
    await a.until(() => a.room?.players.every((p) => p.connected) === true);
  });

  it('同一身分從別處重新登入（取代舊連線）：其他玩家不會看到「離線」閃動', async () => {
    const { a, b } = await twoInRoom();
    const bId = b.hello?.playerId ?? '';
    const seen: boolean[] = [];
    a.socket.on(EVENTS.roomState, (m: { room: RoomSnapshot | null }) => {
      const p = m.room?.players.find((x) => x.id === bId);
      if (p) seen.push(p.connected);
    });
    const b2 = await new TestClient('x').hi(b.hello?.sessionToken ?? '');
    expect(b2.hello?.resumed).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(seen).not.toContain(false);
    expect(
      app.rooms
        .roomOf(bId)
        ?.snapshot()
        .players.find((p) => p.id === bId)?.connected,
    ).toBe(true);
  });

  it('大廳階段重連：仍在房間裡', async () => {
    const a = await new TestClient('Alice').hi();
    await a.send(EVENTS.roomCreate);
    await a.until(() => Boolean(a.room));
    const code = a.room?.code;
    const token = a.hello?.sessionToken ?? '';
    a.socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    const again = await new TestClient('x').hi(token);
    expect(again.room?.code).toBe(code);
  });
});

describe('濫用防護', () => {
  it('短時間大量送訊息會被限流，且之後正常訊息仍可處理（不斷線）', async () => {
    const a = await new TestClient('Alice').hi();
    const results = await Promise.all(
      Array.from({ length: 80 }, () => a.send(EVENTS.roomJoin, { code: 'ZZZZZ' })),
    );
    const limited = results.filter((r) => !r.ok && r.code === 'rate_limited').length;
    expect(limited).toBeGreaterThan(30);
    expect(a.socket.connected).toBe(true);
  });

  it('未握手就送房間訊息會被忽略（沒有 ack，也不會建立房間）', async () => {
    const socket = connect(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Origin: ORIGIN },
    });
    sockets.push(socket);
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    socket.emit(EVENTS.roomCreate, {}, () => undefined);
    await new Promise((r) => setTimeout(r, 100));
    expect(app.rooms.roomCount).toBe(0);
  });
});
