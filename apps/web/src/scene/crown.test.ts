import { Group, Mesh, BoxGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { buildCrown, headBounds } from './crown.js';

describe('皇冠', () => {
  it('頭部包圍盒：量得到網格才回傳；空的頭回傳 null', () => {
    const head = new Group();
    expect(headBounds(head)).toBeNull();
    const m = new Mesh(new BoxGeometry(2, 1, 3));
    m.position.set(0, 0.5, 0);
    m.updateMatrix();
    head.add(m);
    const box = headBounds(head);
    expect(box?.max.y).toBeCloseTo(1, 5);
    expect(box ? box.max.z - box.min.z : 0).toBeCloseTo(3, 5);
  });

  it('皇冠：依縮放與基準高度擺放，會自轉並上下浮動；可釋放', () => {
    const c = buildCrown('#ff0000', 2, 0.5);
    expect(c.group.scale.x).toBe(0.5);
    c.update(0);
    const y0 = c.group.position.y;
    c.update(0.4);
    expect(c.group.position.y).not.toBe(y0);
    expect(Math.abs(c.group.position.y - 2)).toBeLessThan(0.1);
    expect(c.group.rotation.y).toBeGreaterThan(0);
    expect(() => {
      c.dispose();
    }).not.toThrow();
  });
});
