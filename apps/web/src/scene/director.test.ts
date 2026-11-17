import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@kot/rules';
import {
  IMPACT_DELAY,
  MAX_DURATION,
  MIN_SPEEDUP,
  directEvents,
  hitstopFor,
  powerOf,
  type Cue,
  UFO_DELIVER_AT,
  UFO_DURATION,
  UFO_HOLD,
} from './director.js';
import type { CardDef } from '@kot/rules';

const kinds = (cues: Cue[]): string[] => cues.map((c) => c.kind);
const of = <K extends Cue['kind']>(cues: Cue[], kind: K): Extract<Cue, { kind: K }>[] =>
  cues.filter((c): c is Extract<Cue, { kind: K }> => c.kind === kind);

describe('directEvents', () => {
  it('沒有可演的事件 → 空時間軸', () => {
    const t = directEvents([
      { type: 'dice_rolled', seat: 0, rollNumber: 1, dice: ['1', '2'] as never, rerolled: [0, 1] },
      { type: 'round_ended', round: 1 },
    ]);
    expect(t.cues).toEqual([]);
    expect(t.duration).toBe(0);
    expect(directEvents([])).toEqual({ cues: [], duration: 0 });
  });

  it('攻擊：撲擊 → 撞擊點才出現受擊與命中停頓，血量在受擊時更新', () => {
    const events: GameEvent[] = [
      { type: 'smash', attacker: 1, damage: 2, targets: [0, 2] },
      { type: 'damage_taken', seat: 0, amount: 2, hp: 8, source: 1 },
      { type: 'damage_taken', seat: 2, amount: 2, hp: 7, source: 1 },
    ];
    const { cues } = directEvents(events);
    const [lunge] = of(cues, 'lunge');
    expect(lunge).toMatchObject({ seat: 1, targets: [0, 2], power: 'light', at: 0 });
    const hits = of(cues, 'hit');
    expect(hits).toHaveLength(2);
    for (const h of hits) {
      expect(h.at).toBe(IMPACT_DELAY);
      expect(h.cause).toBe('attack');
    }
    expect(hits.map((h) => h.hp)).toEqual([8, 7]);
    expect(of(cues, 'hitstop')[0]?.dur).toBe(hitstopFor('light'));
  });

  it('重擊（≥5）切低角度英雄鏡頭；中等傷害推近被打的人', () => {
    const heavy = directEvents([
      { type: 'smash', attacker: 3, damage: 6, targets: [0] },
      { type: 'damage_taken', seat: 0, amount: 6, hp: 4, source: 3 },
    ]).cues;
    expect(of(heavy, 'shot')[0]?.spec).toMatchObject({ type: 'lowHero', seat: 3, targets: [0] });
    expect(of(heavy, 'hitstop')[0]?.dur).toBe(120);

    const medium = directEvents([
      { type: 'smash', attacker: 3, damage: 3, targets: [0] },
      { type: 'damage_taken', seat: 0, amount: 3, hp: 7, source: 3 },
    ]).cues;
    expect(of(medium, 'shot')[0]?.spec).toMatchObject({ type: 'pushIn', seat: 0 });
  });

  it('毒、卡牌等非骰子傷害：沒有撲擊，獨立受擊並保留 cause', () => {
    const { cues } = directEvents([
      { type: 'damage_taken', seat: 2, amount: 1, hp: 5, source: null, cause: 'poison' },
    ]);
    expect(kinds(cues)).toEqual(['hit', 'hitstop']);
    expect(of(cues, 'hit')[0]).toMatchObject({ seat: 2, cause: 'poison', by: null });
  });

  it('同一個來源的卡牌傷害不會誤掛到前一次撲擊', () => {
    const { cues } = directEvents([
      { type: 'smash', attacker: 1, damage: 1, targets: [0] },
      { type: 'damage_taken', seat: 0, amount: 1, hp: 9, source: 1 },
      { type: 'damage_taken', seat: 0, amount: 2, hp: 7, source: 1, cause: 'card' },
    ]);
    const hits = of(cues, 'hit');
    expect(hits[0]?.cause).toBe('attack');
    expect(hits[1]?.cause).toBe('card');
    expect(hits[1]!.at).toBeGreaterThan(hits[0]!.at);
  });

  it('進入東京：踩踏＋推近；讓位：離開；淘汰：倒下＋特寫', () => {
    const { cues } = directEvents([
      { type: 'yielded', seat: 2, location: 'city' },
      { type: 'entered_tokyo', seat: 1, location: 'city' },
      { type: 'eliminated', seat: 3, by: 1 },
    ]);
    expect(kinds(cues)).toEqual(['leave', 'stomp', 'shot', 'ko', 'shot']);
    expect(of(cues, 'stomp')[0]).toMatchObject({ seat: 1, location: 'city' });
    expect(of(cues, 'ko')[0]).toMatchObject({ seat: 3, by: 1 });
    expect(of(cues, 'shot')[1]?.spec).toMatchObject({ type: 'closeUp', seat: 3 });
    // 依序而不是同時
    const ats = cues.map((c) => c.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
  });

  it('資源與卡牌：拾取、卡牌光效、減傷護盾', () => {
    const { cues } = directEvents([
      { type: 'energy_gained', seat: 0, amount: 2 },
      { type: 'healed', seat: 0, amount: 1 },
      { type: 'vp_gained', seat: 0, amount: 3, reason: 'dice' } as never,
      { type: 'card_bought', seat: 0, cardId: 'x', cost: 3, from: null },
      { type: 'damage_prevented', seat: 1, amount: 1, cardId: 'armor' },
    ]);
    expect(of(cues, 'pickup').map((c) => [c.what, c.amount])).toEqual([
      ['energy', 2],
      ['heal', 1],
      ['vp', 3],
    ]);
    expect(of(cues, 'card')).toHaveLength(1);
    expect(of(cues, 'shield')[0]).toMatchObject({ seat: 1, amount: 1 });
  });

  it('遊戲結束：勝利＋環繞第一位勝者', () => {
    const { cues, duration } = directEvents([
      { type: 'game_over', winners: [2, 4], reason: 'turnEnd' } as never,
    ]);
    expect(of(cues, 'victory')[0]?.seats).toEqual([2, 4]);
    expect(of(cues, 'shot')[0]?.spec).toMatchObject({ type: 'orbit', seat: 2 });
    expect(duration).toBeGreaterThan(2500);
    // 無勝者（全員淘汰）仍有勝利提示但沒有環繞鏡頭
    const none = directEvents([
      { type: 'game_over', winners: [], reason: 'allEliminated' } as never,
    ]).cues;
    expect(kinds(none)).toEqual(['victory']);
  });

  it('事件太多時整體加速到上限內，但順序不變、加速有下限', () => {
    const events: GameEvent[] = [];
    for (let i = 0; i < 40; i++) {
      events.push({ type: 'smash', attacker: 0, damage: 1, targets: [1] });
      events.push({ type: 'damage_taken', seat: 1, amount: 1, hp: 9, source: 0 });
    }
    const { cues, duration } = directEvents(events);
    // 加速有下限（MIN_SPEEDUP）：極端大批事件由渲染器整批快轉，而不是把動畫壓到看不見
    expect(duration).toBeLessThan(MAX_DURATION / MIN_SPEEDUP);
    expect(duration).toBeGreaterThan(MAX_DURATION);
    const lunges = of(cues, 'lunge').map((c) => c.at);
    expect([...lunges].sort((a, b) => a - b)).toEqual(lunges);
  });

  it('powerOf / hitstopFor', () => {
    expect(powerOf(1)).toBe('light');
    expect(powerOf(3)).toBe('medium');
    expect(powerOf(5)).toBe('heavy');
    expect(hitstopFor('light')).toBeGreaterThanOrEqual(60);
    expect(hitstopFor('heavy')).toBeLessThanOrEqual(120);
  });

  describe('商店飛碟與卡牌特效', () => {
    const lookup = (id: string): CardDef | undefined =>
      id === 'quake'
        ? {
            id,
            name: '地震',
            cost: 5,
            kind: 'discard',
            text: '',
            effectId: 'instant',
            params: { ops: [{ op: 'damageAll', n: 2 }] },
          }
        : undefined;

    it('從商店買牌：飛碟登場，牌抵達買家時才演「收下」，補進的牌記在飛碟上', () => {
      const { cues, duration } = directEvents(
        [
          { type: 'card_bought', seat: 1, cardId: 'quake', cost: 5, from: null },
          { type: 'card_revealed', cardId: 'new-1' },
          { type: 'energy_gained', seat: 1, amount: 1 },
        ],
        lookup,
      );
      const [ufo] = of(cues, 'ufo');
      expect(ufo).toMatchObject({
        seat: 1,
        reason: 'buy',
        picked: 'quake',
        swept: [],
        revealed: ['new-1'],
        at: 0,
        dur: UFO_DURATION,
      });
      const [card] = of(cues, 'card');
      expect(card).toMatchObject({ mode: 'bought', cardId: 'quake', theme: 'meteor' });
      expect(card?.at).toBe(Math.round(UFO_DURATION * UFO_DELIVER_AT));
      // 後續事件不必等飛碟飛完，但要等它出場
      expect(of(cues, 'pickup')[0]?.at).toBe(UFO_HOLD);
      expect(duration).toBeGreaterThanOrEqual(UFO_DURATION);
    });

    it('清商店（花 2 能量）：飛碟帶走舊的三張牌', () => {
      const { cues } = directEvents([
        { type: 'market_swept', seat: 2, discarded: ['a', 'b', 'c'] },
        { type: 'card_revealed', cardId: 'd' },
        { type: 'card_revealed', cardId: 'e' },
        { type: 'card_revealed', cardId: 'f' },
      ]);
      expect(of(cues, 'ufo')).toEqual([
        {
          kind: 'ufo',
          at: 0,
          dur: UFO_DURATION,
          seat: 2,
          reason: 'sweep',
          picked: null,
          swept: ['a', 'b', 'c'],
          revealed: ['d', 'e', 'f'],
        },
      ]);
      expect(of(cues, 'card')).toEqual([]);
    });

    it('向別的怪獸買牌：沒有飛碟，直接收下', () => {
      const { cues } = directEvents([
        { type: 'card_bought', seat: 0, cardId: 'x', cost: 3, from: 2 },
      ]);
      expect(of(cues, 'ufo')).toEqual([]);
      expect(of(cues, 'card')[0]).toMatchObject({ mode: 'bought', theme: 'generic' });
    });

    it('使用卡牌：依卡牌內容挑主題；查不到卡牌時用通用特效', () => {
      const used = directEvents([{ type: 'card_used', seat: 3, cardId: 'quake' }], lookup).cues;
      expect(of(used, 'card')[0]).toMatchObject({ mode: 'used', seat: 3, theme: 'meteor' });
      const unknown = directEvents([{ type: 'card_used', seat: 3, cardId: '???' }]).cues;
      expect(of(unknown, 'card')[0]?.theme).toBe('generic');
    });

    it('連買兩張牌：各自一架飛碟，不會把補牌記到錯的那架', () => {
      const { cues } = directEvents([
        { type: 'card_bought', seat: 0, cardId: 'a', cost: 1, from: null },
        { type: 'card_revealed', cardId: 'n1' },
        { type: 'turn_started', seat: 1, round: 2 } as never,
        { type: 'card_bought', seat: 1, cardId: 'b', cost: 1, from: null },
        { type: 'card_revealed', cardId: 'n2' },
      ]);
      const ufos = of(cues, 'ufo');
      expect(ufos.map((u) => u.revealed)).toEqual([['n1'], ['n2']]);
      expect(ufos[1]?.at).toBeGreaterThan(ufos[0]?.at ?? 0);
    });

    it('時間太長時飛碟演出一起被壓縮', () => {
      const events: GameEvent[] = Array.from({ length: 6 }, (_, i) => ({
        type: 'card_bought',
        seat: i % 3,
        cardId: `c${String(i)}`,
        cost: 1,
        from: null,
      }));
      const { cues, duration } = directEvents(events);
      expect(duration).toBeLessThanOrEqual(MAX_DURATION + 1);
      const first = of(cues, 'ufo')[0];
      expect(first?.dur).toBeLessThan(UFO_DURATION);
      expect(first?.dur).toBeGreaterThanOrEqual(Math.round(UFO_DURATION * MIN_SPEEDUP));
    });
  });

  it('保留卡被動發動：輕量的 card 提示（mode=triggered），停留比使用短', () => {
    const { cues } = directEvents([{ type: 'card_triggered', seat: 1, cardId: 'x' }]);
    expect(of(cues, 'card')).toEqual([
      expect.objectContaining({ mode: 'triggered', seat: 1, cardId: 'x' }),
    ]);
    const three = (type: 'card_triggered' | 'card_used') =>
      directEvents([1, 2, 3].map(() => ({ type, seat: 1, cardId: 'x' }))).duration;
    expect(three('card_triggered')).toBeLessThan(three('card_used'));
  });
});
