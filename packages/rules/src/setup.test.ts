import { describe, expect, it } from 'vitest';
import { checkInvariants } from './invariants.js';
import { createGame, defaultConfig, validateConfig } from './state.js';

describe('R-SETUP 設置', () => {
  it('R-SETUP-01：每位怪獸起始 10 HP、0 VP、0 能量，全部存活', () => {
    const { state } = createGame(defaultConfig(4), 7);
    expect(state.monsters).toHaveLength(4);
    for (const m of state.monsters) {
      expect(m).toMatchObject({ hp: 10, maxHp: 10, vp: 0, energy: 0, alive: true });
    }
  });

  it('R-SETUP-01：人數必須是 2–6', () => {
    expect(() => validateConfig(defaultConfig(1))).toThrow(RangeError);
    expect(() => validateConfig(defaultConfig(7))).toThrow(RangeError);
    expect(() => validateConfig(defaultConfig(2.5))).toThrow(RangeError);
    for (const n of [2, 3, 4, 5, 6]) {
      expect(() => validateConfig(defaultConfig(n))).not.toThrow();
    }
  });

  it('R-SETUP-05：開局沒有人在東京', () => {
    const { state } = createGame(defaultConfig(6), 3);
    expect(state.monsters.every((m) => m.location === null)).toBe(true);
  });

  it('R-SETUP-04：先手由骰子決定，同一個 seed 結果相同，且決賽輪只剩平手者', () => {
    const a = createGame(defaultConfig(5), 2024);
    const b = createGame(defaultConfig(5), 2024);
    expect(a).toEqual(b);
    expect(a.state.turn.seat).toBe(a.state.firstSeat);

    const decided = a.events[0];
    if (decided?.type !== 'first_player_decided')
      throw new Error('第一個事件應為 first_player_decided');
    expect(decided.rounds[0]).toHaveLength(5);
    // 每一輪的參與者必須是前一輪最高攻擊數的人
    for (let i = 1; i < decided.rounds.length; i += 1) {
      const prev = decided.rounds[i - 1] ?? [];
      const best = Math.max(...prev.map((r) => r.attacks));
      const expected = prev.filter((r) => r.attacks === best).map((r) => r.seat);
      expect((decided.rounds[i] ?? []).map((r) => r.seat)).toEqual(expected);
    }
    // 先手是最後一輪攻擊最多者（若有平手上限才取最小座位）
    const last = decided.rounds[decided.rounds.length - 1] ?? [];
    const best = Math.max(...last.map((r) => r.attacks));
    expect(last.filter((r) => r.attacks === best).map((r) => r.seat)).toContain(decided.firstSeat);
  });

  it('不同 seed 能得到不同的先手（不是固定座位）', () => {
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 60; seed += 1) {
      firsts.add(createGame(defaultConfig(4), seed).state.firstSeat);
    }
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('初始狀態符合不變條件', () => {
    for (let n = 2; n <= 6; n += 1) {
      expect(checkInvariants(createGame(defaultConfig(n), n).state)).toEqual([]);
    }
  });
});
