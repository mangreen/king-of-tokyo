import { describe, expect, it } from 'vitest';
import { defaultAction } from '@kot/rules';
import type { GameActionInput } from '@kot/protocol';
import { Room, type Timings } from './room.js';
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

function started() {
  const scheduler = new FakeScheduler();
  const publisher = new RecordingPublisher();
  const room = new Room('ABCDE', { id: 'host', nickname: '房主' }, testCardSet(), {
    scheduler,
    publisher,
    newSeed: () => 4242,
    timings: TIMINGS,
    onClose: () => undefined,
    onMemberRemoved: () => undefined,
  });
  room.join({ id: 'p2', nickname: '客人' });
  room.setReady('p2', true);
  expect(room.start('host')).toEqual({ ok: true });
  return { room, scheduler, publisher };
}

type Ctx = ReturnType<typeof started>;

function actorOf(ctx: Ctx): string {
  const seat = ctx.publisher.lastGame('host')?.actorSeat;
  const player = ctx.room.snapshot().players.find((p) => p.seat === seat);
  if (!player) throw new Error('找不到決策者');
  return player.id;
}

/** 以最保守的動作推進，直到進入買牌階段。 */
function toBuyPhase(ctx: Ctx): string {
  for (let i = 0; i < 50; i += 1) {
    const state = ctx.publisher.lastGame('host')?.state;
    if (!state) throw new Error('沒有狀態');
    if (state.phase === 'buy') return actorOf(ctx);
    const fallback = defaultAction(state);
    if (!fallback) throw new Error('沒有動作');
    const intent = Object.fromEntries(Object.entries(fallback).filter(([key]) => key !== 'seat'));
    const result = ctx.room.act(actorOf(ctx), intent as GameActionInput);
    expect(result).toEqual({ ok: true });
  }
  throw new Error('沒有進入買牌階段');
}

describe('卡牌組與視角遮蔽', () => {
  it('開局時每位玩家都收到完整卡牌目錄；房間摘要帶有卡牌組資訊', () => {
    const { room, publisher } = started();
    const set = testCardSet();
    for (const id of ['host', 'p2']) {
      const cards = publisher.cards.get(id);
      expect(cards).toHaveLength(1);
      expect(cards?.[0]?.cardSetId).toBe('original');
      expect(cards?.[0]?.cards).toHaveLength(set.set.cards.length);
    }
    expect(room.snapshot().cardSet).toEqual({
      id: 'original',
      name: set.set.name,
      cardCount: set.set.cards.length,
    });
  });

  it('重連（resync）會重送卡牌目錄與狀態，且狀態不含事件', () => {
    const { room, publisher } = started();
    room.resync('p2');
    expect(publisher.cards.get('p2')).toHaveLength(2);
    expect(publisher.lastGame('p2')?.events).toEqual([]);
  });

  it('送給玩家的狀態不含亂數狀態與牌庫內容，但保留牌庫張數與面朝上的牌', () => {
    const { publisher } = started();
    const set = testCardSet();
    for (const id of ['host', 'p2']) {
      const state = publisher.lastGame(id)?.state;
      expect(state?.rng).toBe(0);
      const market = state?.market;
      expect(market?.faceUp).toHaveLength(3);
      for (const cardId of market?.faceUp ?? []) {
        expect(set.set.cards.some((c) => c.id === cardId)).toBe(true);
      }
      expect(market?.deck.length).toBe(set.set.cards.length - 3);
      expect(market?.deck.every((c) => c === '')).toBe(true);
    }
  });
});

describe('買牌階段的動作', () => {
  it('買牌階段：能量不足的翻牌 → not_enough_energy；不在商店的牌 → 被拒絕；可以結束回合', () => {
    const ctx = started();
    const actor = toBuyPhase(ctx);
    const state = ctx.publisher.lastGame('host')?.state;
    const market = state?.market;
    if (!state || !market) throw new Error('沒有商店');
    const energy = state.monsters[state.turn.seat]?.energy ?? 0;

    if (energy < 2) {
      expect(ctx.room.act(actor, { type: 'sweep' })).toEqual({
        ok: false,
        code: 'not_enough_energy',
      });
    }
    const faceUp = market.faceUp[0] ?? '';
    const cost = testCardSet().set.cards.find((c) => c.id === faceUp)?.cost ?? 0;
    if (cost > energy) {
      expect(ctx.room.act(actor, { type: 'buy', cardId: faceUp })).toEqual({
        ok: false,
        code: 'not_enough_energy',
      });
    }
    const notOnSale = ctx.room.act(actor, { type: 'buy', cardId: 'no-such-card' });
    expect(notOnSale.ok).toBe(false);

    const other = actor === 'host' ? 'p2' : 'host';
    expect(ctx.room.act(other, { type: 'endTurn' })).toEqual({ ok: false, code: 'not_your_turn' });
    expect(ctx.room.act(actor, { type: 'endTurn' })).toEqual({ ok: true });
    expect(actorOf(ctx)).toBe(other);
  });

  it('買牌階段逾時：系統代打結束回合並標記為代打', () => {
    const ctx = started();
    const actor = toBuyPhase(ctx);
    const before = ctx.publisher.lastGame('host')?.state.version ?? 0;
    ctx.scheduler.advance(TIMINGS.decisionMs);
    const after = ctx.publisher.lastGame('host');
    expect(after?.state.version).toBeGreaterThan(before);
    expect(ctx.room.snapshot().players.find((p) => p.id === actor)?.away).toBe(true);
  });
});

describe('對局 seed 是機密', () => {
  it('randomSeed 產生 128 位元的十六進位字串，每次都不同', async () => {
    const { randomSeed } = await import('./random.js');
    const a = randomSeed();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomSeed()).not.toBe(a);
  });

  it('seed 只出現在重放資料裡，不會出現在送給玩家的任何訊息', () => {
    const scheduler = new FakeScheduler();
    const publisher = new RecordingPublisher();
    const seed = 'deadbeefdeadbeefdeadbeefdeadbeef';
    const room = new Room('ABCDE', { id: 'host', nickname: '房主' }, testCardSet(), {
      scheduler,
      publisher,
      newSeed: () => seed,
      timings: TIMINGS,
      onClose: () => undefined,
      onMemberRemoved: () => undefined,
    });
    room.join({ id: 'p2', nickname: '客人' });
    room.setReady('p2', true);
    room.start('host');
    expect(room.replayInfo().seed).toBe(seed);
    const sent = JSON.stringify([
      publisher.games.get('host'),
      publisher.games.get('p2'),
      publisher.cards.get('host'),
      room.snapshot(),
    ]);
    expect(sent).not.toContain(seed);
    // 密鑰（seed 經雜湊後的四個字組）也不在其中：狀態的 rng 欄位被抹成 0
    expect(publisher.lastGame('host')?.state.rng).toEqual({ key: [0, 0, 0, 0], n: 0 });
  });
});
