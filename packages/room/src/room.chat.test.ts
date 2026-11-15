import { describe, expect, it } from 'vitest';
import { CHAT_MIN_INTERVAL_MS, Room } from './room.js';
import { FakeScheduler, RecordingPublisher } from './testing.js';
import { testCardSet } from './testing-fs.js';

function setup() {
  const scheduler = new FakeScheduler();
  const publisher = new RecordingPublisher();
  const room = new Room('ABCDE', { id: 'host', nickname: '房主' }, testCardSet(), {
    scheduler,
    publisher,
    newSeed: () => 7,
    timings: {
      decisionMs: 1000,
      yieldMs: 500,
      awayConnectedMs: 200,
      awayOfflineMs: 50,
      emptyRoomMs: 10_000,
      lobbyOfflineMs: 2_000,
      overRoomMs: 30_000,
      botMs: 500,
    },
    onClose: () => undefined,
    onMemberRemoved: () => undefined,
  });
  room.join({ id: 'p2', nickname: '客人' });
  return { room, scheduler, publisher };
}

describe('房內聊天', () => {
  it('廣播給房內所有真人（含發話者），帶發話者暱稱與座位', () => {
    const { room, publisher } = setup();
    expect(room.chat('host', '大家好')).toEqual({ ok: true });
    for (const id of ['host', 'p2']) {
      const got = publisher.chats.get(id) ?? [];
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ from: 'host', nickname: '房主', seat: null, text: '大家好' });
    }
  });

  it('對局中帶座位，電腦玩家與已離開的人不會收到', () => {
    const { room, publisher } = setup();
    room.addBot('host');
    room.setReady('p2', true);
    expect(room.start('host')).toEqual({ ok: true });
    room.leave('p2');
    expect(room.chat('host', 'gg')).toEqual({ ok: true });
    const msg = publisher.chats.get('host')?.at(-1);
    expect(typeof msg?.seat).toBe('number');
    expect(publisher.chats.get('p2')).toBeUndefined();
    expect([...publisher.chats.keys()]).toEqual(['host']);
  });

  it('不在房內、已離開或是電腦玩家都不能發話', () => {
    const { room } = setup();
    expect(room.chat('nobody', 'hi')).toEqual({ ok: false, code: 'not_in_room' });
  });

  it('同一位玩家連續發話受限制，過了間隔就恢復；不同玩家互不影響', () => {
    const { room, scheduler, publisher } = setup();
    expect(room.chat('host', 'a').ok).toBe(true);
    expect(room.chat('host', 'b')).toEqual({ ok: false, code: 'rate_limited' });
    expect(room.chat('p2', 'c').ok).toBe(true);
    scheduler.advance(CHAT_MIN_INTERVAL_MS);
    expect(room.chat('host', 'd').ok).toBe(true);
    expect((publisher.chats.get('p2') ?? []).map((m) => m.text)).toEqual(['a', 'c', 'd']);
  });

  it('不改變房間或對局狀態（沒有多餘的 room:state 推送）', () => {
    const { room, publisher } = setup();
    const before = publisher.rooms.get('host')?.length ?? 0;
    room.chat('host', 'hi');
    expect(publisher.rooms.get('host')?.length ?? 0).toBe(before);
  });
});
