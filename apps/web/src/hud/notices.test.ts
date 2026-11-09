import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@kot/rules';
import { noticesFor, shopNotice, type NoticeContext } from './notices.js';

const ctx = (over: Partial<NoticeContext> = {}): NoticeContext => ({
  mySeat: 0,
  nameOf: (s) => ['我', 'Bob', 'Cat'][s] ?? `座位 ${String(s)}`,
  cardName: (id) => `卡-${id}`,
  victoryPoints: 20,
  vpNow: () => 0,
  ...over,
});
const texts = (events: GameEvent[], c = ctx()): string[] =>
  noticesFor(events, c).map((n) => n.text);

describe('noticesFor', () => {
  it('輪到自己才提示', () => {
    expect(texts([{ type: 'turn_started', seat: 0, round: 1 }])).toEqual(['輪到你了！']);
    expect(texts([{ type: 'turn_started', seat: 1, round: 1 }])).toEqual([]);
  });

  it('淘汰：自己是 danger，別人是 warn 並指出兇手', () => {
    const me = noticesFor([{ type: 'eliminated', seat: 0, by: 1 }], ctx());
    expect(me[0]?.kind).toBe('danger');
    const other = noticesFor([{ type: 'eliminated', seat: 1, by: 0 }], ctx());
    expect(other[0]).toMatchObject({ kind: 'warn', text: 'Bob 被淘汰（你幹的）' });
  });

  it('重擊（≥4）才提示；自己是目標時升級為 danger', () => {
    expect(texts([{ type: 'smash', attacker: 1, damage: 3, targets: [0] }])).toEqual([]);
    const n = noticesFor([{ type: 'smash', attacker: 1, damage: 5, targets: [0] }], ctx());
    expect(n[0]).toMatchObject({ kind: 'danger', text: 'Bob發動 5 點重擊，你是目標！' });
  });

  it('只有自己血量見底（≤3 且還活著）才警告', () => {
    const hurt = (seat: number, hp: number): GameEvent => ({
      type: 'damage_taken',
      seat,
      amount: 2,
      hp,
      source: 1,
    });
    expect(texts([hurt(0, 3)])).toEqual(['你的 HP 只剩 3！']);
    expect(texts([hurt(0, 4)])).toEqual([]);
    expect(texts([hurt(0, 0)])).toEqual([]);
    expect(texts([hurt(1, 1)])).toEqual([]);
  });

  it('VP：跨過「差 5 分」與「達標」門檻時各提示一次', () => {
    const gain = (amount: number): GameEvent => ({
      type: 'vp_gained',
      seat: 1,
      amount,
      reason: 'dice',
    });
    expect(texts([gain(2)], ctx({ vpNow: () => 14 }))).toEqual([]);
    expect(texts([gain(2)], ctx({ vpNow: () => 16 }))).toEqual(['Bob離勝利只差 4 VP']);
    expect(texts([gain(1)], ctx({ vpNow: () => 17 }))).toEqual([]);
    expect(texts([gain(3)], ctx({ vpNow: () => 21 }))).toEqual(['Bob 達到 20 VP！']);
    const mine = noticesFor(
      [{ type: 'vp_gained', seat: 0, amount: 2, reason: 'card' }],
      ctx({ vpNow: () => 20 }),
    );
    expect(mine[0]).toMatchObject({ kind: 'good', icon: '🏁' });
  });

  it('買牌、進入東京、自己中毒、額外回合、東京灣關閉都會提示', () => {
    const t = texts([
      { type: 'card_bought', seat: 1, cardId: 'x', cost: 3, from: null },
      { type: 'entered_tokyo', seat: 0, location: 'city' },
      { type: 'counter_gained', seat: 0, counter: 'poison', total: 1 },
      { type: 'counter_gained', seat: 1, counter: 'poison', total: 1 },
      { type: 'extra_turn_granted', seat: 1 },
      { type: 'bay_closed', seat: 2, movedTo: null },
    ]);
    expect(t).toEqual([
      'Bob買下 卡-x',
      '你進入東京市',
      '你中毒了',
      'Bob將再進行一個回合',
      '東京灣關閉了',
    ]);
  });

  it('一般事件（擲骰、回復、能量）不打擾', () => {
    expect(
      texts([
        { type: 'dice_rolled', seat: 0, rollNumber: 1, dice: [1, 2, 3], rerolled: [] },
        { type: 'healed', seat: 0, amount: 1 },
        { type: 'energy_gained', seat: 0, amount: 2 },
      ]),
    ).toEqual([]);
  });
});

describe('shopNotice', () => {
  it('買得起才提示，且帶有前往商店的動作', () => {
    expect(shopNotice(0)).toBeNull();
    expect(shopNotice(2)).toMatchObject({ text: '商店有 2 張牌買得起', action: 'shop' });
  });
});
