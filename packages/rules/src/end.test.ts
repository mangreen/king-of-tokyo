import { describe, expect, it } from 'vitest';
import { applyAction } from './engine.js';
import { checkInvariants } from './invariants.js';
import { pickWinners } from './outcome.js';
import { eventTypes, makeState, mon, resolveWith } from './test-utils.js';
import type { Face } from './types.js';

const A: Face = 'attack';
const BLANK: Face[] = [1, 1, 2, 2, 3, 3];

describe('R-END-01 / R-END-06 最後存活與全滅', () => {
  it('R-END-01：只剩一位怪獸時立即獲勝（不需要等回合結束）', () => {
    const s = makeState({ players: 2, monsters: { 1: { location: 'city', hp: 1 } } });
    const r = resolveWith(s, [A, 1, 1, 2, 2, 3]);
    expect(r.state.phase).toBe('over');
    expect(r.state.outcome).toEqual({ winners: [0], reason: 'lastStanding' });
    expect(r.events.at(-1)).toEqual({ type: 'game_over', winners: [0], reason: 'lastStanding' });
    expect(eventTypes(r.events)).not.toContain('turn_ended');
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('R-END-01：遊戲結束後任何動作都回 game_over', () => {
    const s = makeState({ players: 2, monsters: { 1: { location: 'city', hp: 1 } } });
    const over = resolveWith(s, [A, 1, 1, 2, 2, 3]).state;
    expect(applyAction(over, { type: 'roll', seat: 0, keep: [] })).toEqual({
      ok: false,
      error: 'game_over',
    });
    expect(applyAction(over, { type: 'yieldDecision', seat: 1, leave: true })).toEqual({
      ok: false,
      error: 'game_over',
    });
  });

  it('R-END-01：三人局打倒最後一個對手前，還有其他人存活就繼續', () => {
    const s = makeState({
      players: 3,
      monsters: { 1: { location: 'city', hp: 1 } },
    });
    const r = resolveWith(s, [A, 1, 1, 2, 2, 3]);
    expect(r.state.phase).toBe('roll'); // 2 號仍存活
  });

  it('R-END-06：全員淘汰（防禦性：直接以空候選者驗證）', () => {
    expect(pickWinners([])).toEqual([]);
  });
});

describe('R-END-02 回合結算', () => {
  it('R-END-02：自己的回合結束時 VP ≥ 20 且存活，立即獲勝（非一輪結尾）', () => {
    const s = makeState({ players: 4, turnSeat: 1, monsters: { 1: { vp: 19 } } });
    const r = resolveWith(s, [2, 2, 2, 1, 1, 3]); // +2，再進入東京 +1
    expect(mon(r.state, 1).vp).toBe(22);
    expect(r.state.outcome).toEqual({ winners: [1], reason: 'turnEnd' });
    expect(eventTypes(r.events)).toContain('turn_ended');
    expect(eventTypes(r.events)).not.toContain('round_ended');
  });

  it('R-END-02：不到 20 VP 就繼續', () => {
    const s = makeState({ players: 4, turnSeat: 1, monsters: { 1: { vp: 16 } } });
    const r = resolveWith(s, BLANK); // 只有進入東京 +1 → 17
    expect(r.state.phase).toBe('roll');
    expect(r.state.turn.seat).toBe(2);
  });

  it('R-END-02：剛好 20 VP 就算達標', () => {
    const s = makeState({ players: 4, turnSeat: 1, monsters: { 1: { vp: 19 } } });
    const r = resolveWith(s, BLANK); // 進入東京 +1 → 20
    expect(r.state.outcome?.winners).toEqual([1]);
  });

  it('R-END-02：在東京的玩家回合開始 +2 到 19，撐完自己的回合再 +2 才獲勝', () => {
    const before = makeState({
      players: 4,
      turnSeat: 0,
      monsters: { 1: { location: 'city', vp: 17 } },
    });
    const start = resolveWith(before, BLANK); // 0 結束，1 回合開始 +2 → 19
    expect(mon(start.state, 1).vp).toBe(19);
    expect(start.state.phase).toBe('roll'); // 還沒結束
    const end = resolveWith(start.state, [2, 2, 2, 1, 1, 3]); // +2 → 21
    expect(end.state.outcome).toEqual({ winners: [1], reason: 'turnEnd' });
  });
});

describe('R-END-03/04 整輪結算', () => {
  it('R-END-03：一輪最後一位的回合結束時，有人 ≥ 20 VP 就結束', () => {
    const s = makeState({
      players: 3,
      turnSeat: 2,
      monsters: { 0: { vp: 22 }, 1: { vp: 5 }, 2: { vp: 3 } },
    });
    const r = resolveWith(s, BLANK);
    expect(eventTypes(r.events)).toContain('round_ended');
    expect(r.state.outcome).toEqual({ winners: [0], reason: 'roundEnd' });
  });

  it('R-END-04：非回合玩家在中途 ≥ 20 VP 不會立即獲勝，遊戲繼續', () => {
    const s = makeState({ players: 4, turnSeat: 1, monsters: { 2: { vp: 20 } } });
    const r = resolveWith(s, BLANK);
    expect(r.state.phase).toBe('roll');
    expect(r.state.turn.seat).toBe(2);
  });

  it('R-END-04：輪到那位玩家、他的回合結束時（不是一輪結尾）才獲勝', () => {
    const s = makeState({ players: 4, turnSeat: 1, monsters: { 2: { vp: 20 } } });
    const r1 = resolveWith(s, BLANK);
    const r2 = resolveWith(r1.state, BLANK);
    expect(r2.state.outcome).toEqual({ winners: [2], reason: 'turnEnd' });
  });

  it('R-END-04：非回合玩家 ≥ 20，但在他之前的一輪結尾先到 → 以整輪結算為準', () => {
    // 4 人，先手 0：座位 3 是一輪的最後一位。2 已有 22 VP，輪到 3 結束時整輪結算。
    const s = makeState({
      players: 4,
      turnSeat: 3,
      monsters: { 2: { vp: 22 }, 3: { vp: 4 } },
    });
    const r = resolveWith(s, BLANK);
    expect(r.state.outcome).toEqual({ winners: [2], reason: 'roundEnd' });
  });

  it('R-END-04：同一回合同時是一輪結尾時，先套整輪結算，VP 更高的非回合玩家勝出', () => {
    const s = makeState({
      players: 3,
      turnSeat: 2,
      monsters: { 0: { vp: 25 }, 2: { vp: 19 } }, // 2 結算後 20（進入東京 +1）
    });
    const r = resolveWith(s, BLANK);
    expect(mon(r.state, 2).vp).toBe(20);
    expect(r.state.outcome).toEqual({ winners: [0], reason: 'roundEnd' });
  });

  it('R-END-07：VP 相同時比剩餘 HP', () => {
    const s = makeState({
      players: 3,
      turnSeat: 2,
      monsters: { 0: { vp: 21, hp: 5 }, 1: { vp: 21, hp: 7 } },
    });
    expect(resolveWith(s, BLANK).state.outcome?.winners).toEqual([1]);
  });

  it('R-END-07：VP、HP 都相同時比能量', () => {
    const s = makeState({
      players: 3,
      turnSeat: 2,
      monsters: { 0: { vp: 21, hp: 7, energy: 4 }, 1: { vp: 21, hp: 7, energy: 2 } },
    });
    expect(resolveWith(s, BLANK).state.outcome?.winners).toEqual([0]);
  });

  it('R-END-07：再相同時比 Keep 卡張數', () => {
    const s = makeState({
      players: 3,
      turnSeat: 2,
      monsters: {
        0: { vp: 21, hp: 7, energy: 2, cards: ['a'] },
        1: { vp: 21, hp: 7, energy: 2, cards: ['a', 'b'] },
      },
    });
    expect(resolveWith(s, BLANK).state.outcome?.winners).toEqual([1]);
  });

  it('R-END-07：比到沒東西可比仍相同才並列（多勝者）', () => {
    const s = makeState({
      players: 3,
      turnSeat: 2,
      monsters: { 0: { vp: 21, hp: 7, energy: 2 }, 1: { vp: 21, hp: 7, energy: 2 } },
    });
    const r = resolveWith(s, BLANK);
    expect(r.state.outcome).toEqual({ winners: [0, 1], reason: 'roundEnd' });
    expect(r.events.at(-1)).toEqual({ type: 'game_over', winners: [0, 1], reason: 'roundEnd' });
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('R-END-07：VP 較低（但 ≥ 20）的怪獸不能靠 HP 反超', () => {
    const s = makeState({
      players: 3,
      turnSeat: 2,
      monsters: { 0: { vp: 22, hp: 1 }, 1: { vp: 20, hp: 10 } },
    });
    expect(resolveWith(s, BLANK).state.outcome?.winners).toEqual([0]);
  });

  it('R-END-07：只有存活的怪獸參與比較（淘汰者不算）', () => {
    const s = makeState({
      players: 4,
      turnSeat: 3,
      monsters: { 0: { vp: 30, hp: 0, alive: false }, 1: { vp: 21 } },
    });
    expect(resolveWith(s, BLANK).state.outcome?.winners).toEqual([1]);
  });

  it('pickWinners：多位候選者的排序鍵為 VP → HP → 能量 → 卡數', () => {
    const base = { maxHp: 10, alive: true, location: null } as const;
    const mk = (seat: number, vp: number, hp: number, energy: number, cards: number) => ({
      ...base,
      seat,
      vp,
      hp,
      energy,
      cards: Array.from({ length: cards }, (_, i) => String(i)),
    });
    expect(pickWinners([mk(0, 20, 5, 5, 5), mk(1, 21, 1, 0, 0)])).toEqual([1]);
    expect(pickWinners([mk(0, 20, 5, 5, 5), mk(1, 20, 6, 0, 0)])).toEqual([1]);
    expect(pickWinners([mk(0, 20, 5, 6, 0), mk(1, 20, 5, 5, 9)])).toEqual([0]);
    expect(pickWinners([mk(2, 20, 5, 5, 1), mk(0, 20, 5, 5, 1), mk(1, 20, 5, 5, 0)])).toEqual([
      0, 2,
    ]);
  });
});

describe('R-END-08 一輪的邊界', () => {
  it('一輪結束時 round +1，並輸出 round_ended', () => {
    const s = makeState({ players: 3, turnSeat: 2, round: 4 });
    const r = resolveWith(s, BLANK);
    expect(r.state.round).toBe(5);
    expect(r.state.turn.seat).toBe(0);
    expect(r.events).toContainEqual({ type: 'round_ended', round: 4 });
    expect(r.events).toContainEqual({ type: 'turn_started', seat: 0, round: 5 });
  });

  it('輪中途 round 不變', () => {
    const r = resolveWith(makeState({ players: 3, turnSeat: 0, round: 4 }), BLANK);
    expect(r.state.round).toBe(4);
    expect(eventTypes(r.events)).not.toContain('round_ended');
  });

  it('先手不是座位 0 時，邊界在先手之前一位', () => {
    // 4 人，先手 2 → 順序 2,3,0,1；1 是最後一位
    const mid = resolveWith(makeState({ players: 4, firstSeat: 2, turnSeat: 0 }), BLANK);
    expect(mid.state.round).toBe(1);
    const end = resolveWith(makeState({ players: 4, firstSeat: 2, turnSeat: 1 }), BLANK);
    expect(end.state.round).toBe(2);
    expect(end.state.turn.seat).toBe(2);
  });

  it('座位被淘汰後被跳過，但邊界不變（最後一位淘汰時，前一位成為結尾）', () => {
    // 4 人，先手 0；3 已淘汰 → 2 的回合結束後就是一輪結束
    const s = makeState({ players: 4, turnSeat: 2, monsters: { 3: { alive: false, hp: 0 } } });
    const r = resolveWith(s, BLANK);
    expect(r.state.round).toBe(2);
    expect(r.state.turn.seat).toBe(0);
  });

  it('先手本人被淘汰後，邊界仍以先手的位置計算', () => {
    // 4 人，先手 1（順序 1,2,3,0）且 1 已淘汰；0 是最後一位 → 0 結束時一輪結束
    const s = makeState({
      players: 4,
      firstSeat: 1,
      turnSeat: 0,
      monsters: { 1: { alive: false, hp: 0 } },
    });
    const r = resolveWith(s, BLANK);
    expect(r.state.round).toBe(2);
    expect(r.state.turn.seat).toBe(2);
  });

  it('R-END-08：一輪結束時只有存活怪獸參與整輪結算', () => {
    const s = makeState({
      players: 4,
      turnSeat: 2,
      monsters: { 3: { alive: false, hp: 0, vp: 25 }, 0: { vp: 21 } },
    });
    const r = resolveWith(s, BLANK);
    expect(r.state.outcome).toEqual({ winners: [0], reason: 'roundEnd' });
  });
});
