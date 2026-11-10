import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS } from '@kot/protocol';
import { Room, type Timings } from './room.js';
import { FakeScheduler, RecordingPublisher, testCardSet } from './testing.js';

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

function setup() {
  const scheduler = new FakeScheduler();
  const publisher = new RecordingPublisher();
  let closed = 0;
  const room = new Room('ABCDE', { id: 'host', nickname: '房主' }, testCardSet(), {
    scheduler,
    publisher,
    newSeed: () => 4242,
    timings: TIMINGS,
    onClose: () => {
      closed += 1;
    },
    onMemberRemoved: () => undefined,
  });
  return { room, scheduler, publisher, closedCount: () => closed };
}

const bots = (room: Room) => room.snapshot().players.filter((p) => p.bot);

describe('電腦玩家：大廳', () => {
  it('房主可以加入電腦，電腦已準備、在線、有名字，可再移除', () => {
    const { room } = setup();
    expect(room.addBot('host')).toEqual({ ok: true });
    expect(room.addBot('host')).toEqual({ ok: true });
    const list = bots(room);
    expect(list.map((b) => b.nickname)).toEqual(['電腦 1', '電腦 2']);
    expect(list.every((b) => b.ready && b.connected && !b.away && !b.left)).toBe(true);
    expect(room.removeBot('host', list[0]?.id ?? '')).toEqual({ ok: true });
    expect(bots(room).map((b) => b.nickname)).toEqual(['電腦 2']);
    room.addBot('host');
    expect(bots(room).map((b) => b.nickname)).toEqual(['電腦 2', '電腦 1']); // 補上最小的空號
  });

  it('只有房主能加／移除；不能超過 6 個座位；開局後不能再改', () => {
    const { room } = setup();
    room.join({ id: 'p2', nickname: '客人' });
    expect(room.addBot('p2')).toEqual({ ok: false, code: 'not_host' });
    expect(room.addBot('nobody')).toEqual({ ok: false, code: 'not_in_room' });
    for (let i = 0; i < MAX_PLAYERS - 2; i += 1) expect(room.addBot('host').ok).toBe(true);
    expect(room.addBot('host')).toEqual({ ok: false, code: 'room_full' });
    const id = bots(room)[0]?.id ?? '';
    expect(room.removeBot('p2', id)).toEqual({ ok: false, code: 'not_host' });
    expect(room.removeBot('host', 'p2')).toEqual({ ok: false, code: 'wrong_state' }); // 真人不能被移除
    room.setReady('p2', true);
    expect(room.start('host')).toEqual({ ok: true });
    expect(room.addBot('host')).toEqual({ ok: false, code: 'wrong_state' });
    expect(room.removeBot('host', id)).toEqual({ ok: false, code: 'wrong_state' });
  });

  it('房主加一個電腦就能開局（不需要別的真人）；電腦與真人一樣分座位、分怪獸', () => {
    const { room, publisher } = setup();
    expect(room.start('host')).toEqual({ ok: false, code: 'not_enough_players' });
    room.addBot('host');
    expect(room.start('host')).toEqual({ ok: true });
    const players = room.snapshot().players;
    expect(players.map((p) => p.seat).sort()).toEqual([0, 1]);
    expect(new Set(players.map((p) => p.monster)).size).toBe(2);
    // 電腦不是連線，不會收到任何推送
    expect(publisher.rooms.has('bot-1')).toBe(false);
    expect(publisher.games.has('bot-1')).toBe(false);
  });

  it('電腦不是真人：不能用電腦的 id 操作房間', () => {
    const { room } = setup();
    room.addBot('host');
    expect(room.has('bot-1')).toBe(false);
    expect(room.leave('bot-1')).toEqual({ ok: false, code: 'not_in_room' });
    expect(room.memberIds()).toEqual(['host']);
  });

  it('房主離開、只剩電腦時房間關閉；房主移交給真人而不是電腦', () => {
    const a = setup();
    a.room.addBot('host');
    a.room.leave('host');
    expect(a.closedCount()).toBe(1);

    const b = setup();
    b.room.addBot('host');
    b.room.join({ id: 'p2', nickname: '客人' });
    b.room.leave('host');
    expect(b.room.hostId).toBe('p2');
  });
});

describe('電腦玩家：對局', () => {
  it('輪到電腦時過 botMs 就會自己出手；不被標成代管，也沒有倒數', () => {
    const { room, scheduler, publisher } = setup();
    room.addBot('host');
    room.start('host');
    const seatOf = (id: string) => room.snapshot().players.find((p) => p.id === id)?.seat;
    // 先讓房主打完自己的回合，直到輪到電腦
    const act = (): void => {
      const update = publisher.lastGame('host');
      if (update && update.actorSeat === seatOf('host')) {
        const s = update.state;
        const input =
          s.phase === 'roll'
            ? s.turn.rollsUsed === 0
              ? { type: 'roll' as const, keep: [] }
              : { type: 'endRolling' as const }
            : s.phase === 'buy'
              ? { type: 'endTurn' as const }
              : null;
        if (input) room.act('host', input);
        else scheduler.advance(TIMINGS.yieldMs);
      }
    };
    for (let i = 0; i < 40 && publisher.lastGame('host')?.actorSeat === seatOf('host'); i += 1) {
      act();
    }
    const before = publisher.lastGame('host')?.state.version ?? 0;
    expect(publisher.lastGame('host')?.actorSeat).toBe(seatOf('bot-1'));
    expect(publisher.lastGame('host')?.remainingMs).toBeNull();
    scheduler.advance(TIMINGS.botMs - 1);
    expect(publisher.lastGame('host')?.state.version).toBe(before);
    scheduler.advance(1);
    expect(publisher.lastGame('host')?.state.version).toBeGreaterThan(before);
    expect(bots(room).every((b) => !b.away)).toBe(true);
  });

  it('真人全部不動：電腦與代管一路打到結束，整局只用合法動作，且電腦不被標成代管', () => {
    const { room, scheduler } = setup();
    room.addBot('host');
    room.addBot('host');
    room.start('host');
    for (let i = 0; i < 4000 && room.phase === 'playing'; i += 1) {
      scheduler.advance(TIMINGS.decisionMs);
    }
    expect(room.phase).toBe('over');
    expect(bots(room).every((b) => !b.away)).toBe(true);
    expect(room.replayInfo().actions.length).toBeGreaterThan(10);
  });
});
