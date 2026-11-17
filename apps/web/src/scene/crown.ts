import {
  Box3,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  type BufferGeometry,
} from 'three';

/** 勝利者頭上的金色皇冠（原創造型：環帶＋五根尖角，尖端鑲寶石）。單位是怪獸本地座標。 */
export interface Crown {
  group: Group;
  /** 慢慢自轉並上下浮動。 */
  update: (time: number) => void;
  dispose: () => void;
}

const POINTS = 5;

export function buildCrown(gem: string, baseY: number, scale = 1): Crown {
  const gold = new MeshLambertMaterial({ color: '#ffcf33', emissive: '#a86a00' });
  const jewel = new MeshLambertMaterial({ color: gem, emissive: gem, emissiveIntensity: 0.55 });
  const geometries: BufferGeometry[] = [];
  const track = <T extends BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };

  const group = new Group();
  group.name = 'crown';
  group.scale.setScalar(scale);
  const ring = new Mesh(track(new CylinderGeometry(0.95, 0.8, 0.5, 20, 1, true)), gold);
  ring.material.side = 2; // 雙面：環帶內側也看得到
  group.add(ring);
  const spikeGeo = track(new ConeGeometry(0.22, 0.75, 6));
  const gemGeo = track(new SphereGeometry(0.15, 8, 6));
  for (let i = 0; i < POINTS; i++) {
    const a = (i / POINTS) * Math.PI * 2;
    const spike = new Mesh(spikeGeo, gold);
    spike.position.set(Math.cos(a) * 0.88, 0.62, Math.sin(a) * 0.88);
    group.add(spike);
    const g = new Mesh(gemGeo, jewel);
    g.position.set(Math.cos(a) * 0.88, 1.05, Math.sin(a) * 0.88);
    group.add(g);
  }

  return {
    group,
    update: (time) => {
      group.rotation.y = time * 0.9;
      group.position.y = baseY + Math.sin(time * 2.4) * 0.08 * scale;
    },
    dispose: () => {
      for (const g of geometries) g.dispose();
      gold.dispose();
      jewel.dispose();
    },
  };
}

/** 頭部（本地座標）的包圍盒：把皇冠戴在頭頂時用。沒有網格就回傳 null。 */
export function headBounds(head: Group): Box3 | null {
  const box = new Box3();
  head.updateWorldMatrix(true, true);
  head.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const geo = o.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (geo.boundingBox) box.union(geo.boundingBox.clone().applyMatrix4(o.matrix));
  });
  return box.isEmpty() ? null : box;
}
