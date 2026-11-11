import { describe, expect, it } from 'vitest';
import { replay, defaultConfig, redactState, type RulesEnv } from '@kot/rules';
import { DEFAULT_TIMINGS, Room, type Timings } from './room.js';
import { FakeScheduler, RecordingPublisher } from './testing.js';
import { testCardSet } from './testing-fs.js';

const TIMINGS: Timings = {
  decisionMs: 1000,
  yieldMs: 500,
  awayConnectedMs: 200,
  awayOfflineMs: 50,
  emptyRoomMs: 10_000,
  lobbyOfflineMs: 2_000,
  overRoomMs: 30_000,
  botMs: 500,
};

function testEnv(): RulesEnv {
  return { cards: Object.fromEntries(testCardSet().set.cards.map((c) => [c.id, c])) };
}

function setup(timings: Timings = TIMINGS) {
  const scheduler = new FakeScheduler();
  const publisher = new RecordingPublisher();
  let closed = 0;
  const removed: string[] = [];
  const room = new Room('ABCDE', { id: 'host', nickname: '房主' }, testCardSet(), {
    scheduler,
    publisher,
    newSeed: () => 12345,
    timings,
    onClose: () => {
      closed += 1;
    },
    onMemberRemoved: (id) => {
      removed.push(id);
    },
  });
  return { room, scheduler, publisher, closedCount: () => closed, removed };
}

function twoPlayers() {
  const ctx = setup();
  ctx.room.join({ id: 'p2', nickname: '客人' });
  ctx.room.setReady('p2', true);
  return ctx;
}

/** 找出目前輪到的玩家 id。 */
function actorId(ctx: ReturnType<typeof setup>): string {
  const update = ctx.publisher.lastGame('host');
  const seat = update?.actorSeat;
  const player = ctx.room.snapshot().players.find((p) => p.seat === seat);
  if (!player) throw new Error('找不到目前決策者');
  return player.id;
}

describe('怪獸造型分配', () => {
  it('大廳階段沒有造型；開局後每位玩家拿到不同的造型，並隨房間狀態廣播', () => {
    const ctx = twoPlayers();
    expect(ctx.room.snapshot().players.every((p) => p.monster === null)).toBe(true);
    ctx.room.start('host');
    const players = ctx.publisher.lastRoom('p2')?.players ?? [];
    const looks = players.map((p) => p.monster);
    expect(looks.every((m) => typeof m === 'number')).toBe(true);
    expect(new Set(looks).size).toBe(players.length);
  });

  it('可注入分配方式（測試與重現用），依座位順序套用', () => {
    const scheduler = new FakeScheduler();
    const publisher = new RecordingPublisher();
    const room = new Room('ABCDE', { id: 'host', nickname: '房主' }, testCardSet(), {
      scheduler,
      publisher,
      newSeed: () => 1,
      pickMonsters: (n) => Array.from({ length: n }, (_, i) => 11 - i),
      timings: TIMINGS,
      onClose: () => undefined,
      onMemberRemoved: () => undefined,
    });
    room.join({ id: 'p2', nickname: 'B' });
    room.setReady('p2', true);
    room.start('host');
    expect(room.snapshot().players.map((p) => [p.seat, p.monster])).toEqual([
      [0, 11],
      [1, 10],
    ]);
  });
});

describe('大廳', () => {
  it('建立後房主在房間裡，且視為已準備', () => {
    const { room, publisher } = setup();
    expect(room.snapshot()).toMatchObject({
      code: 'ABCDE',
      phase: 'lobby',
      hostId: 'host',
      players: [{ id: 'host', ready: true, seat: null, connected: true }],
    });
    expect(publisher.lastRoom('host')?.code).toBe('ABCDE');
  });

  it('加入、準備會廣播給所有人；重複加入是冪等的', () => {
    const { room, publisher } = setup();
    expect(room.join({ id: 'p2', nickname: 'B' })).toEqual({ ok: true });
    expect(room.join({ id: 'p2', nickname: 'B' })).toEqual({ ok: true });
    expect(room.snapshot().players).toHaveLength(2);
    expect(publisher.lastRoom('host')?.players).toHaveLength(2);
    expect(publisher.lastRoom('p2')?.players).toHaveLength(2);
    room.setReady('p2', true);
    expect(publisher.lastRoom('host')?.players[1]?.ready).toBe(true);
  });

  it('最多 6 人，第 7 位 → room_full', () => {
    const { room } = setup();
    for (let i = 2; i <= 6; i += 1)
      expect(room.join({ id: `p${String(i)}`, nickname: 'x' }).ok).toBe(true);
    expect(room.join({ id: 'p7', nickname: 'x' })).toEqual({ ok: false, code: 'room_full' });
  });

  it('開始條件：只有房主、至少 2 人、其他人都已準備', () => {
    const { room } = setup();
    expect(room.start('host')).toEqual({ ok: false, code: 'not_enough_players' });
    room.join({ id: 'p2', nickname: 'B' });
    expect(room.start('host')).toEqual({ ok: false, code: 'not_ready' });
    room.setReady('p2', true);
    expect(room.start('p2')).toEqual({ ok: false, code: 'not_host' });
    expect(room.start('nobody')).toEqual({ ok: false, code: 'not_in_room' });
    expect(room.start('host')).toEqual({ ok: true });
    expect(room.phase).toBe('playing');
    expect(room.start('host')).toEqual({ ok: false, code: 'wrong_state' });
  });

  it('房主離開，下一位成為房主；最後一位離開則關閉房間', () => {
    const { room, closedCount } = setup();
    room.join({ id: 'p2', nickname: 'B' });
    room.leave('host');
    expect(room.snapshot().hostId).toBe('p2');
    expect(room.snapshot().players).toHaveLength(1);
    room.leave('p2');
    expect(closedCount()).toBe(1);
    expect(room.isClosed).toBe(true);
  });

  it('開始後不能再加入', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    expect(ctx.room.join({ id: 'late', nickname: 'x' })).toEqual({
      ok: false,
      code: 'game_in_progress',
    });
  });
});

describe('對局', () => {
  it('開始後依加入順序分配座位，並把初始狀態與事件推給每位玩家', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    expect(ctx.room.snapshot().players.map((p) => p.seat)).toEqual([0, 1]);
    for (const id of ['host', 'p2']) {
      const update = ctx.publisher.lastGame(id);
      expect(update?.state.config.playerCount).toBe(2);
      expect(update?.events.map((e) => e.type)).toEqual([
        'first_player_decided',
        'card_revealed',
        'card_revealed',
        'card_revealed',
        'turn_started',
      ]);
      expect(update?.remainingMs).toBe(TIMINGS.decisionMs);
    }
  });

  it('只有輪到的玩家能操作；座位由伺服器決定', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    const actor = actorId(ctx);
    const other = actor === 'host' ? 'p2' : 'host';
    expect(ctx.room.act(other, { type: 'roll', keep: [] })).toEqual({
      ok: false,
      code: 'not_your_turn',
    });
    expect(ctx.room.act(actor, { type: 'roll', keep: [] })).toEqual({ ok: true });
    const update = ctx.publisher.lastGame(other);
    expect(update?.events[0]?.type).toBe('dice_rolled');
    expect(update?.state.turn.rollsUsed).toBe(1);
  });

  it('規則引擎的拒絕原因原樣回傳', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    const actor = actorId(ctx);
    expect(ctx.room.act(actor, { type: 'endRolling' })).toEqual({ ok: false, code: 'roll_first' });
    expect(ctx.room.act(actor, { type: 'roll', keep: [0] })).toEqual({
      ok: false,
      code: 'invalid_keep',
    });
    expect(ctx.room.act(actor, { type: 'yieldDecision', leave: true })).toEqual({
      ok: false,
      code: 'wrong_phase',
    });
  });

  it('大廳階段送出對局動作 → wrong_state；不在房間 → not_in_room', () => {
    const ctx = setup();
    expect(ctx.room.act('host', { type: 'endRolling' })).toEqual({
      ok: false,
      code: 'wrong_state',
    });
    expect(ctx.room.act('x', { type: 'endRolling' })).toEqual({ ok: false, code: 'not_in_room' });
  });
});

describe('逾時代打', () => {
  it('在線玩家逾時：系統代打一步並標為 away；玩家再操作就解除', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    const actor = actorId(ctx);
    ctx.scheduler.advance(TIMINGS.decisionMs - 1);
    expect(ctx.room.snapshot().players.some((p) => p.away)).toBe(false);
    ctx.scheduler.advance(1);
    expect(ctx.room.snapshot().players.find((p) => p.id === actor)?.away).toBe(true);
    expect(ctx.publisher.lastGame(actor)?.state.turn.rollsUsed).toBeGreaterThan(0); // 已代打擲骰

    // 玩家回來做出合法動作 → 取回控制權
    const result = ctx.room.act(actor, { type: 'endRolling' });
    if (result.ok) {
      expect(ctx.room.snapshot().players.find((p) => p.id === actor)?.away).toBe(false);
    }
  });

  it('代打後的每一步使用較短的等待時間，整個回合很快走完', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    const firstActor = actorId(ctx);
    ctx.scheduler.advance(TIMINGS.decisionMs); // 第一步逾時
    // 之後每步 awayConnectedMs，最多 3 擲 + 結算，數步內換人
    ctx.scheduler.advance(TIMINGS.awayConnectedMs * 4);
    expect(actorId(ctx)).not.toBe(firstActor);
  });

  it('斷線的玩家輪到時只等 awayOfflineMs', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    const actor = actorId(ctx);
    ctx.room.setConnected(actor, false);
    expect(ctx.publisher.lastGame('host')?.remainingMs).toBeLessThanOrEqual(TIMINGS.decisionMs);
    ctx.scheduler.advance(TIMINGS.awayOfflineMs);
    expect(ctx.publisher.lastGame(actor === 'host' ? 'p2' : 'host')?.state.version).toBeGreaterThan(
      0,
    );
  });

  it('重連（resync）會重送完整狀態且不含事件', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    ctx.room.setConnected('p2', false);
    ctx.room.setConnected('p2', true);
    ctx.room.resync('p2');
    const update = ctx.publisher.lastGame('p2');
    expect(update?.events).toEqual([]);
    expect(ctx.publisher.lastRoom('p2')?.players.every((p) => p.connected)).toBe(true);
  });

  it('玩家全部斷線：超過 emptyRoomMs 後房間關閉；中途有人回來就取消', () => {
    // 大廳離線寬限設得比 emptyRoomMs 長，單獨驗證「整個房間沒人在線」的規則
    const lobbyTimings = { ...TIMINGS, lobbyOfflineMs: 1_000_000 };
    const offlineRoom = () => {
      const ctx = setup(lobbyTimings);
      ctx.room.join({ id: 'p2', nickname: '客人' });
      ctx.room.setConnected('host', false);
      ctx.room.setConnected('p2', false);
      return ctx;
    };

    const a = offlineRoom();
    a.scheduler.advance(TIMINGS.emptyRoomMs - 1);
    expect(a.closedCount()).toBe(0);
    a.scheduler.advance(1);
    expect(a.closedCount()).toBe(1);

    const b = offlineRoom();
    b.scheduler.advance(TIMINGS.emptyRoomMs - 1);
    b.room.setConnected('p2', true);
    b.scheduler.advance(TIMINGS.emptyRoomMs * 2);
    expect(b.closedCount()).toBe(0);
  });

  it('對局中離開：座位由系統代打，其他玩家仍可繼續；全部離開則關閉', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    ctx.room.leave('p2');
    expect(ctx.room.snapshot().players.find((p) => p.id === 'p2')).toMatchObject({
      left: true,
      away: true,
    });
    expect(ctx.room.act('p2', { type: 'endRolling' })).toEqual({ ok: false, code: 'not_in_room' });
    ctx.room.leave('host');
    expect(ctx.closedCount()).toBe(1);
  });
});

describe('完整對局與重放', () => {
  it('所有玩家都不操作：系統代打到遊戲結束，日誌可重放出相同結果', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    for (let i = 0; i < 20_000 && ctx.room.phase === 'playing'; i += 1) {
      ctx.scheduler.advance(DEFAULT_TIMINGS.decisionMs);
    }
    expect(ctx.room.phase).toBe('over');
    const final = ctx.publisher.lastGame('host');
    expect(final?.state.phase).toBe('over');
    expect(final?.actorSeat).toBeNull();
    expect(final?.remainingMs).toBeNull();

    const info = ctx.room.replayInfo();
    const again = replay(defaultConfig(2), info.seed, info.actions, testEnv());
    // 玩家收到的是遮蔽過的狀態（亂數狀態與牌庫內容被抹去），所以用同樣的視角比對
    expect(redactState(again.state, 0)).toEqual(final?.state);
    expect(info.cardSetId).toBe('original');
    expect(info.cardSetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(info.config).toEqual(defaultConfig(2));
  });

  it('遊戲結束後 phase 變 over，並廣播房間狀態；離開後房間才會空', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    for (let i = 0; i < 20_000 && ctx.room.phase === 'playing'; i += 1) {
      ctx.scheduler.advance(DEFAULT_TIMINGS.decisionMs);
    }
    expect(ctx.publisher.lastRoom('host')?.phase).toBe('over');
    expect(ctx.room.act('host', { type: 'endRolling' })).toEqual({ ok: false, code: 'game_over' });
  });
});

describe('審查後的修正：計時不能被重連拖延、離線成員不能佔位', () => {
  it('輪到的玩家反覆斷線重連，無法無限拖延：時鐘照常走，最後被代打', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    const actor = actorId(ctx);
    const versionBefore = ctx.publisher.lastGame('host')?.state.version;
    for (let t = 0; t < TIMINGS.decisionMs; t += 100) {
      ctx.room.setConnected(actor, false);
      ctx.room.setConnected(actor, true);
      ctx.scheduler.advance(100);
    }
    ctx.scheduler.advance(TIMINGS.awayOfflineMs);
    expect(ctx.publisher.lastGame('host')?.state.version).toBeGreaterThan(versionBefore ?? 0);
    expect(ctx.room.snapshot().players.find((p) => p.id === actor)?.away).toBe(true);
  });

  it('斷線只縮短等待並通知所有人新的剩餘時間；重連不延長', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    const actor = actorId(ctx);
    const observer = actor === 'host' ? 'p2' : 'host';
    ctx.room.setConnected(actor, false);
    expect(ctx.publisher.lastGame(observer)?.remainingMs).toBe(TIMINGS.awayOfflineMs);
    expect(ctx.publisher.lastGame(observer)?.events).toEqual([]);
    ctx.room.setConnected(actor, true);
    expect(ctx.publisher.lastGame(observer)?.remainingMs).toBe(TIMINGS.awayOfflineMs);
  });

  it('非輪到的玩家離開，不會重設目前決策者的時鐘', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    const actor = actorId(ctx);
    const other = actor === 'host' ? 'p2' : 'host';
    ctx.scheduler.advance(400);
    const before = ctx.publisher.lastGame(actor)?.remainingMs;
    ctx.room.leave(other);
    ctx.scheduler.advance(TIMINGS.decisionMs - 400);
    // 原本的 deadline 到了就代打；若被重設，這裡還不會代打
    expect(ctx.room.snapshot().players.find((p) => p.id === actor)?.away).toBe(true);
    expect(before).toBe(TIMINGS.decisionMs);
  });

  it('大廳離線的成員在寬限期後被移出（並通知管理者），重連則保留', () => {
    const ctx = twoPlayers();
    ctx.room.join({ id: 'p3', nickname: '佔位者' });
    ctx.room.setConnected('p3', false);
    ctx.scheduler.advance(TIMINGS.lobbyOfflineMs - 1);
    expect(ctx.room.snapshot().players).toHaveLength(3);
    ctx.scheduler.advance(1);
    expect(ctx.room.snapshot().players.map((p) => p.id)).toEqual(['host', 'p2']);
    expect(ctx.removed).toEqual(['p3']);

    ctx.room.setConnected('p2', false);
    ctx.scheduler.advance(TIMINGS.lobbyOfflineMs - 1);
    ctx.room.setConnected('p2', true);
    ctx.scheduler.advance(TIMINGS.lobbyOfflineMs * 3);
    expect(ctx.room.snapshot().players).toHaveLength(2);
    expect(ctx.removed).toEqual(['p3']);
  });

  it('離線的成員被移出後，可以順利開局', () => {
    const ctx = twoPlayers();
    ctx.room.join({ id: 'p3', nickname: '未準備' });
    ctx.room.setConnected('p3', false);
    expect(ctx.room.start('host')).toEqual({ ok: false, code: 'not_ready' });
    ctx.scheduler.advance(TIMINGS.lobbyOfflineMs);
    expect(ctx.room.start('host')).toEqual({ ok: true });
  });

  it('房主離開時，房主交給在線的成員', () => {
    const ctx = setup();
    ctx.room.join({ id: 'off', nickname: '離線' });
    ctx.room.join({ id: 'on', nickname: '在線' });
    ctx.room.setConnected('off', false);
    ctx.room.leave('host');
    expect(ctx.room.snapshot().hostId).toBe('on');
  });

  it('對局結束後房間最多保留 overRoomMs，即使玩家還在線', () => {
    const ctx = twoPlayers();
    ctx.room.start('host');
    for (let i = 0; i < 20_000 && ctx.room.phase === 'playing'; i += 1) {
      ctx.scheduler.advance(TIMINGS.awayOfflineMs); // 小步前進，避免一次跨過結束後的計時
    }
    expect(ctx.room.phase).toBe('over');
    expect(ctx.closedCount()).toBe(0);
    ctx.scheduler.advance(TIMINGS.overRoomMs);
    expect(ctx.closedCount()).toBe(1);
  });
});
