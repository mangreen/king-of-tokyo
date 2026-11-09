import { Group, Mesh, MeshLambertMaterial, type BufferGeometry } from 'three';
import {
  BRIDGE_END,
  BRIDGE_START,
  FERRIS_WHEEL,
  ODAIBA,
  SKYTREE,
  SKYTREE_HEIGHT,
  TOKYO_TOWER,
  TOKYO_TOWER_HEIGHT,
} from './layout.js';
import { Builder } from './monsterBuilder.js';

/**
 * 東京的地標（程序化原創幾何，每個合併成一個 mesh，頂點色上色）：
 * 東京鐵塔（橘白相間的格構塔）、晴空塔、彩虹大橋、台場的摩天輪與電視台風格建築。
 */

type V3 = [number, number, number];

const ORANGE = '#e8501e';
const WHITE = '#f4f1ea';
const STEEL = '#8a8f98';

export interface Landmarks {
  group: Group;
  /** 摩天輪緩慢轉動。 */
  update: (timeSeconds: number) => void;
  dispose: () => void;
  triangles: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 東京鐵塔：四隻腳向上收攏的格構塔，橘白色帶，兩層展望台，頂端天線。 */
export function towerGeometry(): BufferGeometry {
  const H = 13; // 格構部分的高度，之上是天線
  const levels = 13;
  const w = (y: number): number => lerp(2.4, 0.32, Math.pow(y / H, 0.85));
  const b = new Builder(8);
  const corner = (i: number, y: number): V3 => {
    const hw = w(y);
    const sx = i % 2 === 0 ? 1 : -1;
    const sz = i < 2 ? 1 : -1;
    return [sx * hw, y, sz * hw];
  };
  for (let i = 0; i < 4; i++) b.limb(corner(i, 0), corner(i, H), 0.16, 0.08, ORANGE);
  for (let l = 0; l <= levels; l++) {
    const y = (l / levels) * H;
    const color = Math.floor(l / 2) % 2 === 0 ? WHITE : ORANGE;
    // 四個角依序連成方框：0-1、1-3、3-2、2-0
    const order = [0, 1, 3, 2];
    for (let i = 0; i < 4; i++) {
      b.limb(corner(order[i] ?? 0, y), corner(order[(i + 1) % 4] ?? 0, y), 0.06, 0.06, color);
    }
    if (l < levels) {
      const y2 = ((l + 1) / levels) * H;
      for (let i = 0; i < 4; i++) {
        const i0 = order[i] ?? 0;
        const i1 = order[(i + 1) % 4] ?? 0;
        // 每個側面畫 X 形斜撐
        b.limb(corner(i0, y), corner(i1, y2), 0.04, 0.04, color);
        b.limb(corner(i1, y), corner(i0, y2), 0.04, 0.04, color);
      }
    }
  }
  // 大展望台與特別展望台
  b.box([w(5.2) * 2 + 1.1, 0.55, w(5.2) * 2 + 1.1], ORANGE, [0, 5.2, 0]);
  b.box([w(5.2) * 2 + 0.6, 0.28, w(5.2) * 2 + 0.6], WHITE, [0, 5.62, 0]);
  b.box([w(9.6) * 2 + 0.8, 0.4, w(9.6) * 2 + 0.8], ORANGE, [0, 9.6, 0]);
  // 天線
  b.limb([0, H, 0], [0, TOKYO_TOWER_HEIGHT - 0.6, 0], 0.1, 0.05, WHITE);
  b.limb([0, TOKYO_TOWER_HEIGHT - 3.2, 0], [0, TOKYO_TOWER_HEIGHT, 0], 0.06, 0.02, ORANGE);
  const geo = b.merge([0, 0, 0]);
  if (!geo) throw new Error('tower geometry empty');
  return geo;
}

/** 晴空塔：白藍色的圓錐塔身、兩個展望球體、細長天線。 */
export function skytreeGeometry(): BufferGeometry {
  const b = new Builder(10);
  const H = SKYTREE_HEIGHT;
  b.limb([0, 0, 0], [0, H * 0.72, 0], 0.95, 0.3, '#dfe9f2');
  b.limb([0, H * 0.72, 0], [0, H, 0], 0.18, 0.04, '#c9d6e3');
  b.ball(1.05, '#cfe3f5', [0, H * 0.55, 0], [1, 0.55, 1]);
  b.ball(0.78, '#cfe3f5', [0, H * 0.67, 0], [1, 0.5, 1]);
  // 底部三隻腳
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.limb(
      [Math.cos(a) * 1.9, 0, Math.sin(a) * 1.9],
      [Math.cos(a) * 0.5, 7, Math.sin(a) * 0.5],
      0.22,
      0.12,
      '#bcd0e2',
    );
  }
  const geo = b.merge([0, 0, 0]);
  if (!geo) throw new Error('skytree geometry empty');
  return geo;
}

/** 彩虹大橋：白色雙塔懸索橋，橋面、主纜與吊索。座標為世界座標。 */
export function bridgeGeometry(): BufferGeometry {
  const b = new Builder(8);
  const dx = BRIDGE_END.x - BRIDGE_START.x;
  const dz = BRIDGE_END.z - BRIDGE_START.z;
  const L = Math.hypot(dx, dz);
  const ux = dx / L;
  const uz = dz / L;
  const nx = -uz;
  const nz = ux;
  const at = (t: number, side: number, y: number): V3 => [
    BRIDGE_START.x + dx * t + nx * side,
    y,
    BRIDGE_START.z + dz * t + nz * side,
  ];
  const DECK = 3.1;
  // 橋面
  b.box(
    [L, 0.28, 1.5],
    STEEL,
    [BRIDGE_START.x + dx / 2, DECK, BRIDGE_START.z + dz / 2],
    [0, -Math.atan2(dz, dx), 0],
  );
  // 橋墩
  const t1 = 0.28;
  const t2 = 0.72;
  const TOP = 7.4;
  for (const t of [t1, t2]) {
    for (const side of [-0.7, 0.7]) b.limb(at(t, side, 0), at(t, side, TOP), 0.2, 0.16, WHITE);
    b.limb(at(t, -0.7, TOP - 0.7), at(t, 0.7, TOP - 0.7), 0.1, 0.1, WHITE);
    b.limb(at(t, -0.7, DECK + 1.6), at(t, 0.7, DECK + 1.6), 0.1, 0.1, WHITE);
  }
  // 主纜：三段拋物線（岸邊錨點 → 塔 → 塔 → 錨點）
  const span = (
    ta: number,
    ya: number,
    tb: number,
    yb: number,
    sag: number,
    side: number,
  ): void => {
    const n = 9;
    let prev = at(ta, side, ya);
    for (let i = 1; i <= n; i++) {
      const s = i / n;
      const t = lerp(ta, tb, s);
      const y = lerp(ya, yb, s) - sag * 4 * s * (1 - s);
      const p = at(t, side, y);
      b.limb(prev, p, 0.05, 0.05, WHITE);
      if (i % 2 === 0 && i < n) b.limb(p, at(t, side, DECK + 0.14), 0.02, 0.02, WHITE);
      prev = p;
    }
  };
  for (const side of [-0.7, 0.7]) {
    span(0, DECK + 0.3, t1, TOP, 0.4, side);
    span(t1, TOP, t2, TOP, -2.6, side); // 負的下垂 = 向下凹（中跨主纜下垂）
    span(t2, TOP, 1, DECK + 0.3, 0.4, side);
  }
  const geo = b.merge([0, 0, 0]);
  if (!geo) throw new Error('bridge geometry empty');
  return geo;
}

/** 台場的摩天輪：輪框、輻條、車廂（以輪心為原點，會轉動）。 */
export function wheelGeometry(): BufferGeometry {
  const b = new Builder(6);
  const R = 3.1;
  const seg = 24;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    b.limb(
      [Math.cos(a0) * R, Math.sin(a0) * R, 0],
      [Math.cos(a1) * R, Math.sin(a1) * R, 0],
      0.07,
      0.07,
      WHITE,
    );
    b.limb(
      [Math.cos(a0) * R * 0.62, Math.sin(a0) * R * 0.62, 0],
      [Math.cos(a1) * R * 0.62, Math.sin(a1) * R * 0.62, 0],
      0.045,
      0.045,
      WHITE,
    );
  }
  const cars = ['#ff6fb5', '#ffd23f', '#4cc9f0', '#2ec27e', '#ff7a3d', '#b565e6'];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.limb([0, 0, 0], [Math.cos(a) * R, Math.sin(a) * R, 0], 0.035, 0.035, '#d9d9d9');
    b.box([0.5, 0.5, 0.5], cars[i % cars.length] ?? '#ffffff', [
      Math.cos(a) * (R + 0.35),
      Math.sin(a) * (R + 0.35) - 0.2,
      0,
    ]);
  }
  const geo = b.merge([0, 0, 0]);
  if (!geo) throw new Error('wheel geometry empty');
  return geo;
}

/** 摩天輪支架與台場的建築（電視台風格：兩根柱子托著一顆大球）。世界座標。 */
export function odaibaGeometry(): BufferGeometry {
  const b = new Builder(12);
  const W = FERRIS_WHEEL;
  const hubY = 3.9;
  for (const s of [-1, 1])
    b.limb([W.x + s * 1.9, 0.45, W.z - 0.4], [W.x, hubY, W.z], 0.14, 0.1, '#bfc5cc');
  for (const s of [-1, 1])
    b.limb([W.x + s * 1.9, 0.45, W.z + 0.4], [W.x, hubY, W.z], 0.14, 0.1, '#bfc5cc');
  // 電視台風格建築（兩座塔樓＋空中的球）放在島的西北緣，留出島中央給怪獸站位
  const T = { x: ODAIBA.x - 3.4, z: ODAIBA.z - 2.8 };
  b.box([1.0, 4.4, 1.2], '#b9c4d0', [T.x - 0.9, 2.65, T.z]);
  b.box([1.0, 4.4, 1.2], '#b9c4d0', [T.x + 0.9, 2.65, T.z]);
  b.box([2.8, 0.5, 1.2], '#9aa8b8', [T.x, 4.6, T.z]);
  b.ball(0.95, '#cfd8e2', [T.x, 5.6, T.z]);
  // 島南側的低矮建築
  b.box([1.8, 1.2, 1.4], '#d9cfbd', [ODAIBA.x + 2.9, 1.05, ODAIBA.z + 3.3]);
  b.box([1.6, 1.5, 1.3], '#c9b8a2', [ODAIBA.x - 0.4, 1.2, ODAIBA.z + 4.2]);
  const geo = b.merge([0, 0, 0]);
  if (!geo) throw new Error('odaiba geometry empty');
  return geo;
}

export function buildLandmarks(): Landmarks {
  const group = new Group();
  group.name = 'landmarks';
  const geometries: BufferGeometry[] = [];
  const material = new MeshLambertMaterial({ vertexColors: true });

  const add = (geo: BufferGeometry, x: number, y: number, z: number, cast = false): Mesh => {
    geometries.push(geo);
    const m = new Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = cast;
    group.add(m);
    return m;
  };

  add(towerGeometry(), TOKYO_TOWER.x, 0, TOKYO_TOWER.z, true);
  add(skytreeGeometry(), SKYTREE.x, 0, SKYTREE.z);
  add(bridgeGeometry(), 0, 0, 0);
  add(odaibaGeometry(), 0, 0, 0);
  const wheel = add(wheelGeometry(), FERRIS_WHEEL.x, 3.9, FERRIS_WHEEL.z);

  return {
    group,
    update: (t) => {
      wheel.rotation.z = -t * 0.12;
    },
    dispose: () => {
      for (const g of geometries) g.dispose();
      material.dispose();
      group.clear();
    },
    triangles: geometries.reduce(
      (n, g) => n + (g.getIndex()?.count ?? g.getAttribute('position').count) / 3,
      0,
    ),
  };
}
