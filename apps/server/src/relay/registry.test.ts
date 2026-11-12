import { describe, expect, it } from 'vitest';
import {
  RELAY_EVENTS,
  RELAY_PROTOCOL_VERSION,
  type RelayErrorCode,
  type RelayServerEvents,
} from '@kot/protocol';
import { cryptoRandomInt, randomHex } from '@kot/room';
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
