import { describe, expect, it } from 'vitest';
import { toSnapshot } from './snapshot.js';

const room = { players: [{ id: 'me', nickname: 'A', seat: 0, monster: null }] } as never;
const base = { config: { playerCount: 2 }, monsters: [] };

describe('toSnapshot 勝者', () => {
  it('遊戲進行中沒有勝者；結束後帶出勝者座位（多位也可以）', () => {
    expect(toSnapshot(room, base as never, 0, 'me').winners).toEqual([]);
    const over = { ...base, phase: 'over', outcome: { winners: [1, 0], reason: 'turnEnd' } };
    expect(toSnapshot(room, over as never, 0, 'me').winners).toEqual([1, 0]);
  });

  it('全員淘汰沒有勝者：不戴皇冠', () => {
    const draw = { ...base, phase: 'over', outcome: { winners: [], reason: 'allEliminated' } };
    expect(toSnapshot(room, draw as never, 0, 'me').winners).toEqual([]);
  });
});
