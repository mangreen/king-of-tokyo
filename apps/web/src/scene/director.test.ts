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
} from './director.js';

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
});
