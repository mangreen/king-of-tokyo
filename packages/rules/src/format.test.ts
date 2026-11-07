import { describe, expect, it } from 'vitest';
import { describeEvent } from './format.js';
import { createGame, defaultConfig } from './state.js';
import { makeState, resolveWith } from './test-utils.js';

describe('describeEvent', () => {
  it('預設以座位編號稱呼，可改用暱稱', () => {
    const { events } = createGame(defaultConfig(3), 4);
    const turn = events[1];
    if (turn?.type !== 'turn_started') throw new Error('應為 turn_started');
    expect(describeEvent(turn)).toContain(`座位 ${String(turn.seat)}`);
    expect(describeEvent(turn, () => 'Mang')).toContain('Mang');
  });

  it('每一種事件都能產生文字（turn_ended 以外不為空）', () => {
    const state = makeState({
      players: 5,
      monsters: { 1: { location: 'city', hp: 2 }, 2: { location: 'bay' }, 3: { hp: 1 } },
    });
    const r = resolveWith(state, ['attack', 'attack', 'energy', 'heal', 2, 2]);
    expect(r.events.length).toBeGreaterThan(3);
    for (const e of r.events) {
      const text = describeEvent(e, (seat) => `玩家${String(seat)}`);
      if (e.type === 'turn_ended') expect(text).toBe('');
      else expect(text).not.toBe('');
      expect(text).not.toMatch(/undefined|\[object/);
    }
  });

  it('遊戲結束顯示勝者暱稱', () => {
    const text = describeEvent(
      { type: 'game_over', winners: [0, 2], reason: 'roundEnd' },
      (s) => `P${String(s)}`,
    );
    expect(text).toContain('P0、P2');
  });
});
