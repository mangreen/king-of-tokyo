import { describe, expect, it } from 'vitest';
import { applyAction } from './engine.js';
import { currentActor, legalActions } from './legal.js';
import { createGame, defaultConfig } from './state.js';
import { eventTypes, makeState, mon, must, resolveWith, withDice } from './test-utils.js';
import type { Face, GameState } from './types.js';

const A: Face = 'attack';
const E: Face = 'energy';
const H: Face = 'heal';
/** 沒有任何效果的骰面組合（無三顆相同、無能量／攻擊／治療）。 */
const BLANK: Face[] = [1, 1, 2, 2, 3, 3];

describe('R-DICE-01/02 擲骰與重擲', () => {
  it('首擲擲全部 6 顆，之後 rollsUsed = 1', () => {
    const s = makeState({ players: 3 });
    const { state, events } = must(s, { type: 'roll', seat: 0, keep: [] });
    expect(state.turn.dice).toHaveLength(6);
    expect(state.turn.rollsUsed).toBe(1);
    expect(events[0]).toMatchObject({
      type: 'dice_rolled',
      rollNumber: 1,
      rerolled: [0, 1, 2, 3, 4, 5],
    });
  });

  it('重擲只改變沒保留的骰子，保留的不變', () => {
    const first = must(makeState({ players: 3 }), { type: 'roll', seat: 0, keep: [] }).state;
    const second = must(first, { type: 'roll', seat: 0, keep: [0, 2, 4] });
    for (const i of [0, 2, 4]) {
      expect(second.state.turn.dice[i]).toBe(first.turn.dice[i]);
    }
    const event = second.events[0];
    expect(event).toMatchObject({ type: 'dice_rolled', rollNumber: 2, rerolled: [1, 3, 5] });
  });

  it('R-DICE-02：上一次保留的骰子可以在下一次重擲（keep 不累積）', () => {
    const s0 = makeState({ players: 3 });
    const s1 = must(s0, { type: 'roll', seat: 0, keep: [] }).state;
    const s2 = must(s1, { type: 'roll', seat: 0, keep: [0, 1, 2, 3, 4] }).state; // 只擲第 5 顆
    const s3 = must(s2, { type: 'roll', seat: 0, keep: [] }); // 全部重擲
    expect((s3.events[0] as { rerolled: number[] }).rerolled).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('用完 3 次擲骰會自動結算，不需要再按結束', () => {
    let s: GameState = makeState({ players: 3 });
    s = must(s, { type: 'roll', seat: 0, keep: [] }).state;
    s = must(s, { type: 'roll', seat: 0, keep: [] }).state;
    const last = must(s, { type: 'roll', seat: 0, keep: [] });
    expect(eventTypes(last.events)).toContain('rolling_ended');
    expect(eventTypes(last.events)).toContain('turn_ended');
  });

  it('可以在第一次擲骰後就停止（R-DICE-01 可隨時停止）', () => {
    const s = must(makeState({ players: 3 }), { type: 'roll', seat: 0, keep: [] }).state;
    const r = must(s, { type: 'endRolling', seat: 0 });
    expect(eventTypes(r.events)).toContain('rolling_ended');
  });

  it('還沒擲就結束 → roll_first', () => {
    expect(applyAction(makeState({ players: 3 }), { type: 'endRolling', seat: 0 })).toEqual({
      ok: false,
      error: 'roll_first',
    });
  });

  it('首擲帶 keep → invalid_keep', () => {
    expect(applyAction(makeState({ players: 3 }), { type: 'roll', seat: 0, keep: [0] })).toEqual({
      ok: false,
      error: 'invalid_keep',
    });
  });

  it.each([
    ['索引超出範圍', [6]],
    ['負數索引', [-1]],
    ['小數索引', [1.5]],
    ['重複索引', [1, 1]],
    ['全部保留（沒有要擲的骰子）', [0, 1, 2, 3, 4, 5]],
  ])('重擲的 keep 不合法：%s → invalid_keep', (_name, keep) => {
    const s = withDice(makeState({ players: 3 }), BLANK);
    expect(applyAction(s, { type: 'roll', seat: 0, keep })).toEqual({
      ok: false,
      error: 'invalid_keep',
    });
  });

  it('已用完擲骰次數 → no_rolls_left', () => {
    const s = withDice(makeState({ players: 3 }), BLANK);
    s.turn.rollsUsed = 3;
    expect(applyAction(s, { type: 'roll', seat: 0, keep: [0] })).toEqual({
      ok: false,
      error: 'no_rolls_left',
    });
  });

  it('不是你的回合 → not_your_turn', () => {
    expect(applyAction(makeState({ players: 3 }), { type: 'roll', seat: 1, keep: [] })).toEqual({
      ok: false,
      error: 'not_your_turn',
    });
    expect(applyAction(makeState({ players: 3 }), { type: 'endRolling', seat: 2 })).toEqual({
      ok: false,
      error: 'not_your_turn',
    });
  });

  it('擲骰階段收到讓位決定 → wrong_phase', () => {
    expect(
      applyAction(makeState({ players: 3 }), { type: 'yieldDecision', seat: 0, leave: true }),
    ).toEqual({
      ok: false,
      error: 'wrong_phase',
    });
  });

  it('不合法的動作不會改變傳入的狀態', () => {
    const s = makeState({ players: 3 });
    const before = JSON.stringify(s);
    applyAction(s, { type: 'roll', seat: 1, keep: [] });
    applyAction(s, { type: 'roll', seat: 0, keep: [3] });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('合法動作也不會修改傳入的狀態（純函式）', () => {
    const s = makeState({ players: 3 });
    const before = JSON.stringify(s);
    must(s, { type: 'roll', seat: 0, keep: [] });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('R-DICE-05 / R-DICE-06 結算', () => {
  it('R-DICE-05：每個能量面得 1 能量，且能量跨回合保留', () => {
    const s = makeState({ players: 3, monsters: { 0: { energy: 2 } } });
    const r = resolveWith(s, [E, E, E, 1, 1, 2]);
    expect(mon(r.state, 0).energy).toBe(5);
    expect(r.events).toContainEqual({ type: 'energy_gained', seat: 0, amount: 3 });
  });

  it('R-DICE-06：結算事件依 VP → 能量 → 治療 → 攻擊 的順序輸出', () => {
    const s = makeState({ players: 3, monsters: { 0: { hp: 5 }, 1: { location: 'city' } } });
    const r = resolveWith(s, [A, H, E, 2, 2, 2]);
    const order = eventTypes(r.events).filter((t) =>
      ['vp_gained', 'energy_gained', 'healed', 'smash'].includes(t),
    );
    expect(order).toEqual(['vp_gained', 'energy_gained', 'healed', 'smash']);
  });

  it('R-DICE-04：數字面得到的 VP 加進怪獸', () => {
    const r = resolveWith(makeState({ players: 3 }), [3, 3, 3, 3, 1, 2]);
    // 三顆 3 = 3 VP，第四顆 +1，另外進入東京 +1
    expect(mon(r.state, 0).vp).toBe(5);
  });
});

describe('R-HEAL 治療', () => {
  it('R-HEAL-01：在東京外每個治療面回 1 HP', () => {
    const r = resolveWith(makeState({ players: 3, monsters: { 0: { hp: 4 } } }), [
      H,
      H,
      1,
      1,
      2,
      2,
    ]);
    expect(mon(r.state, 0).hp).toBe(6);
    expect(r.events).toContainEqual({ type: 'healed', seat: 0, amount: 2 });
  });

  it('R-HEAL-01：HP 不會超過上限 10', () => {
    const r = resolveWith(makeState({ players: 3, monsters: { 0: { hp: 9 } } }), [
      H,
      H,
      H,
      1,
      1,
      2,
    ]);
    expect(mon(r.state, 0).hp).toBe(10);
    expect(r.events).toContainEqual({ type: 'healed', seat: 0, amount: 1 });
  });

  it('R-HEAL-01：HP 已滿時沒有治療事件', () => {
    const r = resolveWith(makeState({ players: 3 }), [H, H, 1, 1, 2, 2]);
    expect(eventTypes(r.events)).not.toContain('healed');
  });

  it('R-HEAL-02：在東京內，治療面無效', () => {
    const s = makeState({ players: 3, monsters: { 0: { hp: 4, location: 'city' } } });
    const r = resolveWith(s, [H, H, 1, 1, 2, 2]);
    expect(mon(r.state, 0).hp).toBe(4);
    expect(r.events).toContainEqual({ type: 'heal_ignored', seat: 0, faces: 2 });
  });

  it('R-HEAL-02：東京灣同樣無法用骰子治療', () => {
    const s = makeState({
      players: 5,
      monsters: { 1: { location: 'city' }, 0: { hp: 4, location: 'bay' } },
    });
    const r = resolveWith(s, [H, 1, 1, 2, 2, 3]);
    expect(mon(r.state, 0).hp).toBe(4);
  });
});

describe('R-TURN 回合順序與 R-TURN-02 東京起始加分', () => {
  it('回合順時針推進到下一位存活的玩家', () => {
    const r = resolveWith(makeState({ players: 4 }), BLANK);
    expect(r.state.turn.seat).toBe(1);
    expect(r.state.turn).toMatchObject({ rollsUsed: 0, dice: [] });
    expect(r.state.phase).toBe('roll');
  });

  it('座位編號會繞回 0', () => {
    const s = makeState({ players: 3, firstSeat: 2, turnSeat: 2 });
    expect(resolveWith(s, BLANK).state.turn.seat).toBe(0);
  });

  it('被淘汰的座位會被跳過', () => {
    const s = makeState({ players: 4, monsters: { 1: { alive: false, hp: 0 } } });
    expect(resolveWith(s, BLANK).state.turn.seat).toBe(2);
  });

  it('R-TURN-02：回合開始時在東京內獲得 2 VP', () => {
    const s = makeState({ players: 4, monsters: { 1: { location: 'city', vp: 3 } } });
    const r = resolveWith(s, BLANK);
    expect(mon(r.state, 1).vp).toBe(5);
    expect(r.events).toContainEqual({
      type: 'vp_gained',
      seat: 1,
      amount: 2,
      reason: 'tokyo_start',
    });
  });

  it('R-TURN-02：東京灣的怪獸同樣在回合開始得 2 VP', () => {
    const s = makeState({
      players: 5,
      monsters: { 1: { location: 'bay' }, 3: { location: 'city' } },
    });
    const r = resolveWith(s, BLANK);
    expect(mon(r.state, 1).vp).toBe(2);
  });

  it('在東京外的怪獸回合開始沒有加分', () => {
    const r = resolveWith(makeState({ players: 4, monsters: { 2: { location: 'city' } } }), BLANK);
    expect(mon(r.state, 1).vp).toBe(0);
  });
});

describe('動作資訊', () => {
  it('currentActor 在擲骰、讓位、結束階段回傳對的人', () => {
    const s = makeState({ players: 4, monsters: { 2: { location: 'city' } } });
    expect(currentActor(s)).toBe(0);
    const yielding = resolveWith(s, [A, 1, 1, 2, 2, 3]).state;
    expect(yielding.phase).toBe('prompt');
    expect(yielding.pending?.kind).toBe('yield');
    expect(currentActor(yielding)).toBe(2);
  });

  it('首擲只有一個合法動作；之後有結束與 63 種重擲組合', () => {
    const s = makeState({ players: 3 });
    expect(legalActions(s)).toEqual([{ type: 'roll', seat: 0, keep: [] }]);
    const after = must(s, { type: 'roll', seat: 0, keep: [] }).state;
    const actions = legalActions(after);
    expect(actions).toHaveLength(1 + 63);
    for (const action of actions) {
      expect(applyAction(after, action).ok).toBe(true);
    }
  });

  it('createGame 之後第一位玩家就能擲骰', () => {
    const { state } = createGame(defaultConfig(3), 11);
    expect(legalActions(state)).toEqual([{ type: 'roll', seat: state.firstSeat, keep: [] }]);
  });
});
