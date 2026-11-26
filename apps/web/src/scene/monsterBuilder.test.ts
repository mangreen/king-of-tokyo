import { BoxGeometry, SphereGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { Builder, posNoise, roughen } from './monsterBuilder.js';
import { buildMonster } from './monsters.js';

describe('風化凹凸 roughen', () => {
  it('posNoise 落在 0..1，且同一位置永遠得到同一個值', () => {
    for (let i = 0; i < 200; i++) {
      const v = posNoise(i * 0.37, i * -0.11, i * 0.5, 1.3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(posNoise(i * 0.37, i * -0.11, i * 0.5, 1.3)).toBe(v);
    }
  });

  it('球與方塊被位移出凹凸：頂點偏離原本的半徑，且沒有 NaN、位置接縫不裂開', () => {
    const plain = new SphereGeometry(1, 12, 8);
    const base = plain.getAttribute('position');
    const radii0 = new Set<number>();
    for (let i = 0; i < base.count; i++)
      radii0.add(Math.round(Math.hypot(base.getX(i), base.getY(i), base.getZ(i)) * 1000));
    const rough = roughen(new SphereGeometry(1, 12, 8), 0.2, '#888888');
    const pos = rough.getAttribute('position');
    const radii = new Set<number>();
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThan(0.6);
      expect(r).toBeLessThan(1.4);
      radii.add(Math.round(r * 1000));
    }
    expect(radii0.size).toBe(1);
    expect(radii.size).toBeGreaterThan(10);
    // 併過頂點：同一個位置只剩一個頂點（接縫不會裂開）
    const seen = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      const key = [pos.getX(i), pos.getY(i), pos.getZ(i)].map((n) => n.toFixed(4)).join(',');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(rough.getAttribute('color')).toBeDefined();
    expect(rough.getAttribute('normal')).toBeDefined();
    expect(rough.getAttribute('uv')).toBeDefined();
  });

  it('顏色深淺不一（凹處暗、凸處亮），但不會變成全黑或超出範圍', () => {
    const geo = roughen(new BoxGeometry(2, 2, 2, 4, 4, 4), 0.15, '#808080');
    const c = geo.getAttribute('color');
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < c.count; i++) {
      lo = Math.min(lo, c.getX(i));
      hi = Math.max(hi, c.getX(i));
    }
    expect(hi - lo).toBeGreaterThan(0.08);
    expect(lo).toBeGreaterThan(0.1);
    expect(hi).toBeLessThanOrEqual(1);
  });

  it('同一份輸入每次結果相同（決定性，不用亂數）', () => {
    const a = roughen(new SphereGeometry(1, 10, 6), 0.2, '#999999').getAttribute('position');
    const b = roughen(new SphereGeometry(1, 10, 6), 0.2, '#999999').getAttribute('position');
    expect(Array.from(a.array)).toEqual(Array.from(b.array));
  });

  it('Builder.rough = 0 時維持光滑的原行為；>0 時方塊會多切面、能與其他部位合併', () => {
    const smooth = new Builder(12);
    smooth.box([2, 2, 2], '#888888', [0, 0, 0]).ball(1, '#888888', [0, 0, 0]);
    const rough = new Builder(12);
    rough.rough = 0.15;
    rough.box([2, 2, 2], '#888888', [0, 0, 0]).ball(1, '#888888', [0, 0, 0]);
    rough.limb([0, 0, 0], [0, 1, 0], 0.3, 0.2, '#888888'); // 與沒有凹凸的部位混著合併
    const g1 = smooth.merge([0, 0, 0]);
    const g2 = rough.merge([0, 0, 0]);
    expect(g1).not.toBeNull();
    expect(g2).not.toBeNull();
    expect(g2!.getAttribute('position').count).toBeGreaterThan(g1!.getAttribute('position').count);
  });

  it('石魔三角面數仍在預算內（< 12000），且每個頂點座標都是有限數', () => {
    const rig = buildMonster(9, 0, 12);
    let tris = 0;
    rig.root.traverse((o) => {
      const g = (
        o as {
          geometry?: {
            index: { count: number } | null;
            getAttribute: (n: string) => { count: number; array: ArrayLike<number> };
          };
        }
      ).geometry;
      if (!g) return;
      tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      for (const v of Array.from(g.getAttribute('position').array))
        expect(Number.isFinite(v)).toBe(true);
    });
    expect(tris).toBeGreaterThan(300);
    expect(tris).toBeLessThan(12000);
    rig.dispose();
  });
});
