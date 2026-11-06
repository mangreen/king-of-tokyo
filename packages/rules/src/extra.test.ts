import { describe, expect, it } from 'vitest';
import { greedyBot, randomBot } from './bot.js';
import { applyAction } from './engine.js';
import { checkInvariants } from './invariants.js';
import { replay } from './replay.js';
import { createGame, defaultConfig } from './state.js';
import { makeState, mon, must, resolveWith } from './test-utils.js';
import type { Action, Face } from './types.js';

const A: Face = 'attack';
const BLANK: Face[] = [1, 1, 2, 2, 3, 3];

describe('動作形狀不對時回穩定錯誤碼（不丟例外）', () => {
  const s = makeState({ players: 3 });
  it.each([
    ['roll 沒有 keep', { type: 'roll', seat: 0 }],
    ['roll 的 keep 不是陣列', { type: 'roll', seat: 0, keep: 'abc' }],
    ['seat 不是整數', { type: 'endRolling', seat: 0.5 }],
    ['leave 不是布林值', { type: 'yieldDecision', seat: 0, leave: 'false' }],
    ['未知的動作類型', { type: 'cheat', seat: 0 }],
  ])('%s → invalid_action', (_name, action) => {
    expect(applyAction(s, action as unknown as Action)).toEqual({
      ok: false,
      error: 'invalid_action',
    });
  });
});

describe('東京灣的邊界情況', () => {
  it('東京灣的攻擊者擊殺後存活降為 4：攻擊者必須離開東京灣（東京市有人）', () => {
    const s = makeState({
      players: 5,
      monsters: { 0: { location: 'bay' }, 1: { location: 'city' }, 2: { hp: 1 } },
    });
    const r = resolveWith(s, [A, ...BLANK.slice(0, 5)]);
    expect(mon(r.state, 2).alive).toBe(false);
    expect(mon(r.state, 0).location).toBe(null);
    expect(mon(r.state, 1).location).toBe('city');
    expect(r.events).toContainEqual({ type: 'bay_closed', seat: 0, movedTo: null });
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('6 人局：東京市怪獸被淘汰、存活 6→5，東京灣仍可用；攻擊者進入東京市，灣內怪獸留下', () => {
    const s = makeState({
      players: 6,
      monsters: { 1: { location: 'city', hp: 1 }, 2: { location: 'bay' } },
    });
    let st = resolveWith(s, [A, ...BLANK.slice(0, 5)]).state;
    st = must(st, { type: 'yieldDecision', seat: 2, leave: false }).state;
    expect(mon(st, 0).location).toBe('city');
    expect(mon(st, 2).location).toBe('bay');
    expect(checkInvariants(st)).toEqual([]);
  });
});

describe('非預設設定', () => {
  it('只擲 2 次、5 顆骰子、15 VP 的設定可正常運作', () => {
    const config = { ...defaultConfig(3), diceCount: 5, maxRolls: 2, victoryPoints: 15 };
    const { state } = createGame(config, 5);
    const first = must(state, { type: 'roll', seat: state.firstSeat, keep: [] });
    expect(first.state.turn.dice).toHaveLength(5);
    const second = must(first.state, { type: 'roll', seat: state.firstSeat, keep: [0] });
    expect(second.events.map((e) => e.type)).toContain('turn_ended'); // 第 2 擲後自動結算
    expect(second.state.turn.seat).not.toBe(state.firstSeat);
  });

  it('VP 目標 15：達 15 即在回合結束獲勝', () => {
    const s = makeState({ players: 3, turnSeat: 1, monsters: { 1: { vp: 14 } } });
    s.config.victoryPoints = 15;
    expect(resolveWith(s, BLANK).state.outcome?.winners).toEqual([1]);
  });
});

describe('replay 與機器人', () => {
  it('replay：動作被拒絕時丟出明確錯誤', () => {
    expect(() => replay(defaultConfig(3), 1, [{ type: 'endRolling', seat: 0 }])).toThrow(
      /第 0 個動作被拒絕/,
    );
  });

  it('replay：沒有動作時等於 createGame', () => {
    const created = createGame(defaultConfig(4), 9);
    expect(replay(defaultConfig(4), 9, [])).toEqual(created);
  });

  it('遊戲結束後機器人不再給動作', () => {
    const s = makeState({ players: 2, monsters: { 1: { location: 'city', hp: 1 } } });
    const over = resolveWith(s, [A, ...BLANK.slice(0, 5)]).state;
    expect(() => greedyBot(over)).toThrow();
    expect(() => randomBot(over, 1)).toThrow();
  });

  it('固定策略：被打到 HP ≤4 就讓位，否則留下', () => {
    const base = makeState({ players: 3, monsters: { 1: { location: 'city', hp: 6 } } });
    const asked = resolveWith(base, [A, ...BLANK.slice(0, 5)]).state; // hp 6 → 5
    expect(greedyBot(asked)).toEqual({ type: 'yieldDecision', seat: 1, leave: false });
    const weak = makeState({ players: 3, monsters: { 1: { location: 'city', hp: 5 } } });
    const asked2 = resolveWith(weak, [A, ...BLANK.slice(0, 5)]).state; // hp 5 → 4
    expect(greedyBot(asked2)).toEqual({ type: 'yieldDecision', seat: 1, leave: true });
  });
});

describe('事件不與狀態共用物件', () => {
  it('修改 game_over 事件的 winners 不會影響狀態', () => {
    const s = makeState({ players: 2, monsters: { 1: { location: 'city', hp: 1 } } });
    const r = resolveWith(s, [A, ...BLANK.slice(0, 5)]);
    const event = r.events.at(-1);
    if (event?.type !== 'game_over') throw new Error('最後一個事件應為 game_over');
    event.winners.push(99);
    expect(r.state.outcome?.winners).toEqual([0]);
  });
});
