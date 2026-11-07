import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET, RoomCodeSchema } from '@kot/protocol';
import { RoomManager } from './manager.js';
import { TokenBucket } from './rateLimit.js';
import { DEFAULT_TIMINGS } from './room.js';
import { generateRoomCode } from './roomCode.js';
import { SessionStore } from './sessions.js';
import { FakeScheduler, RecordingPublisher } from './testing.js';

describe('generateRoomCode', () => {
  it('產生 5 碼、字元都在字元集內，且通過協定的房號驗證', () => {
    let n = 0;
    const code = generateRoomCode(() => n++ % ROOM_CODE_ALPHABET.length);
    expect(code).toHaveLength(5);
    expect(RoomCodeSchema.safeParse(code).success).toBe(true);
  });

  it('使用傳入的亂數來源（可重現）', () => {
    expect(generateRoomCode(() => 0)).toBe('AAAAA');
    expect(generateRoomCode(() => ROOM_CODE_ALPHABET.length - 1)).toBe('99999');
  });
});

describe('TokenBucket', () => {
  it('突發用完後被擋，隨時間補充', () => {
    let now = 0;
    const bucket = new TokenBucket(3, 1, () => now);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    now = 999;
    expect(bucket.take()).toBe(false);
    now = 1000;
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  it('補充不會超過容量', () => {
    let now = 0;
    const bucket = new TokenBucket(2, 10, () => now);
    now = 60_000;
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, false]);
  });
});

describe('SessionStore', () => {
  function setup(hasRoom: (id: string) => boolean = () => false) {
    const scheduler = new FakeScheduler();
    const store = new SessionStore(scheduler, 1000, hasRoom);
    return { scheduler, store };
  }

  it('token 能找回身分；不存儲明文 token', () => {
    const { store } = setup();
    const { session, token } = store.create('Mang');
    expect(store.resume(token)).toBe(session);
    expect(store.resume('0'.repeat(64))).toBeUndefined();
    expect(session.tokenHash).not.toBe(token);
    expect(JSON.stringify(session)).not.toContain(token);
    expect(session.playerId).not.toContain(token.slice(0, 8));
  });

  it('attach 回傳被取代的舊連線；舊連線的 detach 被忽略', () => {
    const { store } = setup();
    const { session } = store.create('Mang');
    expect(store.attach(session, 's1')).toBeNull();
    expect(store.attach(session, 's2')).toBe('s1');
    expect(store.detach(session, 's1')).toBe(false);
    expect(session.socketId).toBe('s2');
    expect(store.detach(session, 's2')).toBe(true);
    expect(session.socketId).toBeNull();
  });

  it('斷線且不在房間：超過 ttl 後身分失效；期間重連則保留', () => {
    const { store, scheduler } = setup();
    const a = store.create('A');
    store.attach(a.session, 's1');
    store.detach(a.session, 's1');
    scheduler.advance(999);
    expect(store.resume(a.token)).toBeDefined();
    scheduler.advance(1);
    expect(store.resume(a.token)).toBeUndefined();
    expect(store.size).toBe(0);

    const b = store.create('B');
    store.attach(b.session, 's1');
    store.detach(b.session, 's1');
    scheduler.advance(500);
    store.attach(b.session, 's2');
    scheduler.advance(5000);
    expect(store.resume(b.token)).toBeDefined();
  });

  it('還在房間裡的身分不會過期，房間關閉後才回收', () => {
    let inRoom = true;
    const { store, scheduler } = setup(() => inRoom);
    const { session, token } = store.create('A');
    store.attach(session, 's1');
    store.detach(session, 's1');
    scheduler.advance(10_000);
    expect(store.resume(token)).toBeDefined();
    inRoom = false;
    scheduler.advance(1000);
    expect(store.resume(token)).toBeUndefined();
  });
});

describe('RoomManager', () => {
  function setup(maxRooms = 5) {
    const scheduler = new FakeScheduler();
    const publisher = new RecordingPublisher();
    let next = 0;
    const manager = new RoomManager({
      scheduler,
      publisher,
      newSeed: () => 1,
      timings: DEFAULT_TIMINGS,
      // 每個房號用不同的字元，避免撞號
      randomInt: () => {
        next += 1;
        return Math.floor(next / 5) % ROOM_CODE_ALPHABET.length;
      },
      maxRooms,
    });
    return { manager, publisher, scheduler };
  }
  const alice = { id: 'a', nickname: 'Alice' };
  const bob = { id: 'b', nickname: 'Bob' };

  it('建立、加入、離開；一位玩家同時只能在一個房間', () => {
    const { manager, publisher } = setup();
    const created = manager.createRoom(alice);
    if (!created.ok) throw new Error('建立失敗');
    expect(manager.createRoom(alice)).toEqual({ ok: false, code: 'already_in_room' });
    expect(manager.joinRoom(created.code, alice)).toEqual({ ok: false, code: 'already_in_room' });
    expect(manager.joinRoom(created.code, bob)).toEqual({ ok: true });
    expect(manager.roomOf('b')?.code).toBe(created.code);
    expect(manager.leave('b')).toEqual({ ok: true });
    expect(manager.roomOf('b')).toBeUndefined();
    expect(publisher.lastRoom('b')).toBeNull(); // 離開者收到「不在房間」
    expect(manager.leave('b')).toEqual({ ok: false, code: 'not_in_room' });
  });

  it('加入不存在的房間 → room_not_found', () => {
    expect(setup().manager.joinRoom('ZZZZZ', bob)).toEqual({ ok: false, code: 'room_not_found' });
  });

  it('房間數量達上限 → too_many_rooms；房間關閉後釋放名額', () => {
    const { manager } = setup(1);
    expect(manager.createRoom(alice).ok).toBe(true);
    expect(manager.createRoom(bob)).toEqual({ ok: false, code: 'too_many_rooms' });
    manager.leave('a'); // 唯一的成員離開 → 房間關閉
    expect(manager.roomCount).toBe(0);
    expect(manager.createRoom(bob).ok).toBe(true);
  });

  it('房間因無人在線逾時而關閉：成員被通知離開，且可以建立新房間', () => {
    const { manager, publisher, scheduler } = setup();
    const created = manager.createRoom(alice);
    if (!created.ok) throw new Error('建立失敗');
    manager.roomOf('a')?.setConnected('a', false);
    scheduler.advance(DEFAULT_TIMINGS.emptyRoomMs);
    expect(manager.roomCount).toBe(0);
    expect(manager.hasRoom('a')).toBe(false);
    expect(publisher.lastRoom('a')).toBeNull();
    expect(manager.createRoom(alice).ok).toBe(true);
  });
});
