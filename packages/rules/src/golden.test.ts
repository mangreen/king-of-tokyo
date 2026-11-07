/**
 * Golden 測試：來自 KOT1／KOT2 規則書的官方範例（docs/rules-spec.md §3）。
 * 骰面直接指定，不依賴亂數；走的是真正的結算流程。
 */
import { describe, expect, it } from 'vitest';
import { checkInvariants } from './invariants.js';
import { makeState, mon, must, resolveWith, yieldQueue } from './test-utils.js';
import type { Face } from './types.js';

const A: Face = 'attack';
const E: Face = 'energy';

describe('G-01 / G-02 骰子範例', () => {
  it('G-02：Gigazaur（東京外）擲出 2,2,2,2,能量,攻擊 → 3 VP、1 能量；東京市的 CyberKitty 失去 1 HP', () => {
    // 座位 0 = Gigazaur，1 = CyberKitty（在東京市）
    const s = makeState({ players: 4, monsters: { 1: { location: 'city' } } });
    const r = resolveWith(s, [2, 2, 2, 2, E, A]);
    expect(mon(r.state, 0)).toMatchObject({ vp: 3, energy: 1, hp: 10 });
    expect(mon(r.state, 1).hp).toBe(9);
    // 官方範例沒有讓位，所以 Gigazaur 留在東京外（G-02 之後 CyberKitty 決定不讓位）
    const stay = must(r.state, { type: 'yieldDecision', seat: 1, leave: false });
    expect(mon(stay.state, 0).location).toBe(null);
    expect(mon(stay.state, 1).location).toBe('city');
    expect(mon(stay.state, 0).vp).toBe(3); // 沒有進入東京，沒有額外 VP
  });

  it('G-01：同樣的骰面，CyberKitty 不會因為沒有治療面而回血', () => {
    const s = makeState({ players: 2, monsters: { 1: { location: 'city', hp: 8 } } });
    const r = resolveWith(s, [2, 2, 2, 2, E, A]);
    expect(mon(r.state, 1).hp).toBe(7);
  });
});

describe('G-03 KOT2 五人局範例', () => {
  // 座位：0 MekaDragon、1 Gigazaur（HP 8，在東京市）、2 Space Penguin（在東京灣）、3 The King、4 CyberKitty
  it('逐步重現：讓位、移入東京灣、淘汰後東京灣關閉', () => {
    let state = makeState({
      players: 5,
      monsters: { 1: { hp: 8, location: 'city' }, 2: { location: 'bay' } },
    });

    // ① MekaDragon 擲出 4 個攻擊：Gigazaur 與 Space Penguin 各失去 4 HP，都讓位；MekaDragon 進入東京市 +1 VP，東京灣空著
    let r = resolveWith(state, [A, A, A, A, 1, 2]);
    expect(mon(r.state, 1).hp).toBe(4);
    expect(mon(r.state, 2).hp).toBe(6);
    expect(yieldQueue(r.state)).toEqual([1, 2]); // 從攻擊者下一位順時針
    r = must(r.state, { type: 'yieldDecision', seat: 1, leave: true });
    r = must(r.state, { type: 'yieldDecision', seat: 2, leave: true });
    state = r.state;
    expect(mon(state, 0)).toMatchObject({ location: 'city', vp: 1 });
    expect(mon(state, 1).location).toBe(null);
    expect(mon(state, 2).location).toBe(null);
    expect(state.turn.seat).toBe(1);

    // ② Gigazaur 的回合：回合開始不在東京（沒有 +2）。擲出 1 個攻擊：只有東京市的 MekaDragon 失去 1 HP，選擇留下；
    //    Gigazaur 必須進入東京灣並得 1 VP
    r = resolveWith(state, [A, 1, 1, 2, 2, 3]);
    expect(yieldQueue(r.state)).toEqual([0]);
    r = must(r.state, { type: 'yieldDecision', seat: 0, leave: false });
    state = r.state;
    expect(mon(state, 0)).toMatchObject({ hp: 9, location: 'city' });
    expect(mon(state, 1)).toMatchObject({ location: 'bay', vp: 1 });

    // ③ Space Penguin 擲出 1 個攻擊：Gigazaur 與 MekaDragon 各失去 1 HP；Gigazaur 讓出東京灣，MekaDragon 留在東京市；
    //    Space Penguin 進入東京灣
    r = resolveWith(state, [A, 1, 1, 2, 2, 3]);
    expect(yieldQueue(r.state)).toEqual([0, 1]);
    r = must(r.state, { type: 'yieldDecision', seat: 0, leave: false });
    r = must(r.state, { type: 'yieldDecision', seat: 1, leave: true });
    state = r.state;
    expect(mon(state, 0)).toMatchObject({ hp: 8, location: 'city' });
    expect(mon(state, 1)).toMatchObject({ hp: 3, location: null });
    expect(mon(state, 2)).toMatchObject({ location: 'bay', vp: 1 });

    // ④ The King、CyberKitty 各擲 0 個攻擊：沒有人進出東京
    r = resolveWith(state, [1, 1, 2, 2, 3, 3]);
    state = r.state;
    expect(state.turn.seat).toBe(4);
    r = resolveWith(state, [1, 1, 2, 2, 3, 3]);
    state = r.state;
    expect(state.turn.seat).toBe(0);
    for (const seat of [3, 4]) {
      expect(mon(state, seat).location).toBe(null);
    }
    expect(mon(state, 0).location).toBe('city');
    expect(mon(state, 2).location).toBe('bay');

    // ⑤ MekaDragon 回合開始在東京，+2 VP；擲出 3 個攻擊：Gigazaur、The King、CyberKitty 各失去 3 HP；
    //    東京灣的 Space Penguin 不受傷；Gigazaur 3→0 淘汰，存活降為 4，Space Penguin 必須離開東京灣
    expect(mon(state, 0).vp).toBe(1 + 2); // ① 進入東京 +1，回合開始 +2
    r = resolveWith(state, [A, A, A, 1, 1, 2]);
    state = r.state;
    expect(mon(state, 1)).toMatchObject({ hp: 0, alive: false });
    expect(mon(state, 3).hp).toBe(7);
    expect(mon(state, 4).hp).toBe(7);
    expect(mon(state, 2).hp).toBe(6); // 東京內的怪獸不互相攻擊
    expect(mon(state, 2).location).toBe(null);
    expect(mon(state, 0).location).toBe('city');
    expect(r.events).toContainEqual({ type: 'bay_closed', seat: 2, movedTo: null });
    expect(state.monsters.filter((m) => m.alive)).toHaveLength(4);
    expect(checkInvariants(state)).toEqual([]);
  });
});
