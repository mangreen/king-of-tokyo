import { describe, expect, it } from 'vitest';
import { EVENTS, PROTOCOL_VERSION, type GameUpdateMessage, type RoomSnapshot } from '@kot/protocol';
import { createLocalHost, type LocalHost } from './local/host.js';
import type { ToClient } from './local/protocol.js';
import type { RoomReplica } from './replica.js';
import { RECOVERY_GRACE_MS } from './host.js';
import type { Timings } from './room.js';
import { FakeScheduler } from './testing.js';
import { testCardSet } from './testing-fs.js';

const TIMINGS: Timings = {
  decisionMs: 1000,
  yieldMs: 500,
  awayConnectedMs: 200,
  awayOfflineMs: 50,
  emptyRoomMs: 100_000,
  lobbyOfflineMs: 60_000,
  overRoomMs: 100_000,
  botMs: 100,
};

function makeHost(scheduler: FakeScheduler): LocalHost {
  return createLocalHost({ cardSet: testCardSet(), scheduler, timings: TIMINGS });
}

/** 接上一個本機客戶端，記錄收到的訊息。 */
function client(local: LocalHost) {
  const events: ToClient[] = [];
  let ackId = 0;
  const receive = local.connect((m) => events.push(m));
  const emitted = (event: string): unknown[] =>
    events.flatMap((m) => (m.t === 'emit' && m.event === event ? [m.payload] : []));
  return {
    events,
    emitted,
    hello(nickname: string, token?: string) {
      receive({
        t: 'event',
        event: EVENTS.clientHello,
        payload: {
          protocolVersion: PROTOCOL_VERSION,
          nickname,
          ...(token ? { sessionToken: token } : {}),
        },
      });
      const hello = emitted(EVENTS.serverHello).at(-1) as {
        sessionToken: string;
        playerId: string;
        resumed: boolean;
      };
      return hello;
    },
    request(event: string, payload: unknown = {}) {
      ackId += 1;
      receive({ t: 'event', event, payload, ackId });
      const ack = [...events].reverse().find((m) => m.t === 'ack' && m.ackId === ackId);
      return ack && ack.t === 'ack' ? ack.result : undefined;
    },
    room: () =>
      (emitted(EVENTS.roomState).at(-1) as { room: RoomSnapshot | null } | undefined)?.room,
    game: () => emitted(EVENTS.gameUpdate).at(-1) as GameUpdateMessage | undefined,
  };
}

/** 一個房主＋一位真人客人＋一台電腦的房間，已開局。 */
function startedRoom() {
  const scheduler = new FakeScheduler();
  const local = makeHost(scheduler);
  const host = client(local);
  const guest = client(local);
  const h = host.hello('房主');
  const g = guest.hello('客人');
  host.request(EVENTS.roomCreate);
  const code = host.room()?.code ?? '';
  guest.request(EVENTS.roomJoin, { code });
  guest.request(EVENTS.roomReady, { ready: true });
  host.request(EVENTS.roomAddBot);
  expect(host.request(EVENTS.roomStart)).toEqual({ ok: true });
  return { scheduler, local, host, guest, h, g, code };
}

const clone = (replica: RoomReplica): RoomReplica =>
  JSON.parse(JSON.stringify(replica)) as RoomReplica;

describe('房間複本：序列化與還原', () => {
  it('大廳：複本是純 JSON，還原後成員與設定相同（真人先視為離線），原 token 接回原身分', () => {
    const scheduler = new FakeScheduler();
    const a = makeHost(scheduler);
    const host = client(a);
    const guest = client(a);
    const h = host.hello('房主');
    guest.hello('客人');
    host.request(EVENTS.roomCreate);
    const code = host.room()?.code ?? '';
    guest.request(EVENTS.roomJoin, { code });
    host.request(EVENTS.roomAddBot);

    const replica = clone(a.host.exportRoom(code) as RoomReplica);
    expect(replica.phase).toBe('lobby');
    expect(replica.seed).toBeNull();
    expect(JSON.stringify(replica)).not.toContain(h.sessionToken); // 只有雜湊，沒有 token

    const b = makeHost(new FakeScheduler());
    expect(b.host.importRoom(replica, RECOVERY_GRACE_MS)).toEqual({ ok: true });
    const restored = b.host.rooms.room(code)?.snapshot();
    const original = a.host.rooms.room(code)?.snapshot();
    expect(restored?.players.map((p) => [p.id, p.nickname, p.bot, p.ready])).toEqual(
      original?.players.map((p) => [p.id, p.nickname, p.bot, p.ready]),
    );
    expect(restored?.players.filter((p) => !p.bot).every((p) => !p.connected)).toBe(true);
    expect(restored?.hostId).toBe(original?.hostId);

    const back = client(b);
    const resumed = back.hello('房主', h.sessionToken);
    expect(resumed.resumed).toBe(true);
    expect(resumed.playerId).toBe(h.playerId);
    expect(back.room()?.code).toBe(code);
    expect(
      b.host.rooms
        .room(code)
        ?.snapshot()
        .players.find((p) => p.id === h.playerId)?.connected,
    ).toBe(true);
  });

  it('對局：種子＋動作日誌重放後，每位玩家看到的狀態與原本完全相同', () => {
    const { scheduler, local, host, guest, h, g, code } = startedRoom();
    scheduler.advance(8_000); // 逾時代打與電腦出手，累積一段動作日誌
    const room = local.host.rooms.room(code);
    expect((room?.replayInfo().actions.length ?? 0) > 3).toBe(true);

    const replica = clone(local.host.exportRoom(code) as RoomReplica);
    const b = makeHost(new FakeScheduler());
    expect(b.host.importRoom(replica, RECOVERY_GRACE_MS)).toEqual({ ok: true });
    const restoredRoom = b.host.rooms.room(code);
    expect(restoredRoom?.replayInfo().actions).toEqual(room?.replayInfo().actions);
    expect(restoredRoom?.phase).toBe(room?.phase);

    const hostAgain = client(b);
    const guestAgain = client(b);
    expect(hostAgain.hello('房主', h.sessionToken).resumed).toBe(true);
    expect(guestAgain.hello('客人', g.sessionToken).resumed).toBe(true);
    // 原本的連線也重送一次完整狀態，才能和還原後的比對
    local.host.rooms.room(code)?.resync(h.playerId);
    local.host.rooms.room(code)?.resync(g.playerId);
    const strip = (u: GameUpdateMessage | undefined) =>
      u && { version: u.version, state: u.state, actorSeat: u.actorSeat };
    expect(strip(hostAgain.game())).toEqual(strip(host.game()));
    expect(strip(guestAgain.game())).toEqual(strip(guest.game()));
    expect(hostAgain.game()?.version).toBe(room?.replayInfo().actions.length);
  });

  it('壞掉的存檔不會留下半成品：動作無法重放、卡牌組雜湊不符、版本不認識、房號衝突都被拒絕', () => {
    const { scheduler, local, code } = startedRoom();
    scheduler.advance(3_000);
    const good = clone(local.host.exportRoom(code) as RoomReplica);

    const tryImport = (replica: RoomReplica, target = makeHost(new FakeScheduler())) => {
      const result = target.host.importRoom(replica, RECOVERY_GRACE_MS);
      return { result, target };
    };

    const badAction = clone(good);
    badAction.actions.splice(1, 0, { type: 'endTurn', seat: 5 });
    const a = tryImport(badAction);
    expect(a.result.ok).toBe(false);
    expect(a.target.host.rooms.roomCount).toBe(0);
    expect(a.target.host.sessions.size).toBe(0);

    expect(tryImport({ ...good, cardSetHash: 'x'.repeat(64) }).result.ok).toBe(false);
    expect(tryImport({ ...good, version: 2 as unknown as 1 }).result.ok).toBe(false);
    expect(tryImport({ ...good, phase: 'lobby' }).result.ok).toBe(false); // 大廳不該有種子與日誌
    expect(tryImport({ ...good, phase: 'over' }).result.ok).toBe(false); // 階段與重放結果不一致
    expect(tryImport({ ...good, seed: null }).result.ok).toBe(false);
    expect(tryImport({ ...good, hostId: 'nobody' }).result.ok).toBe(false);
    expect(tryImport({ ...good, cardSetId: 'missing' }).result.ok).toBe(false);

    const twice = makeHost(new FakeScheduler());
    expect(twice.host.importRoom(good, RECOVERY_GRACE_MS).ok).toBe(true);
    expect(twice.host.importRoom(good, RECOVERY_GRACE_MS).ok).toBe(false); // 房號已存在
  });

  it('復原寬限：還原後輪到離線的真人時，寬限期內不代打；過了寬限才代打', () => {
    const { scheduler, local, host, h, code } = startedRoom();
    // 推進到輪到房主（真人）
    const mySeat = local.host.rooms
      .room(code)
      ?.snapshot()
      .players.find((p) => p.id === h.playerId)?.seat;
    for (let i = 0; i < 400 && host.game()?.actorSeat !== mySeat; i += 1) scheduler.advance(100);
    expect(host.game()?.actorSeat).toBe(mySeat);

    const replica = clone(local.host.exportRoom(code) as RoomReplica);
    const restoredScheduler = new FakeScheduler();
    const b = makeHost(restoredScheduler);
    expect(b.host.importRoom(replica, 5_000)).toEqual({ ok: true });
    const room = b.host.rooms.room(code);
    const before = room?.replayInfo().actions.length;
    restoredScheduler.advance(4_000); // 寬限內（awayOfflineMs 只有 50ms，沒有寬限的話早就代打了）
    expect(room?.replayInfo().actions.length).toBe(before);
    restoredScheduler.advance(1_500);
    expect((room?.replayInfo().actions.length ?? 0) > (before ?? 0)).toBe(true);
  });

  it('寬限內真人用原 token 連回來：身分、座位接回，輪到他時不會被代打', () => {
    const { scheduler, local, host, h, code } = startedRoom();
    const mySeat = local.host.rooms
      .room(code)
      ?.snapshot()
      .players.find((p) => p.id === h.playerId)?.seat;
    for (let i = 0; i < 400 && host.game()?.actorSeat !== mySeat; i += 1) scheduler.advance(100);
    const replica = clone(local.host.exportRoom(code) as RoomReplica);

    const restoredScheduler = new FakeScheduler();
    const b = makeHost(restoredScheduler);
    b.host.importRoom(replica, RECOVERY_GRACE_MS);
    const back = client(b);
    expect(back.hello('房主', h.sessionToken).resumed).toBe(true);
    expect(back.game()?.actorSeat).toBe(mySeat);
    const room = b.host.rooms.room(code);
    const before = room?.replayInfo().actions.length;
    restoredScheduler.advance(RECOVERY_GRACE_MS - 1_000);
    expect(room?.replayInfo().actions.length).toBe(before);
  });

  it('onRoomChange：成員與動作改變時通知，關閉時通知 onRoomClosed', () => {
    const scheduler = new FakeScheduler();
    const changes: string[] = [];
    const closed: string[] = [];
    const local = createLocalHost({
      cardSet: testCardSet(),
      scheduler,
      timings: TIMINGS,
      onRoomChange: (code) => changes.push(code),
      onRoomClosed: (code) => closed.push(code),
    });
    const host = client(local);
    host.hello('房主');
    host.request(EVENTS.roomCreate);
    const code = host.room()?.code ?? '';
    expect(changes).toContain(code);
    const n = changes.length;
    host.request(EVENTS.roomAddBot);
    expect(changes.length).toBeGreaterThan(n);
    host.request(EVENTS.roomLeave);
    expect(closed).toEqual([code]);
  });
});

describe('client:resync（客戶端漏了訊息時要求完整重送）', () => {
  it('在房間裡：重送房間狀態、卡牌與對局狀態，且不含事件（不會重播動畫）', () => {
    const { guest } = startedRoom();
    const before = guest.events.length;
    expect(guest.request(EVENTS.clientResync)).toEqual({ ok: true });
    const fresh = guest.events.slice(before).flatMap((m) => (m.t === 'emit' ? [m] : []));
    expect(fresh.map((m) => m.event)).toEqual(
      expect.arrayContaining([EVENTS.roomState, EVENTS.gameCards, EVENTS.gameUpdate]),
    );
    const update = fresh.find((m) => m.event === EVENTS.gameUpdate)?.payload as GameUpdateMessage;
    expect(update.events).toEqual([]);
    expect(update.version).toBe(guest.game()?.version);
  });

  it('不在房間裡：回 not_in_room；沒握手前不處理', () => {
    const local = makeHost(new FakeScheduler());
    const c = client(local);
    c.hello('路人');
    expect(c.request(EVENTS.clientResync)).toEqual({ ok: false, code: 'not_in_room' });
    const stranger = client(local);
    expect(stranger.request(EVENTS.clientResync)).toBeUndefined();
  });

  it('速率限制：連續狂送會被擋下，不會無限重送', () => {
    const { guest } = startedRoom();
    const results = Array.from({ length: 80 }, () => guest.request(EVENTS.clientResync));
    expect(results.some((r) => (r as { ok: boolean; code?: string }).code === 'rate_limited')).toBe(
      true,
    );
  });
});

describe('client:ping（往返時間量測）', () => {
  it('握手後回 ack；沒握手不處理；不需要在房間裡', () => {
    const local = makeHost(new FakeScheduler());
    const c = client(local);
    expect(c.request(EVENTS.clientPing)).toBeUndefined();
    c.hello('路人');
    expect(c.request(EVENTS.clientPing)).toEqual({ ok: true });
  });
});
