import { describe, expect, it } from 'vitest';
import { applyAction } from './engine.js';
import { checkInvariants } from './invariants.js';
import { eventTypes, makeState, mon, must, resolveWith } from './test-utils.js';
import type { Face } from './types.js';

const A: Face = 'attack';
const BLANK: Face[] = [1, 1, 2, 2, 3, 3];
/** n 個攻擊面，其餘填無效果的面。 */
function attacks(n: number): Face[] {
  const filler: Face[] = [1, 1, 2, 2, 3, 3];
  return [...Array.from({ length: n }, () => A), ...filler.slice(0, 6 - n)];
}

describe('R-SMASH 攻擊', () => {
  it('R-SMASH-02：在東京外攻擊，東京內的怪獸各失去攻擊面數的 HP，其他人不受影響', () => {
    const s = makeState({ players: 4, monsters: { 1: { location: 'city' } } });
    const r = resolveWith(s, attacks(2));
    expect(mon(r.state, 1).hp).toBe(8);
    expect(mon(r.state, 2).hp).toBe(10);
    expect(mon(r.state, 3).hp).toBe(10);
    expect(mon(r.state, 0).hp).toBe(10);
    expect(r.events).toContainEqual({ type: 'smash', attacker: 0, damage: 2, targets: [1] });
    expect(r.events).toContainEqual({ type: 'damage_taken', seat: 1, amount: 2, hp: 8, source: 0 });
  });

  it('R-SMASH-01：在東京內攻擊，所有東京外的怪獸受傷，且不能讓位', () => {
    const s = makeState({ players: 4, monsters: { 0: { location: 'city' } } });
    const r = resolveWith(s, attacks(3));
    expect([1, 2, 3].map((seat) => mon(r.state, seat).hp)).toEqual([7, 7, 7]);
    expect(mon(r.state, 0).hp).toBe(10);
    expect(r.state.phase).toBe('roll'); // 沒有讓位階段
    expect(eventTypes(r.events)).not.toContain('yield_requested');
    expect(r.state.turn.seat).toBe(1);
  });

  it('R-SMASH-03：東京市與東京灣的怪獸不會互相攻擊', () => {
    const s = makeState({
      players: 5,
      monsters: { 0: { location: 'city' }, 3: { location: 'bay' } },
    });
    const r = resolveWith(s, attacks(2));
    expect(mon(r.state, 3).hp).toBe(10);
    expect(mon(r.state, 1).hp).toBe(8);
    expect(mon(r.state, 2).hp).toBe(8);
    expect(mon(r.state, 4).hp).toBe(8);
  });

  it('R-SMASH-02：東京市與東京灣的怪獸同時受傷', () => {
    const s = makeState({
      players: 5,
      monsters: { 2: { location: 'city' }, 4: { location: 'bay' } },
    });
    const r = resolveWith(s, attacks(1));
    expect(mon(r.state, 2).hp).toBe(9);
    expect(mon(r.state, 4).hp).toBe(9);
  });

  it('R-SMASH-06：東京沒人時，東京外的攻擊沒有傷害也不算攻擊', () => {
    const r = resolveWith(makeState({ players: 3 }), attacks(4));
    expect(eventTypes(r.events)).not.toContain('smash');
    expect(r.state.monsters.every((m) => m.hp === 10)).toBe(true);
    // 沒有人讓位的問題，直接進入東京
    expect(mon(r.state, 0).location).toBe('city');
  });

  it('R-SMASH-04：HP 歸零即淘汰，能量與 Keep 卡被捨棄，離開東京', () => {
    const s = makeState({
      players: 4,
      monsters: { 1: { location: 'city', hp: 2, energy: 5, cards: ['x', 'y'] } },
    });
    const r = resolveWith(s, attacks(3));
    const dead = mon(r.state, 1);
    expect(dead).toMatchObject({ alive: false, hp: 0, energy: 0, cards: [], location: null });
    expect(r.events).toContainEqual({ type: 'damage_taken', seat: 1, amount: 2, hp: 0, source: 0 }); // 實際扣的是剩餘 HP
    expect(r.events).toContainEqual({ type: 'eliminated', seat: 1, by: 0 });
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('R-SMASH-04：攻擊者不會傷到自己', () => {
    const s = makeState({ players: 3, monsters: { 0: { location: 'city', hp: 1 } } });
    const r = resolveWith(s, attacks(6));
    expect(mon(r.state, 0).hp).toBe(1);
  });
});

describe('R-TOKYO 進入與離開東京', () => {
  it('R-TOKYO-01/03：東京沒人時，東京外的玩家必須進入東京市並得 1 VP', () => {
    const r = resolveWith(makeState({ players: 3 }), BLANK);
    expect(mon(r.state, 0)).toMatchObject({ location: 'city', vp: 1 });
    expect(r.events).toContainEqual({ type: 'entered_tokyo', seat: 0, location: 'city' });
    expect(r.events).toContainEqual({
      type: 'vp_gained',
      seat: 0,
      amount: 1,
      reason: 'enter_tokyo',
    });
  });

  it('R-TOKYO-01：不需要攻擊也要進入（回合骰面沒有攻擊）', () => {
    const r = resolveWith(makeState({ players: 2 }), BLANK);
    expect(mon(r.state, 0).location).toBe('city');
  });

  it('已在東京的怪獸不會再次進入或重複得分', () => {
    const s = makeState({ players: 3, monsters: { 0: { location: 'city', vp: 4 } } });
    const r = resolveWith(s, BLANK);
    expect(mon(r.state, 0).vp).toBe(4);
    expect(eventTypes(r.events)).not.toContain('entered_tokyo');
  });

  it('R-TOKYO-02：5–6 人時東京市有人、東京灣沒人，必須進入東京灣', () => {
    const s = makeState({ players: 5, monsters: { 3: { location: 'city' } } });
    const r = resolveWith(s, BLANK);
    expect(mon(r.state, 0)).toMatchObject({ location: 'bay', vp: 1 });
  });

  it('R-TOKYO-02：4 人以下，東京市有人時不會進入東京（沒有東京灣）', () => {
    const s = makeState({ players: 4, monsters: { 3: { location: 'city' } } });
    const r = resolveWith(s, BLANK);
    expect(mon(r.state, 0)).toMatchObject({ location: null, vp: 0 });
  });

  it('R-TOKYO-02：東京市與東京灣都有人時，不會進入東京', () => {
    const s = makeState({
      players: 5,
      monsters: { 3: { location: 'city' }, 4: { location: 'bay' } },
    });
    const r = resolveWith(s, BLANK);
    expect(mon(r.state, 0).location).toBe(null);
  });

  it('R-TOKYO-08：一位怪獸不能同時佔東京市與東京灣', () => {
    const s = makeState({ players: 5, monsters: { 1: { location: 'city' } } });
    const r = resolveWith(s, BLANK);
    const locations = r.state.monsters.map((m) => m.location).filter((l) => l !== null);
    expect(new Set(locations).size).toBe(locations.length);
    expect(checkInvariants(r.state)).toEqual([]);
  });
});

describe('R-TOKYO-04/05/06/07 讓位', () => {
  const cityOccupied = () => makeState({ players: 4, monsters: { 2: { location: 'city' } } });

  it('R-TOKYO-04：被攻擊後進入讓位階段，由東京內的怪獸決定', () => {
    const r = resolveWith(cityOccupied(), attacks(1));
    expect(r.state.phase).toBe('yield');
    expect(r.state.pending).toEqual({ attacker: 0, queue: [2] });
    expect(r.events).toContainEqual({ type: 'yield_requested', seat: 2, attacker: 0 });
    expect(mon(r.state, 2).hp).toBe(9);
    // 攻擊者還沒進入東京，回合也還沒結束
    expect(mon(r.state, 0).location).toBe(null);
    expect(r.state.turn.seat).toBe(0);
  });

  it('R-TOKYO-04：讓位的怪獸仍然承受該次傷害，攻擊者移入並得 1 VP', () => {
    const r1 = resolveWith(cityOccupied(), attacks(2));
    const r2 = must(r1.state, { type: 'yieldDecision', seat: 2, leave: true });
    expect(mon(r2.state, 2)).toMatchObject({ hp: 8, location: null });
    expect(mon(r2.state, 0)).toMatchObject({ location: 'city', vp: 1 });
    expect(r2.events).toContainEqual({ type: 'yielded', seat: 2, location: 'city' });
    expect(r2.state.turn.seat).toBe(1); // 回合結束
    expect(r2.state.phase).toBe('roll');
  });

  it('R-TOKYO-04：不讓位則留在東京，攻擊者留在東京外（4 人沒有東京灣）', () => {
    const r1 = resolveWith(cityOccupied(), attacks(1));
    const r2 = must(r1.state, { type: 'yieldDecision', seat: 2, leave: false });
    expect(mon(r2.state, 2).location).toBe('city');
    expect(mon(r2.state, 0)).toMatchObject({ location: null, vp: 0 });
    expect(r2.events).toContainEqual({ type: 'stayed', seat: 2 });
  });

  it('R-TOKYO-05：沒有被攻擊（沒人在東京）就不會有讓位階段', () => {
    const r = resolveWith(makeState({ players: 4 }), attacks(2));
    expect(r.state.phase).toBe('roll');
  });

  it('讓位階段只接受輪到的怪獸，其他人 → not_your_turn；擲骰動作 → wrong_phase', () => {
    const { state } = resolveWith(cityOccupied(), attacks(1));
    expect(applyAction(state, { type: 'yieldDecision', seat: 1, leave: true })).toEqual({
      ok: false,
      error: 'not_your_turn',
    });
    expect(applyAction(state, { type: 'yieldDecision', seat: 0, leave: true })).toEqual({
      ok: false,
      error: 'not_your_turn',
    });
    expect(applyAction(state, { type: 'roll', seat: 0, keep: [] })).toEqual({
      ok: false,
      error: 'wrong_phase',
    });
    expect(applyAction(state, { type: 'endRolling', seat: 0 })).toEqual({
      ok: false,
      error: 'wrong_phase',
    });
  });

  it('R-TOKYO-04：從攻擊者的下一位開始順時針詢問（含座位繞回）', () => {
    // 5 人，攻擊者 3；東京灣是 0、東京市是 1 → 順序 4,0,1 → 詢問 0 再 1
    const s = makeState({
      players: 5,
      firstSeat: 3,
      monsters: { 0: { location: 'bay' }, 1: { location: 'city' } },
    });
    const r1 = resolveWith(s, attacks(1));
    expect(r1.state.pending).toEqual({ attacker: 3, queue: [0, 1] });
    const r2 = must(r1.state, { type: 'yieldDecision', seat: 0, leave: false });
    expect(r2.events).toContainEqual({ type: 'yield_requested', seat: 1, attacker: 3 });
    expect(r2.state.pending?.queue).toEqual([1]);
  });

  it('R-TOKYO-06：兩位都讓位，攻擊者進入東京市，東京灣暫時空著', () => {
    const s = makeState({
      players: 5,
      monsters: { 1: { location: 'city' }, 2: { location: 'bay' } },
    });
    let st = resolveWith(s, attacks(1)).state;
    st = must(st, { type: 'yieldDecision', seat: 1, leave: true }).state;
    st = must(st, { type: 'yieldDecision', seat: 2, leave: true }).state;
    expect(mon(st, 0)).toMatchObject({ location: 'city', vp: 1 });
    expect(mon(st, 1).location).toBe(null);
    expect(mon(st, 2).location).toBe(null);
    expect(checkInvariants(st)).toEqual([]);
  });

  it('R-TOKYO-06：只有東京市的讓位，攻擊者進入東京市', () => {
    const s = makeState({
      players: 5,
      monsters: { 1: { location: 'city' }, 2: { location: 'bay' } },
    });
    let st = resolveWith(s, attacks(1)).state;
    st = must(st, { type: 'yieldDecision', seat: 1, leave: true }).state;
    st = must(st, { type: 'yieldDecision', seat: 2, leave: false }).state;
    expect(mon(st, 0).location).toBe('city');
    expect(mon(st, 2).location).toBe('bay');
  });

  it('R-TOKYO-06：只有東京灣的讓位，攻擊者進入東京灣', () => {
    const s = makeState({
      players: 5,
      monsters: { 1: { location: 'city' }, 2: { location: 'bay' } },
    });
    let st = resolveWith(s, attacks(1)).state;
    st = must(st, { type: 'yieldDecision', seat: 1, leave: false }).state;
    st = must(st, { type: 'yieldDecision', seat: 2, leave: true }).state;
    expect(mon(st, 0).location).toBe('bay');
    expect(mon(st, 1).location).toBe('city');
  });

  it('R-TOKYO-06：兩位都不讓位，攻擊者留在東京外', () => {
    const s = makeState({
      players: 5,
      monsters: { 1: { location: 'city' }, 2: { location: 'bay' } },
    });
    let st = resolveWith(s, attacks(1)).state;
    st = must(st, { type: 'yieldDecision', seat: 1, leave: false }).state;
    st = must(st, { type: 'yieldDecision', seat: 2, leave: false }).state;
    expect(mon(st, 0).location).toBe(null);
  });

  it('R-TOKYO-07：東京市的怪獸被攻擊淘汰，攻擊者自動移入', () => {
    const s = makeState({ players: 4, monsters: { 2: { location: 'city', hp: 1 } } });
    const r = resolveWith(s, attacks(2));
    expect(r.state.phase).toBe('roll'); // 不需要讓位決定
    expect(mon(r.state, 2).alive).toBe(false);
    expect(mon(r.state, 0)).toMatchObject({ location: 'city', vp: 1 });
  });

  it('被淘汰的怪獸不會被詢問讓位，只問存活的', () => {
    const s = makeState({
      players: 5,
      monsters: { 1: { location: 'city', hp: 1 }, 2: { location: 'bay' } },
    });
    const r = resolveWith(s, attacks(1));
    expect(r.state.pending).toEqual({ attacker: 0, queue: [2] });
  });
});

describe('R-TOKYO-09 東京灣關閉', () => {
  it('存活降到 4 人，東京灣的怪獸離開，東京市有人所以回到東京外', () => {
    // 5 人：0 在東京市攻擊，1 剩 1 HP 在東京外，3 在東京灣
    const s = makeState({
      players: 5,
      monsters: { 0: { location: 'city' }, 1: { hp: 1 }, 3: { location: 'bay' } },
    });
    const r = resolveWith(s, attacks(1));
    expect(mon(r.state, 1).alive).toBe(false);
    expect(mon(r.state, 3).location).toBe(null);
    expect(mon(r.state, 3).vp).toBe(0);
    expect(r.events).toContainEqual({ type: 'bay_closed', seat: 3, movedTo: null });
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('東京市怪獸被外面的攻擊者擊殺：攻擊者先移入東京市，灣內怪獸再離開', () => {
    const s = makeState({
      players: 5,
      monsters: { 1: { location: 'city', hp: 1 }, 2: { location: 'bay' } },
    });
    let st = resolveWith(s, attacks(1)).state;
    expect(st.pending).toEqual({ attacker: 0, queue: [2] });
    const r = must(st, { type: 'yieldDecision', seat: 2, leave: false });
    st = r.state;
    expect(mon(st, 0)).toMatchObject({ location: 'city', vp: 1 });
    expect(mon(st, 2).location).toBe(null);
    expect(r.events).toContainEqual({ type: 'bay_closed', seat: 2, movedTo: null });
  });

  it('東京市是空的時，灣內怪獸改移到東京市，且不得 VP', () => {
    // 防禦性測試：現行規則下很難出現這個狀態，但規則書有明文
    const s = makeState({
      players: 5,
      turnSeat: 0,
      monsters: { 0: { location: 'bay', vp: 3 }, 1: { hp: 1 } },
    });
    const r = resolveWith(s, attacks(1));
    expect(mon(r.state, 1).alive).toBe(false);
    expect(mon(r.state, 0)).toMatchObject({ location: 'city', vp: 3 });
    expect(r.events).toContainEqual({ type: 'bay_closed', seat: 0, movedTo: 'city' });
  });

  it('存活仍有 5 人時東京灣照常運作', () => {
    // 6 人：0 在東京市攻擊，4 剩 1 HP 被淘汰 → 存活 5，東京灣仍可用
    const s = makeState({
      players: 6,
      monsters: { 0: { location: 'city' }, 3: { location: 'bay' }, 4: { hp: 1 } },
    });
    const r = resolveWith(s, attacks(1));
    expect(mon(r.state, 4).alive).toBe(false);
    expect(mon(r.state, 3).location).toBe('bay');
    expect(eventTypes(r.events)).not.toContain('bay_closed');
  });
});
