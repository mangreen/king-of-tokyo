import { describe, expect, it } from 'vitest';
import {
  RELAY_EVENTS,
  RELAY_PROTOCOL_VERSION,
  type RelayErrorCode,
  type RelayServerEvents,
} from '@kot/protocol';
import { cryptoRandomInt, hashToken, randomHex } from '@kot/room';
import { FakeScheduler } from '@kot/room/testing';
import { RelayRegistry, type RelayConn, type RelayOptions } from './registry.js';

class FakeConn implements RelayConn {
  readonly sent: { event: string; payload: unknown }[] = [];
  closed = false;
  constructor(readonly id: string) {}
  send<E extends keyof RelayServerEvents>(event: E, payload: RelayServerEvents[E]): void {
    this.sent.push({ event, payload });
  }
  close(): void {
    this.closed = true;
  }
  of(event: string): unknown[] {
    return this.sent.filter((s) => s.event === event).map((s) => s.payload);
  }
  errors(): RelayErrorCode[] {
    return this.of(RELAY_EVENTS.error).map((p) => (p as { code: RelayErrorCode }).code);
  }
}

function setup(overrides: Partial<RelayOptions> = {}) {
  const scheduler = new FakeScheduler();
  const registry = new RelayRegistry({
    scheduler,
    maxRooms: 3,
    maxGuests: 2,
    idleKickMs: 1000,
    hostGraceMs: 500,
    parkTtlMs: 5_000,
    randomInt: cryptoRandomInt,
    randomHex,
    ...overrides,
  });
  let n = 0;
  const conn = (): FakeConn => {
    n += 1;
    const c = new FakeConn(`c${String(n)}`);
    registry.connected(c);
    return c;
  };
  return { scheduler, registry, conn };
}

const V = RELAY_PROTOCOL_VERSION;

function open(registry: RelayRegistry, host: FakeConn) {
  const ack = registry.hostOpen(host, { relayVersion: V });
  if (!ack.ok) throw new Error('hostOpen 失敗');
  return ack;
}

describe('中繼：登記與加入', () => {
  it('房主建房拿到房號與金鑰；客人用房號加入，房主收到通知', () => {
    const { registry, conn } = setup();
    const host = conn();
    const { code, hostKey } = open(registry, host);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(hostKey).toMatch(/^[0-9a-f]{32}$/);
    const guest = conn();
    expect(registry.join(guest, { relayVersion: V, code })).toEqual({ ok: true });
    expect(host.of(RELAY_EVENTS.guestJoined)).toEqual([{ guestId: 'g1' }]);
    expect(registry.roomCount).toBe(1);
    expect(registry.guestCount(code)).toBe(1);
  });

  it('各種拒絕：版本不符、格式錯誤、房間不存在、客人滿、房間數滿', () => {
    const { registry, conn } = setup();
    expect(registry.hostOpen(conn(), { relayVersion: 99 })).toEqual({
      ok: false,
      code: 'protocol_mismatch',
    });
    expect(registry.hostOpen(conn(), { nope: 1 })).toEqual({ ok: false, code: 'invalid_message' });
    expect(registry.join(conn(), { relayVersion: V, code: 'ABCDE' })).toEqual({
      ok: false,
      code: 'room_not_found',
    });
    expect(registry.join(conn(), { relayVersion: V, code: 'bad' })).toEqual({
      ok: false,
      code: 'invalid_message',
    });

    const { code } = open(registry, conn());
    expect(registry.join(conn(), { relayVersion: V, code }).ok).toBe(true);
    expect(registry.join(conn(), { relayVersion: V, code }).ok).toBe(true);
    expect(registry.join(conn(), { relayVersion: V, code })).toEqual({
      ok: false,
      code: 'room_full',
    });

    open(registry, conn());
    open(registry, conn());
    expect(registry.hostOpen(conn(), { relayVersion: V })).toEqual({
      ok: false,
      code: 'server_full',
    });
  });

  it('同一條連線不能既當房主又當客人，也不能重複建房', () => {
    const { registry, conn } = setup();
    const host = conn();
    const { code } = open(registry, host);
    expect(registry.join(host, { relayVersion: V, code })).toEqual({
      ok: false,
      code: 'invalid_message',
    });
    expect(registry.hostOpen(host, { relayVersion: V })).toEqual({
      ok: false,
      code: 'invalid_message',
    });
  });
});

describe('中繼：轉發（不透明）', () => {
  it('原樣轉發任何 data，雙向；伺服器不改也不看內容', () => {
    const { registry, conn } = setup();
    const host = conn();
    const { code } = open(registry, host);
    const guest = conn();
    registry.join(guest, { relayVersion: V, code });
    const weird = { t: 'event', event: '不認識的事件', payload: [1, { x: null }], extra: '任意' };
    registry.toHost(guest, { data: weird });
    expect(host.of(RELAY_EVENTS.fromGuest)).toEqual([{ guestId: 'g1', data: weird }]);
    registry.toGuest(host, { guestId: 'g1', data: weird });
    expect(guest.of(RELAY_EVENTS.fromHost)).toEqual([{ data: weird }]);
  });

  it('客人彼此看不到對方的訊息；房主只能送給自己房間的客人', () => {
    const { registry, conn } = setup();
    const hostA = conn();
    const a = open(registry, hostA);
    const hostB = conn();
    open(registry, hostB);
    const g1 = conn();
    const g2 = conn();
    registry.join(g1, { relayVersion: V, code: a.code });
    registry.join(g2, { relayVersion: V, code: a.code });
    registry.toHost(g1, { data: 'hi' });
    expect(g2.of(RELAY_EVENTS.fromHost)).toEqual([]);
    // B 房主想對 A 房的客人說話：guestId 在 B 房不存在，沒有任何送達
    registry.toGuest(hostB, { guestId: 'g1', data: 'x' });
    expect(g1.of(RELAY_EVENTS.fromHost)).toEqual([]);
  });

  it('角色不符：客人不能 toGuest、房主不能 toHost、沒加入的不能轉發', () => {
    const { registry, conn } = setup();
    const host = conn();
    const { code } = open(registry, host);
    const guest = conn();
    registry.join(guest, { relayVersion: V, code });
    registry.toGuest(guest, { guestId: 'g1', data: 1 });
    registry.toHost(host, { data: 1 });
    const stranger = conn();
    registry.toHost(stranger, { data: 1 });
    expect(guest.errors()).toEqual(['not_host']);
    expect(host.errors()).toEqual(['not_guest']);
    expect(stranger.errors()).toEqual(['not_guest']);
  });

  it('過大的 data 被擋；格式錯誤的外層被擋', () => {
    const { registry, conn } = setup({ maxDataBytes: 100 });
    const host = conn();
    const { code } = open(registry, host);
    const guest = conn();
    registry.join(guest, { relayVersion: V, code });
    registry.toHost(guest, { data: 'x'.repeat(200) });
    registry.toHost(guest, { data: 'ok', extra: true });
    expect(guest.errors()).toEqual(['payload_too_large', 'invalid_message']);
    expect(host.of(RELAY_EVENTS.fromGuest)).toEqual([]);
  });

  it('客人訊息速率受限（突發 30、每秒 5）；房間頻寬也受限', () => {
    const { registry, conn, scheduler } = setup({ roomBytesBurst: 1000, roomBytesPerSecond: 100 });
    const host = conn();
    const { code } = open(registry, host);
    const guest = conn();
    registry.join(guest, { relayVersion: V, code });
    for (let i = 0; i < 40; i += 1) registry.toHost(guest, { data: i });
    expect(host.of(RELAY_EVENTS.fromGuest).length).toBe(30);
    expect(guest.errors().length).toBe(10);
    scheduler.advance(10_000); // 補滿速率額度（也避免閒置被踢影響這項測試：下面持續有訊息）
    const before = host.of(RELAY_EVENTS.fromGuest).length;
    registry.toHost(guest, { data: 'y'.repeat(900) });
    registry.toHost(guest, { data: 'y'.repeat(900) }); // 房間頻寬（burst 1000）不夠第二次
    expect(host.of(RELAY_EVENTS.fromGuest).length).toBe(before + 1);
    expect(guest.errors().at(-1)).toBe('rate_limited');
  });
});

describe('中繼：斷線、接回、關房', () => {
  it('客人斷線，房主收到 guest-left', () => {
    const { registry, conn } = setup();
    const host = conn();
    const { code } = open(registry, host);
    const guest = conn();
    registry.join(guest, { relayVersion: V, code });
    registry.disconnected(guest);
    expect(host.of(RELAY_EVENTS.guestLeft)).toEqual([{ guestId: 'g1' }]);
    expect(registry.guestCount(code)).toBe(0);
  });

  it('房主斷線：客人收到離線通知；寬限期內用房號＋金鑰接回，客人與房間都還在', () => {
    const { registry, conn, scheduler } = setup({ idleKickMs: 0 });
    const host = conn();
    const { code, hostKey } = open(registry, host);
    const guest = conn();
    registry.join(guest, { relayVersion: V, code });
    registry.disconnected(host);
    expect(guest.of(RELAY_EVENTS.hostStatus)).toEqual([{ online: false }]);
    expect(registry.join(conn(), { relayVersion: V, code })).toEqual({
      ok: false,
      code: 'host_offline',
    });
    registry.toHost(guest, { data: 1 });
    expect(guest.errors()).toEqual(['host_offline']);

    scheduler.advance(300);
    const back = conn();
    expect(registry.hostOpen(back, { relayVersion: V, code, hostKey })).toEqual({
      ok: true,
      code,
      hostKey,
      epoch: 0,
    });
    expect(guest.of(RELAY_EVENTS.hostStatus)).toEqual([{ online: false }, { online: true }]);
    expect(back.of(RELAY_EVENTS.guestJoined)).toEqual([{ guestId: 'g1' }]); // 重新告知現有客人
    scheduler.advance(10_000);
    expect(registry.roomCount).toBe(1);
    expect(guest.closed).toBe(false);
  });

  it('金鑰錯誤不能接回；寬限期過了房間關閉、客人被通知並中斷', () => {
    const { registry, conn, scheduler } = setup();
    const host = conn();
    const { code } = open(registry, host);
    const guest = conn();
    registry.join(guest, { relayVersion: V, code });
    registry.disconnected(host);
    expect(registry.hostOpen(conn(), { relayVersion: V, code, hostKey: '0'.repeat(32) })).toEqual({
      ok: false,
      code: 'bad_host_key',
    });
    scheduler.advance(600);
    expect(registry.roomCount).toBe(0);
    expect(guest.of(RELAY_EVENTS.closed)).toEqual([{ reason: 'host_left' }]);
    expect(guest.closed).toBe(true);
    expect(registry.hostOpen(conn(), { relayVersion: V, code, hostKey: '0'.repeat(32) })).toEqual({
      ok: false,
      code: 'room_not_found',
    });
  });

  it('房主在舊連線還沒被發現斷掉時重連：新連線接手，舊連線被中斷', () => {
    const { registry, conn } = setup();
    const oldHost = conn();
    const { code, hostKey } = open(registry, oldHost);
    const newHost = conn();
    expect(registry.hostOpen(newHost, { relayVersion: V, code, hostKey }).ok).toBe(true);
    expect(oldHost.closed).toBe(true);
    registry.disconnected(oldHost); // 舊連線的關閉事件晚到：不能讓房間進入寬限期
    const guest = conn();
    expect(registry.join(guest, { relayVersion: V, code }).ok).toBe(true);
  });

  it('房主踢人：客人被通知並中斷，房主收到 guest-left', () => {
    const { registry, conn } = setup();
    const host = conn();
    const { code } = open(registry, host);
    const guest = conn();
    registry.join(guest, { relayVersion: V, code });
    registry.kick(host, { guestId: 'g1' });
    expect(guest.of(RELAY_EVENTS.closed)).toEqual([{ reason: 'kicked' }]);
    expect(guest.closed).toBe(true);
    expect(host.of(RELAY_EVENTS.guestLeft)).toEqual([{ guestId: 'g1' }]);
    registry.kick(guest, { guestId: 'g1' });
    expect(guest.errors()).toEqual(['not_host']);
  });
});

describe('中繼：停泊（客人都直連後，房主不佔伺服器連線）', () => {
  it('中繼上還有客人就不能停泊；沒有客人才行', () => {
    const { registry, conn } = setup({ idleKickMs: 0 });
    const host = conn();
    const { code } = open(registry, host);
    const guest = conn();
    registry.join(guest, { relayVersion: V, code });
    expect(registry.park(host)).toEqual({ ok: false, code: 'guests_present' });
    registry.disconnected(guest);
    expect(registry.park(host)).toEqual({ ok: true });
    expect(registry.park(guest)).toEqual({ ok: false, code: 'not_host' });
  });

  it('停泊後房主斷線：房號保留到停泊期限（比意外斷線久），期間新客人得到 host_offline、房主可用金鑰接回', () => {
    const { registry, conn, scheduler } = setup({ idleKickMs: 0 });
    const host = conn();
    const { code, hostKey } = open(registry, host);
    registry.park(host);
    registry.disconnected(host);
    scheduler.advance(4_000); // 超過意外斷線的寬限（500ms），但還在停泊期限內（5s）
    expect(registry.roomCount).toBe(1);
    expect(registry.join(conn(), { relayVersion: V, code })).toEqual({
      ok: false,
      code: 'host_offline',
    });
    const back = conn();
    expect(registry.hostOpen(back, { relayVersion: V, code, hostKey })).toEqual({
      ok: true,
      code,
      hostKey,
      epoch: 0,
    });
    // 接回後不再是停泊狀態：再次意外斷線只有短寬限
    registry.disconnected(back);
    scheduler.advance(600);
    expect(registry.roomCount).toBe(0);
  });

  it('停泊中（房主連線還在）新客人也加入不了：得到 host_offline', () => {
    const { registry, conn } = setup({ idleKickMs: 0 });
    const host = conn();
    const { code } = open(registry, host);
    registry.park(host);
    expect(registry.join(conn(), { relayVersion: V, code })).toEqual({
      ok: false,
      code: 'host_offline',
    });
  });

  it('登記遺失後（伺服器重啟）：帶 restore 的房主可用原房號與金鑰重新登記；沒帶 restore 或房號已被占用則不行', () => {
    const { registry, conn } = setup({ idleKickMs: 0 });
    const hostKey = 'a'.repeat(32);
    expect(registry.hostOpen(conn(), { relayVersion: V, code: 'ABCDE', hostKey })).toEqual({
      ok: false,
      code: 'room_not_found',
    });
    expect(
      registry.hostOpen(conn(), { relayVersion: V, code: 'ABCDE', hostKey, restore: true }),
    ).toEqual({
      ok: true,
      code: 'ABCDE',
      hostKey,
      epoch: 0,
    });
    expect(registry.roomCount).toBe(1);
    // 已登記的房號：restore 不能搶（金鑰不同就是 bad_host_key）
    expect(
      registry.hostOpen(conn(), {
        relayVersion: V,
        code: 'ABCDE',
        hostKey: 'b'.repeat(32),
        restore: true,
      }),
    ).toEqual({ ok: false, code: 'bad_host_key' });
  });

  it('停泊逾期：房號釋放', () => {
    const { registry, conn, scheduler } = setup({ idleKickMs: 0 });
    const host = conn();
    const { code, hostKey } = open(registry, host);
    registry.park(host);
    registry.disconnected(host);
    scheduler.advance(5_100);
    expect(registry.roomCount).toBe(0);
    expect(registry.hostOpen(conn(), { relayVersion: V, code, hostKey })).toEqual({
      ok: false,
      code: 'room_not_found',
    });
  });
});

describe('中繼：閒置', () => {
  it('沒有任何訊息就被踢；有訊息（含 ping）就不被踢', () => {
    const { registry, conn, scheduler } = setup();
    const quiet = conn();
    const busy = conn();
    scheduler.advance(900);
    registry.ping(busy);
    scheduler.advance(900);
    expect(quiet.of(RELAY_EVENTS.closed)).toEqual([{ reason: 'idle_timeout' }]);
    expect(quiet.closed).toBe(true);
    expect(busy.closed).toBe(false);
    scheduler.advance(1000);
    expect(busy.closed).toBe(true);
  });

  it('idleKickMs=0 不踢', () => {
    const { conn, scheduler } = setup({ idleKickMs: 0 });
    const c = conn();
    scheduler.advance(10_000_000);
    expect(c.closed).toBe(false);
  });
});

// ── 房主轉移（M9）─────────────────────────────────────

const keyOf = (n: number): string => String(n).repeat(32).slice(0, 32); // 0..9 → 32 個相同字元的十六進位

describe('中繼：房主轉移', () => {
  /** 房主＋兩位客人（g1、g2），並登記後備順序：key1 → key2。 */
  function room(overrides: Partial<RelayOptions> = {}) {
    const ctx = setup({
      idleKickMs: 0,
      hostGraceMs: 500,
      successionGraceMs: 10_000,
      successionStaggerMs: 3_000,
      maxGuests: 4,
      ...overrides,
    });
    const host = ctx.conn();
    const { code, hostKey } = open(ctx.registry, host);
    const guests = [ctx.conn(), ctx.conn()];
    for (const g of guests) ctx.registry.join(g, { relayVersion: V, code });
    const order = [hashToken(keyOf(1)), hashToken(keyOf(2))];
    expect(ctx.registry.succession(host, { order })).toEqual({ ok: true });
    return { ...ctx, host, code, hostKey, guests, order };
  }
  const take = (r: ReturnType<typeof room>, conn: FakeConn, key: number) =>
    r.registry.takeover(conn, { relayVersion: V, code: r.code, key: keyOf(key) });

  it('登記順序只有房主能做；格式錯誤被拒', () => {
    const r = room();
    expect(r.registry.succession(r.guests[0] as FakeConn, { order: [] })).toEqual({
      ok: false,
      code: 'not_host',
    });
    expect(r.registry.succession(r.host, { order: ['x'] })).toEqual({
      ok: false,
      code: 'invalid_message',
    });
  });

  it('房主還在線上：任何人都不能接手（host_online）；沒登記或金鑰不對是 bad_takeover', () => {
    const r = room();
    expect(take(r, r.conn(), 1)).toEqual({ ok: false, code: 'host_online' });
    expect(take(r, r.conn(), 7)).toEqual({ ok: false, code: 'bad_takeover' });
    expect(
      r.registry.takeover(r.conn(), { relayVersion: V, code: 'ZZZZZ', key: keyOf(1) }),
    ).toEqual({
      ok: false,
      code: 'room_not_found',
    });
  });

  it('時序由伺服器強制：第一順位等 10 秒、第二順位等 13 秒；太早會告知還要等多久', () => {
    const r = room();
    r.registry.disconnected(r.host);
    r.scheduler.advance(9_000);
    expect(take(r, r.conn(), 1)).toEqual({ ok: false, code: 'too_early', retryInMs: 1_000 });
    expect(take(r, r.conn(), 2)).toEqual({ ok: false, code: 'too_early', retryInMs: 4_000 });
    r.scheduler.advance(1_000);
    // 房間要撐過最後一順位的接手時間（遠比一般的 500ms 寬限久）
    expect(r.registry.roomCount).toBe(1);
    const taker = r.conn();
    const ack = take(r, taker, 1);
    expect(ack).toMatchObject({ ok: true, code: r.code, epoch: 1 });
    expect((ack as { hostKey: string }).hostKey).not.toBe(r.hostKey);
  });

  it('第一順位沒出現：第二順位在 13 秒時接手；第一順位之後再來只會被擋（host_online）', () => {
    const r = room();
    r.registry.disconnected(r.host);
    r.scheduler.advance(12_999);
    expect(take(r, r.conn(), 2)).toMatchObject({ ok: false, code: 'too_early' });
    r.scheduler.advance(1);
    expect(take(r, r.conn(), 2)).toMatchObject({ ok: true, epoch: 1 });
    expect(take(r, r.conn(), 1)).toEqual({ ok: false, code: 'bad_takeover' }); // 順序在轉移後清空，新房主要重新登記
  });

  it('接手後：客人收到房主上線、新房主收到所有客人；舊房主帶舊金鑰回來得到 superseded', () => {
    const r = room();
    r.registry.disconnected(r.host);
    r.scheduler.advance(10_000);
    const taker = r.conn();
    const ack = take(r, taker, 1) as { ok: true; hostKey: string };
    expect(r.guests[0]?.of(RELAY_EVENTS.hostStatus)).toEqual([{ online: false }, { online: true }]);
    expect(taker.of(RELAY_EVENTS.guestJoined)).toEqual([{ guestId: 'g1' }, { guestId: 'g2' }]);
    // 新房主可以轉發訊息
    r.registry.toGuest(taker, { guestId: 'g1', data: { hi: 1 } });
    expect(r.guests[0]?.of(RELAY_EVENTS.fromHost)).toEqual([{ data: { hi: 1 } }]);
    // 舊房主（網路恢復）：舊金鑰被擋，知道自己被取代了
    expect(
      r.registry.hostOpen(r.conn(), { relayVersion: V, code: r.code, hostKey: r.hostKey }),
    ).toEqual({
      ok: false,
      code: 'superseded',
    });
    // 新金鑰才是房主
    expect(
      r.registry.hostOpen(r.conn(), { relayVersion: V, code: r.code, hostKey: ack.hostKey }),
    ).toMatchObject({ ok: true, epoch: 1 });
  });

  it('房主在寬限內自己回來（重新整理）：不需要轉移，之後後備也不能接手', () => {
    const r = room();
    r.registry.disconnected(r.host);
    r.scheduler.advance(5_000);
    expect(
      r.registry.hostOpen(r.conn(), { relayVersion: V, code: r.code, hostKey: r.hostKey }),
    ).toMatchObject({
      ok: true,
      epoch: 0,
    });
    r.scheduler.advance(60_000);
    expect(take(r, r.conn(), 1)).toEqual({ ok: false, code: 'host_online' });
  });

  it('沒有後備順序：維持原本的短寬限，逾時關房', () => {
    const r = room();
    r.registry.succession(r.host, { order: [] });
    r.registry.disconnected(r.host);
    r.scheduler.advance(600);
    expect(r.registry.roomCount).toBe(0);
  });

  it('沒人接手：撐過最後一順位的時間後關房，客人被告知', () => {
    const r = room();
    r.registry.disconnected(r.host);
    r.scheduler.advance(13_000 + 10_000 + 1);
    expect(r.registry.roomCount).toBe(0);
    expect(r.guests[0]?.of(RELAY_EVENTS.closed)).toEqual([{ reason: 'host_left' }]);
  });

  it('停泊中的房間：沒人懷疑時不能接手；有客人（直連斷了）找不到房主後才開始計時', () => {
    const r = room({ parkTtlMs: 3_600_000 });
    // 客人都改走直連後房主停泊（這裡直接讓客人離開中繼）
    for (const g of r.guests) r.registry.disconnected(g);
    expect(r.registry.park(r.host)).toEqual({ ok: true });
    r.registry.disconnected(r.host);
    r.scheduler.advance(60_000);
    expect(take(r, r.conn(), 1)).toEqual({ ok: false, code: 'host_online' });
    // 直連斷掉的客人來找房主：host_offline，並開始計時
    expect(r.registry.join(r.conn(), { relayVersion: V, code: r.code })).toEqual({
      ok: false,
      code: 'host_offline',
    });
    r.scheduler.advance(4_000);
    expect(take(r, r.conn(), 1)).toMatchObject({ ok: false, code: 'too_early', retryInMs: 6_000 });
    r.scheduler.advance(6_000);
    expect(take(r, r.conn(), 1)).toMatchObject({ ok: true, epoch: 1 });
  });

  it('停泊的房主在懷疑期間回來：清除懷疑，之後不能接手', () => {
    const r = room({ parkTtlMs: 3_600_000 });
    for (const g of r.guests) r.registry.disconnected(g);
    r.registry.park(r.host);
    r.registry.disconnected(r.host);
    r.registry.join(r.conn(), { relayVersion: V, code: r.code });
    r.scheduler.advance(5_000);
    expect(
      r.registry.hostOpen(r.conn(), { relayVersion: V, code: r.code, hostKey: r.hostKey }).ok,
    ).toBe(true);
    r.scheduler.advance(60_000);
    expect(take(r, r.conn(), 1)).toEqual({ ok: false, code: 'host_online' });
  });

  it('計畫性交接：指定的後備立刻成功，原房主的連線被取代並中斷；不必等寬限', () => {
    const r = room();
    expect(r.registry.handover(r.host, { target: r.order[1] })).toEqual({ ok: true });
    expect(take(r, r.conn(), 1)).toEqual({ ok: false, code: 'host_online' }); // 沒被指定的人不行
    const taker = r.conn();
    expect(take(r, taker, 2)).toMatchObject({ ok: true, epoch: 1 });
    expect(r.host.of(RELAY_EVENTS.closed)).toEqual([{ reason: 'superseded' }]);
    expect(r.host.closed).toBe(true);
    expect(taker.of(RELAY_EVENTS.guestJoined)).toHaveLength(2);
    // 原房主不能再當房主
    expect(r.registry.toGuest(r.host, { guestId: 'g1', data: 1 })).toBeUndefined();
    expect(r.host.errors()).toContain('not_host');
  });

  it('計畫性交接逾期沒人接手：視同沒發生，原房主繼續', () => {
    const r = room({ handoverTtlMs: 5_000 });
    r.registry.handover(r.host, { target: r.order[0] as string });
    r.scheduler.advance(5_001);
    expect(take(r, r.conn(), 1)).toEqual({ ok: false, code: 'host_online' });
    expect(r.host.closed).toBe(false);
  });

  it('交接對象必須在登記的順序裡；只有房主能發起', () => {
    const r = room();
    expect(r.registry.handover(r.host, { target: hashToken('nope') })).toEqual({
      ok: false,
      code: 'bad_takeover',
    });
    expect(r.registry.handover(r.guests[0] as FakeConn, { target: r.order[0] as string })).toEqual({
      ok: false,
      code: 'not_host',
    });
  });

  it('接手請求有速率限制', () => {
    const r = room();
    const stranger = r.conn();
    const results = Array.from({ length: 60 }, () => take(r, stranger, 7));
    expect(results.some((x) => !x.ok && x.code === 'rate_limited')).toBe(true);
  });

  it('伺服器登記遺失後 restore：房主帶回自己的世代', () => {
    const { registry, conn } = setup({ idleKickMs: 0 });
    const ack = registry.hostOpen(conn(), {
      relayVersion: V,
      code: 'ABCDE',
      hostKey: 'a'.repeat(32),
      restore: true,
      epoch: 3,
    });
    expect(ack).toMatchObject({ ok: true, epoch: 3 });
  });
});
