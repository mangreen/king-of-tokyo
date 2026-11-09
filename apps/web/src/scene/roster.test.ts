import { describe, expect, it } from 'vitest';
import { MONSTER_COUNT } from '@kot/protocol';
import { Box3, Vector3 } from 'three';
import { BUILDERS, buildMonster } from './monsters.js';
import { MONSTER_NAMES, monsterKindOf, monsterName } from './roster.js';
import { MONSTER_SCALE } from './shots.js';

describe('怪獸名冊', () => {
  it('協定、名冊、造型建造函式的數量一致，名字不重複', () => {
    expect(MONSTER_NAMES).toHaveLength(MONSTER_COUNT);
    expect(BUILDERS).toHaveLength(MONSTER_COUNT);
    expect(new Set(MONSTER_NAMES).size).toBe(MONSTER_COUNT);
  });

  it('有分配就用分配的；沒有（舊伺服器、示範）依座位輪流；壞值退回座位', () => {
    expect(monsterKindOf(0, 7)).toBe(7);
    expect(monsterKindOf(3, null)).toBe(3);
    expect(monsterKindOf(3, undefined)).toBe(3);
    expect(monsterKindOf(2, 99)).toBe(2);
    expect(monsterKindOf(2, -1)).toBe(2);
    expect(monsterKindOf(2, 1.5)).toBe(2);
    expect(monsterName(0)).toBe('蜥蜴');
    expect(monsterName(99)).toBe('怪獸');
  });
});

describe('每種怪獸造型', () => {
  for (let kind = 0; kind < MONSTER_COUNT; kind++) {
    it(`#${String(kind)} ${monsterName(kind)}：大小合理、面數在預算內、5 個部位`, () => {
      const rig = buildMonster(kind, 0, 12);
      expect(rig.archetype).toBe(kind);
      let tris = 0;
      let meshes = 0;
      rig.root.traverse((o) => {
        const m = o as {
          isMesh?: boolean;
          geometry?: {
            index: { count: number } | null;
            attributes: { position: { count: number } };
          };
        };
        if (m.isMesh && m.geometry) {
          meshes++;
          tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
        }
      });
      // 身體另有一個陰影用的 mesh 共用幾何，所以最多 6 個 mesh
      expect(meshes).toBeLessThanOrEqual(6);
      expect(tris).toBeGreaterThan(300);
      expect(tris).toBeLessThan(12000);
      rig.root.updateMatrixWorld(true);
      const box = new Box3().setFromObject(rig.root);
      const size = box.getSize(new Vector3()).divideScalar(MONSTER_SCALE);
      expect(box.min.y / MONSTER_SCALE).toBeGreaterThan(-0.3);
      expect(size.y).toBeGreaterThan(3.8);
      expect(size.y).toBeLessThan(6.4);
      expect(size.x).toBeLessThan(7);
      expect(size.z).toBeLessThan(9);
      rig.dispose();
    });
  }
});
