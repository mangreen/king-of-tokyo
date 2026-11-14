import { describe, expect, it } from 'vitest';
import { hashToken, randomHex } from '../random.js';
import { rankCandidates, SuccessionPlanner } from './succession.js';

describe('後備順序', () => {
  it('直連優先，其次依加入先後', () => {
    expect(
      rankCandidates([
        { playerId: 'a', direct: false, serial: 1 },
        { playerId: 'b', direct: true, serial: 3 },
        { playerId: 'c', direct: false, serial: 2 },
        { playerId: 'd', direct: true, serial: 2 },
      ]),
    ).toEqual(['d', 'b', 'a', 'c']);
    expect(rankCandidates([])).toEqual([]);
  });
});

describe('接手金鑰', () => {
  it('每位玩家一把固定的金鑰；順序改變時金鑰不變，雜湊跟著順序', () => {
    const planner = new SuccessionPlanner(randomHex);
    const ka = planner.keyOf('a');
    const kb = planner.keyOf('b');
    expect(ka).toMatch(/^[0-9a-f]{32}$/);
    expect(ka).not.toBe(kb);
    expect(planner.keyOf('a')).toBe(ka);
    expect(planner.hashes(['a', 'b'])).toEqual([hashToken(ka), hashToken(kb)]);
    expect(planner.hashes(['b', 'a'])).toEqual([hashToken(kb), hashToken(ka)]);
  });

  it('可匯出後再載入（重新整理後沿用）', () => {
    const first = new SuccessionPlanner(randomHex);
    first.keyOf('a');
    const second = new SuccessionPlanner(randomHex, first.exportKeys());
    expect(second.keyOf('a')).toBe(first.keyOf('a'));
  });
});
