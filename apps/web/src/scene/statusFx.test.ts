import { describe, expect, it } from 'vitest';
import {
  POISON_MAX,
  SHRINK_MAX,
  hash,
  poisonCount,
  poisonGlow,
  poisonParticle,
  shrinkCount,
  shrinkParticle,
  shrinkScale,
} from './statusFx.js';
import { toSnapshot } from './snapshot.js';

describe('狀態特效：數量與大小', () => {
  it('沒有指示物就沒有粒子；越多越濃，但有上限', () => {
    expect(poisonCount(0)).toBe(0);
    expect(shrinkCount(0)).toBe(0);
    expect(poisonCount(2)).toBeGreaterThan(poisonCount(1));
    expect(shrinkCount(2)).toBeGreaterThan(shrinkCount(1));
    expect(poisonCount(99)).toBeLessThanOrEqual(POISON_MAX);
    expect(shrinkCount(99)).toBeLessThanOrEqual(SHRINK_MAX);
  });
  it('縮小：沒有指示物維持原大小，越多越小，最小 0.68', () => {
    expect(shrinkScale(0)).toBe(1);
    expect(shrinkScale(1)).toBeLessThan(1);
    expect(shrinkScale(2)).toBeLessThan(shrinkScale(1));
    expect(shrinkScale(50)).toBe(0.68);
  });
  it('中毒閃爍強度永遠在 0..1，而且確實會變化（閃爍）', () => {
    const v = Array.from({ length: 200 }, (_, i) => poisonGlow(i * 0.05));
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v)).toBeLessThanOrEqual(1);
    expect(Math.max(...v) - Math.min(...v)).toBeGreaterThan(0.3);
  });
});

describe('狀態特效：粒子', () => {
  const H = 6;
  it('hash 是確定性的、落在 0..1', () => {
    expect(hash(3, 2)).toBe(hash(3, 2));
    for (let i = 0; i < 50; i++) {
      expect(hash(i, 1)).toBeGreaterThanOrEqual(0);
      expect(hash(i, 1)).toBeLessThan(1);
    }
  });
  it('毒霧：同一時間同一顆粒子位置固定；透明度、色調在範圍內；範圍不會飄太遠', () => {
    for (let i = 0; i < POISON_MAX; i++) {
      for (const t of [0, 0.7, 3.3, 12.9]) {
        const p = poisonParticle(i, t, H);
        expect(p).toEqual(poisonParticle(i, t, H));
        expect(p.alpha).toBeGreaterThanOrEqual(0);
        expect(p.alpha).toBeLessThanOrEqual(1);
        expect(p.tone).toBeGreaterThanOrEqual(0);
        expect(p.tone).toBeLessThanOrEqual(1);
        expect(Math.hypot(p.x, p.z)).toBeLessThan(3);
        expect(p.y).toBeGreaterThan(-0.1);
        expect(p.y).toBeLessThan(H * 1.4);
        expect(p.size).toBeGreaterThan(0);
      }
    }
  });
  it('毒霧一直在動（過一小段時間位置不同）', () => {
    const moved = Array.from({ length: 20 }, (_, i) => {
      const a = poisonParticle(i, 1, H);
      const b = poisonParticle(i, 1.4, H);
      return Math.abs(a.y - b.y) + Math.abs(a.x - b.x) > 0.01;
    });
    expect(moved.filter(Boolean).length).toBeGreaterThan(15);
  });
  it('縮小光點：越接近一生的尾聲離怪獸越近', () => {
    for (let i = 0; i < SHRINK_MAX; i++) {
      const speed = 0.45 + 0.3 * hash(i, 1);
      const start = hash(i, 2);
      // 找出這顆粒子 u≈0.1（外圍）與 u≈0.9（中心）的時間
      const at = (u: number): number => ((u - start + 10) % 1) / speed;
      const far = shrinkParticle(i, at(0.1), H);
      const near = shrinkParticle(i, at(0.9), H);
      expect(Math.hypot(near.x, near.z)).toBeLessThan(Math.hypot(far.x, far.z));
    }
  });
});

describe('toSnapshot：指示物', () => {
  const room = { players: [{ id: 'me', nickname: 'A', seat: 0, monster: null }] } as never;
  it('把中毒／縮小數量帶進快照；沒有就是 0', () => {
    const mon = (seat: number, tokens: { poison: number; shrink: number }) => ({
      seat,
      alive: true,
      hp: 10,
      maxHp: 10,
      vp: 0,
      energy: 0,
      location: null,
      cards: [],
      cardData: {},
      tokens,
    });
    const state = {
      config: { playerCount: 2 },
      monsters: [mon(0, { poison: 2, shrink: 1 }), mon(1, { poison: 0, shrink: 0 })],
    } as never;
    const snap = toSnapshot(room, state, 0, 'me');
    expect(snap.monsters[0]?.tokens).toEqual({ poison: 2, shrink: 1 });
    expect(snap.monsters[1]?.tokens).toEqual({ poison: 0, shrink: 0 });
  });
});
