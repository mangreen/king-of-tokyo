import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@kot/rules';
import { directEvents } from './director.js';
import { Holds, holdKindsOf } from './holds.js';

describe('Holds', () => {
  const events: GameEvent[] = [
    { type: 'smash', attacker: 1, damage: 2, targets: [0] },
    { type: 'damage_taken', seat: 0, amount: 2, hp: 3, source: 1 },
    { type: 'yielded', seat: 0, location: 'city' },
    { type: 'entered_tokyo', seat: 1, location: 'city' },
    { type: 'eliminated', seat: 2, by: 1 },
  ];

  it('登記後各座位的受傷／淘汰／移動被擋住，cue 播出後逐一放行', () => {
    const { cues } = directEvents(events);
    const h = new Holds();
    h.add(cues);
    expect(h.held(0, 'hit')).toBe(true);
    expect(h.held(0, 'move')).toBe(true);
    expect(h.held(1, 'move')).toBe(true);
    expect(h.held(2, 'ko')).toBe(true);
    expect(h.held(1, 'hit')).toBe(false);

    for (const c of cues) h.release(c);
    for (const seat of [0, 1, 2]) {
      expect(h.held(seat, 'hit') || h.held(seat, 'ko') || h.held(seat, 'move')).toBe(false);
    }
  });

  it('多個同類 cue 要全部播完才放行；多釋放不會變負', () => {
    const { cues } = directEvents([
      { type: 'damage_taken', seat: 0, amount: 1, hp: 4, source: null, cause: 'poison' },
      { type: 'damage_taken', seat: 0, amount: 1, hp: 3, source: null, cause: 'poison' },
    ]);
    const hits = cues.filter((c) => c.kind === 'hit');
    const h = new Holds();
    h.add(cues);
    h.release(hits[0]!);
    expect(h.held(0, 'hit')).toBe(true);
    h.release(hits[1]!);
    expect(h.held(0, 'hit')).toBe(false);
    h.release(hits[1]!);
    expect(h.held(0, 'hit')).toBe(false);
  });

  it('淘汰同時保留移動（倒下前不跳回環形座位），放行後兩者一起解除', () => {
    const { cues } = directEvents([
      { type: 'yielded', seat: 2, location: 'city' },
      { type: 'eliminated', seat: 2, by: 1 },
    ]);
    const h = new Holds();
    h.add(cues);
    expect(h.held(2, 'ko')).toBe(true);
    expect(h.held(2, 'move')).toBe(true);
    const ko = cues.find((c) => c.kind === 'ko');
    h.release(ko!);
    // 還有一個 leave cue 保留 move；ko cue 只放行自己那份
    for (const c of cues) if (c !== ko) h.release(c);
    for (const kind of ['hit', 'ko', 'move'] as const) expect(h.held(2, kind)).toBe(false);
  });

  it('一批事件全部放行後，所有座位的所有 hold 歸零', () => {
    const { cues } = directEvents(events);
    const h = new Holds();
    h.add(cues);
    for (const c of cues) h.release(c);
    for (let seat = 0; seat < 6; seat++)
      for (const kind of ['hit', 'ko', 'move'] as const) expect(h.held(seat, kind)).toBe(false);
  });

  it('不相關的 cue 不產生 hold', () => {
    expect(holdKindsOf({ kind: 'focus', at: 0, seat: 1 })).toBeNull();
    expect(new Holds().release({ kind: 'hitstop', at: 0, dur: 60 })).toBeNull();
  });
});
