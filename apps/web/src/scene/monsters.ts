import type { BufferGeometry } from 'three';
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  SphereGeometry,
  BoxGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAX_SEATS, seatColor } from './layout.js';
import { MONSTER_HEIGHT, MONSTER_SCALE } from './shots.js';

/**
 * 原創的程序化怪獸（沒有任何第三方模型）。六種造型，依座位固定：
 * 蜥蜴、巨猿、機甲、章魚外星人、巨蟹、飛龍。
 * 每隻怪獸合併成 5 個 mesh（身體、頭、左右臂、尾），共用一個頂點色材質，
 * 約 3–6k 三角形，遠低於 ADR-0003 的 15–25k 預算；各部位以樞軸分開，方便程序動畫。
 */

type V3 = [number, number, number];

interface Palette {
  main: string;
  dark: string;
  light: string;
  accent: string;
  eye: string;
}

interface Part {
  geo: BufferGeometry;
}

export class Builder {
  readonly parts: Part[] = [];
  constructor(private readonly seg: number) {}

  private add(geo: BufferGeometry, color: string, pos: V3, scale?: V3, rot?: V3): void {
    if (scale) geo.scale(...scale);
    if (rot) {
      geo.rotateX(rot[0]);
      geo.rotateY(rot[1]);
      geo.rotateZ(rot[2]);
    }
    geo.translate(...pos);
    const c = new Color(color);
    const n = geo.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    this.parts.push({ geo });
  }

  ball(r: number, color: string, pos: V3, scale: V3 = [1, 1, 1]): this {
    this.add(new SphereGeometry(r, this.seg, Math.max(6, this.seg - 4)), color, pos, scale);
    return this;
  }

  box(size: V3, color: string, pos: V3, rot?: V3): this {
    this.add(new BoxGeometry(...size), color, pos, undefined, rot);
    return this;
  }

  /** 從 a 到 b 的錐形圓柱（rA 在 a 端、rB 在 b 端）。 */
  limb(a: V3, b: V3, rA: number, rB: number, color: string): this {
    const dir = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = Math.max(0.001, dir.length());
    const geo = new CylinderGeometry(rB, rA, len, Math.max(6, this.seg - 2), 1);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    geo.applyQuaternion(q);
    geo.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.paint(geo, color);
    this.parts.push({ geo });
    return this;
  }

  /** 從 a（底）指向 b（尖）的圓錐。 */
  spike(a: V3, b: V3, r: number, color: string): this {
    const dir = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = Math.max(0.001, dir.length());
    const geo = new ConeGeometry(r, len, Math.max(5, this.seg - 4), 1);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    geo.applyQuaternion(q);
    geo.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.paint(geo, color);
    this.parts.push({ geo });
    return this;
  }

  private paint(geo: BufferGeometry, color: string): void {
    const c = new Color(color);
    const n = geo.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  }

  /** 把部位移到以 pivot 為原點，合併成單一幾何。 */
  merge(pivot: V3): BufferGeometry | null {
    if (this.parts.length === 0) return null;
    const geos = this.parts.map((p) => {
      const g = p.geo.clone();
      g.translate(-pivot[0], -pivot[1], -pivot[2]);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    for (const p of this.parts) p.geo.dispose();
    return merged;
  }
}

interface Spec {
  body: Builder;
  head: Builder;
  armL: Builder;
  armR: Builder;
  tail: Builder;
  pivots: { head: V3; armL: V3; armR: V3; tail: V3 };
}

const newSpec = (seg: number): Spec => ({
  body: new Builder(seg),
  head: new Builder(seg),
  armL: new Builder(seg),
  armR: new Builder(seg),
  tail: new Builder(seg),
  pivots: { head: [0, 3.5, 0.5], armL: [1, 3, 0], armR: [-1, 3, 0], tail: [0, 1.6, -0.7] },
});

/** 每種怪獸的名字（只是描述造型，不是任何既有角色）。 */
export const ARCHETYPE_NAMES = ['蜥蜴', '巨猿', '機甲', '章魚人', '巨蟹', '飛龍'] as const;

const PALETTES: Palette[] = [
  { main: '#4f9d5a', dark: '#2f6b3b', light: '#d6e8a8', accent: '#e4572e', eye: '#ffe14a' },
  { main: '#7b5a45', dark: '#4a3326', light: '#d9b48f', accent: '#3a86ff', eye: '#ffffff' },
  { main: '#9aa7b5', dark: '#4d5866', light: '#d8e0e8', accent: '#2ec27e', eye: '#7df9ff' },
  { main: '#8e5bc4', dark: '#58308c', light: '#e3c7f5', accent: '#ffbe0b', eye: '#fff7a8' },
  { main: '#d4533b', dark: '#8f2f20', light: '#f6c9a8', accent: '#b565e6', eye: '#ffffff' },
  { main: '#3d7fd0', dark: '#23508f', light: '#bfe0ff', accent: '#ff6fb5', eye: '#ffe14a' },
];

function lizard(s: Spec, p: Palette, accent: string): void {
  const { body, head, armL, armR, tail } = s;
  s.pivots = {
    head: [0, 3.55, 0.6],
    armL: [0.95, 2.9, 0.35],
    armR: [-0.95, 2.9, 0.35],
    tail: [0, 1.55, -0.6],
  };
  body
    .ball(1, p.main, [0, 2.35, 0], [1.05, 1.4, 0.95])
    .ball(0.8, p.light, [0, 2.15, 0.5], [0.8, 1.1, 0.55]);
  body.ball(0.9, p.main, [0, 1.55, -0.1], [1.05, 0.9, 0.95]);
  for (const sx of [0.62, -0.62]) {
    body.limb([sx, 1.6, 0], [sx * 1.1, 0.35, 0.1], 0.5, 0.4, p.dark);
    body.box([0.75, 0.28, 1.1], p.dark, [sx * 1.1, 0.14, 0.35]);
  }
  for (let i = 0; i < 5; i++) {
    const y = 3.2 - i * 0.38;
    const z = -0.55 - i * 0.22;
    body.spike([0, y - 0.1, z + 0.2], [0, y + 0.55, z - 0.35], 0.2 - i * 0.015, accent);
  }
  head
    .ball(0.64, p.main, [0, 3.65, 0.75], [0.95, 0.85, 1.1])
    .ball(0.46, p.main, [0, 3.45, 1.35], [0.9, 0.7, 1.2]);
  head.box([0.62, 0.16, 0.85], p.dark, [0, 3.12, 1.25]);
  for (const sx of [0.34, -0.34]) {
    head.ball(0.14, p.eye, [sx, 3.88, 1.12]).ball(0.07, '#111111', [sx, 3.88, 1.24]);
    head.spike([sx * 0.7, 4.1, 0.55], [sx * 1.1, 4.7, 0.2], 0.12, accent);
  }
  for (const sx of [0.25, 0.1, -0.1, -0.25])
    head.spike([sx, 3.2, 1.75], [sx, 3.0, 1.75], 0.05, '#ffffff');
  for (const [arm, sx] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    arm
      .limb([sx * 0.95, 2.9, 0.35], [sx * 1.15, 2.2, 0.95], 0.26, 0.2, p.main)
      .ball(0.24, p.main, [sx * 1.15, 2.15, 1.0]);
    arm.spike([sx * 1.15, 2.15, 1.05], [sx * 1.15, 1.95, 1.5], 0.09, '#fff7e0');
  }
  tail
    .limb([0, 1.55, -0.6], [0, 1.0, -2.3], 0.62, 0.3, p.main)
    .limb([0, 1.0, -2.3], [0, 0.7, -3.9], 0.3, 0.06, p.dark);
}

function ape(s: Spec, p: Palette, accent: string): void {
  const { body, head, armL, armR } = s;
  s.pivots = {
    head: [0, 4.0, 0.5],
    armL: [1.45, 3.15, 0],
    armR: [-1.45, 3.15, 0],
    tail: [0, 1.5, -0.7],
  };
  body
    .ball(1.1, p.main, [0, 2.7, 0], [1.5, 1.25, 1.0])
    .ball(0.8, p.light, [0, 2.6, 0.55], [1.0, 0.95, 0.5]);
  body.ball(0.85, p.main, [0, 1.65, 0], [1.2, 0.9, 0.95]);
  for (const sx of [0.7, -0.7]) {
    body.limb([sx, 1.7, 0], [sx * 1.1, 0.45, 0.15], 0.55, 0.5, p.dark);
    body.ball(0.55, p.dark, [sx * 1.1, 0.3, 0.3], [1, 0.55, 1.35]);
    body.ball(0.4, accent, [sx * 1.6, 3.35, -0.1], [1, 0.7, 1]);
  }
  // 頭抬高、往前，從背後與上方也看得到；背上有一排強調色的毛脊
  head
    .ball(0.7, p.main, [0, 4.15, 0.55], [1.05, 0.95, 1])
    .ball(0.46, p.light, [0, 3.98, 1.05], [1, 0.8, 0.6]);
  head.box([1.1, 0.18, 0.36], p.dark, [0, 4.4, 1.05]);
  for (const sx of [0.26, -0.26])
    head.ball(0.1, p.eye, [sx, 4.25, 1.17]).ball(0.05, '#111111', [sx, 4.25, 1.25]);
  for (let i = 0; i < 4; i++)
    body.spike(
      [0, 3.5 - i * 0.35, -0.75 - i * 0.12],
      [0, 4.1 - i * 0.35, -1.0 - i * 0.12],
      0.2,
      accent,
    );
  for (const [arm, sx] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    arm.limb([sx * 1.45, 3.15, 0], [sx * 2.0, 2.0, 0.35], 0.5, 0.42, p.main);
    arm.limb([sx * 2.0, 2.0, 0.35], [sx * 2.05, 0.95, 0.75], 0.42, 0.38, p.main);
    arm.ball(0.55, p.dark, [sx * 2.05, 0.8, 0.85]);
  }
}

function mech(s: Spec, p: Palette, accent: string): void {
  const { body, head, armL, armR, tail } = s;
  s.pivots = {
    head: [0, 3.9, 0.2],
    armL: [1.35, 3.3, 0],
    armR: [-1.35, 3.3, 0],
    tail: [0, 3.2, -0.8],
  };
  body.box([2.0, 1.7, 1.3], p.main, [0, 2.8, 0]).box([1.3, 0.9, 0.2], accent, [0, 2.9, 0.68]);
  body.box([1.5, 0.7, 1.0], p.dark, [0, 1.75, 0]);
  for (const sx of [0.6, -0.6]) {
    body
      .limb([sx, 1.5, 0], [sx, 0.55, 0.05], 0.36, 0.3, p.dark)
      .box([0.3, 0.9, 0.3], p.light, [sx, 1.0, 0.22]);
    body.box([0.9, 0.3, 1.3], p.dark, [sx, 0.15, 0.25]);
  }
  head.box([0.95, 0.7, 0.85], p.main, [0, 4.0, 0.2]).box([0.75, 0.2, 0.12], p.eye, [0, 4.05, 0.66]);
  head
    .limb([0.3, 4.3, 0.1], [0.45, 4.95, 0.0], 0.04, 0.04, p.dark)
    .ball(0.09, accent, [0.45, 5.0, 0]);
  for (const [arm, sx] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    arm.ball(0.5, p.dark, [sx * 1.35, 3.35, 0]);
    arm.box([0.55, 1.3, 0.55], p.main, [sx * 1.5, 2.55, 0.15]);
    arm.limb([sx * 1.5, 1.95, 0.2], [sx * 1.5, 1.7, 1.3], 0.22, 0.26, p.dark);
    arm.ball(0.12, accent, [sx * 1.5, 1.7, 1.35]);
  }
  tail
    .limb([0.45, 3.2, -0.8], [0.55, 4.1, -1.4], 0.14, 0.2, p.dark)
    .limb([-0.45, 3.2, -0.8], [-0.55, 4.1, -1.4], 0.14, 0.2, p.dark);
  tail.ball(0.2, accent, [0.55, 4.15, -1.45]).ball(0.2, accent, [-0.55, 4.15, -1.45]);
}

function octopus(s: Spec, p: Palette, accent: string): void {
  const { body, head, armL, armR, tail } = s;
  s.pivots = {
    head: [0, 3.0, 0.2],
    armL: [0.9, 2.5, 0.3],
    armR: [-0.9, 2.5, 0.3],
    tail: [0, 1.6, -0.5],
  };
  body.ball(0.95, p.main, [0, 2.2, 0], [1.0, 1.0, 0.9]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const out = 1.7;
    body.limb(
      [Math.cos(a) * 0.5, 1.7, Math.sin(a) * 0.45],
      [Math.cos(a) * out, 0.15, Math.sin(a) * out * 0.9],
      0.34,
      0.14,
      i % 2 === 0 ? p.main : p.dark,
    );
    body.ball(0.17, accent, [Math.cos(a) * out, 0.12, Math.sin(a) * out * 0.9]);
  }
  head.ball(1.3, p.main, [0, 3.7, 0.1], [1.0, 1.1, 1.0]);
  for (const sx of [0.55, -0.55]) {
    head
      .ball(0.42, '#ffffff', [sx, 3.75, 1.05])
      .ball(0.2, '#111111', [sx, 3.75, 1.38])
      .ball(0.08, p.eye, [sx + 0.05, 3.82, 1.53]);
  }
  for (let i = 0; i < 4; i++)
    head.ball(0.14, accent, [(i - 1.5) * 0.45, 4.7 - Math.abs(i - 1.5) * 0.3, 0.2]);
  for (const [arm, sx] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    arm
      .limb([sx * 0.9, 2.5, 0.3], [sx * 1.7, 2.2, 1.0], 0.3, 0.2, p.main)
      .limb([sx * 1.7, 2.2, 1.0], [sx * 1.9, 1.5, 1.9], 0.2, 0.08, p.dark);
  }
  tail
    .limb([0, 1.6, -0.5], [0, 1.1, -1.9], 0.32, 0.18, p.main)
    .limb([0, 1.1, -1.9], [0, 1.9, -2.7], 0.18, 0.06, p.dark);
}

function crab(s: Spec, p: Palette, accent: string): void {
  const { body, head, armL, armR, tail } = s;
  s.pivots = {
    head: [0, 3.0, 0.7],
    armL: [1.5, 2.5, 0.5],
    armR: [-1.5, 2.5, 0.5],
    tail: [0, 2.3, -1.0],
  };
  body
    .ball(1, p.main, [0, 2.25, 0], [1.9, 1.0, 1.4])
    .ball(0.9, p.light, [0, 1.95, 0.35], [1.5, 0.7, 1.1]);
  for (const sx of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const z = -0.7 + i * 0.7;
      body.limb([sx * 1.1, 1.9, z], [sx * 2.4, 1.2, z + 0.15], 0.17, 0.12, p.dark);
      body.limb([sx * 2.4, 1.2, z + 0.15], [sx * 2.7, 0.0, z + 0.2], 0.12, 0.07, p.dark);
    }
  }
  for (const sx of [0.5, -0.5]) {
    head
      .limb([sx, 2.9, 1.0], [sx * 1.1, 3.6, 1.15], 0.07, 0.07, p.dark)
      .ball(0.22, p.eye, [sx * 1.1, 3.7, 1.18])
      .ball(0.1, '#111111', [sx * 1.1, 3.72, 1.36]);
  }
  head.box([0.9, 0.22, 0.3], p.dark, [0, 2.65, 1.5]);
  for (const [arm, sx] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    arm.limb([sx * 1.5, 2.5, 0.5], [sx * 2.3, 2.5, 1.5], 0.34, 0.3, p.main);
    arm.ball(0.7, p.main, [sx * 2.4, 2.55, 1.9], [0.9, 0.8, 1.25]);
    arm.spike([sx * 2.4, 3.15, 1.9], [sx * 2.4, 3.15, 2.9], 0.3, p.main);
    arm.spike([sx * 2.4, 2.1, 1.9], [sx * 2.4, 2.1, 2.8], 0.22, p.dark);
  }
  for (let i = 0; i < 4; i++)
    tail.spike(
      [(i - 1.5) * 0.6, 3.05, -0.6 - Math.abs(i - 1.5) * 0.1],
      [(i - 1.5) * 0.7, 3.8, -0.9],
      0.2,
      accent,
    );
}

function dragon(s: Spec, p: Palette, accent: string): void {
  const { body, head, armL, armR, tail } = s;
  s.pivots = {
    head: [0, 4.2, 1.2],
    armL: [0.7, 3.2, -0.1],
    armR: [-0.7, 3.2, -0.1],
    tail: [0, 1.7, -0.9],
  };
  body
    .ball(1, p.main, [0, 2.4, 0], [0.95, 1.2, 1.15])
    .ball(0.75, p.light, [0, 2.3, 0.55], [0.7, 1.0, 0.5]);
  body.limb([0, 3.0, 0.3], [0, 3.9, 0.9], 0.55, 0.35, p.main);
  for (const sx of [0.6, -0.6]) {
    body
      .limb([sx, 1.9, -0.2], [sx * 1.2, 1.0, -0.5], 0.46, 0.3, p.dark)
      .limb([sx * 1.2, 1.0, -0.5], [sx * 1.1, 0.2, 0.2], 0.3, 0.2, p.dark);
    body.box([0.6, 0.2, 0.9], p.dark, [sx * 1.1, 0.1, 0.5]);
  }
  for (let i = 0; i < 4; i++)
    body.spike(
      [0, 3.1 - i * 0.3, -0.5 - i * 0.2],
      [0, 3.6 - i * 0.3, -0.8 - i * 0.2],
      0.14,
      accent,
    );
  head
    .ball(0.5, p.main, [0, 4.25, 1.25], [0.9, 0.85, 1.15])
    .ball(0.34, p.main, [0, 4.1, 1.85], [0.85, 0.7, 1.25]);
  for (const sx of [0.28, -0.28]) {
    head.ball(0.1, p.eye, [sx, 4.4, 1.5]).ball(0.05, '#111111', [sx, 4.4, 1.58]);
    head.spike([sx * 0.8, 4.55, 1.0], [sx * 1.4, 5.1, 0.35], 0.1, accent);
  }
  for (const [arm, sx] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    // 翅膀：扁平的三角翼，繞肩膀樞軸拍動
    arm.limb([sx * 0.7, 3.2, -0.1], [sx * 2.8, 4.1, -0.5], 0.14, 0.1, p.dark);
    arm.box([2.2, 0.06, 1.6], accent, [sx * 1.9, 3.75, -0.4], [0, 0, sx * 0.3]);
    arm.box([1.2, 0.06, 1.0], p.light, [sx * 1.3, 3.55, 0.3], [0, 0, sx * 0.25]);
  }
  tail
    .limb([0, 1.7, -0.9], [0, 1.2, -2.6], 0.55, 0.3, p.main)
    .limb([0, 1.2, -2.6], [0, 1.0, -4.2], 0.3, 0.1, p.dark);
  tail.spike([0, 1.0, -4.1], [0, 1.0, -5.0], 0.22, accent);
}

const BUILDERS = [lizard, ape, mech, octopus, crab, dragon] as const;

export interface MonsterRig {
  root: Group;
  body: Group;
  head: Group;
  armL: Group;
  armR: Group;
  tail: Group;
  material: MeshLambertMaterial;
  archetype: number;
  /** 標籤等 UI 掛載的高度。 */
  height: number;
  setShadows: (on: boolean) => void;
  dispose: () => void;
}

export function archetypeOf(seat: number): number {
  return ((seat % MAX_SEATS) + MAX_SEATS) % MAX_SEATS;
}

/** 依座位建出一隻怪獸（造型固定，強調色是座位顏色）。 */
export function buildMonster(seat: number, segments: number): MonsterRig {
  const archetype = archetypeOf(seat);
  const palette = PALETTES[archetype] ?? PALETTES[0]!;
  const accent = seatColor(seat);
  const spec = newSpec(segments);
  (BUILDERS[archetype] ?? lizard)(spec, palette, accent);

  const material = new MeshLambertMaterial({ vertexColors: true });
  const geometries: BufferGeometry[] = [];
  const root = new Group();
  root.name = `monster-${String(seat)}`;
  root.scale.setScalar(MONSTER_SCALE);
  const body = new Group();
  root.add(body);

  const makePart = (builder: Builder, pivot: V3, parent: Group): Group => {
    const g = new Group();
    g.position.set(...pivot);
    const geo = builder.merge(pivot);
    if (geo) {
      geometries.push(geo);
      g.add(new Mesh(geo, material));
    }
    parent.add(g);
    return g;
  };

  // 只有身體網格投射陰影（陰影 pass 的 draw call 預算：每隻怪獸 1 次）
  let shadowMesh: Mesh | null = null;
  const bodyGeo = spec.body.merge([0, 0, 0]);
  if (bodyGeo) {
    geometries.push(bodyGeo);
    shadowMesh = new Mesh(bodyGeo, material);
    shadowMesh.castShadow = true;
    body.add(shadowMesh);
  }
  const head = makePart(spec.head, spec.pivots.head, body);
  const armL = makePart(spec.armL, spec.pivots.armL, body);
  const armR = makePart(spec.armR, spec.pivots.armR, body);
  const tail = makePart(spec.tail, spec.pivots.tail, body);

  return {
    root,
    body,
    head,
    armL,
    armR,
    tail,
    material,
    archetype,
    height: MONSTER_HEIGHT,
    setShadows: (on) => {
      if (shadowMesh) shadowMesh.castShadow = on;
    },
    dispose: () => {
      for (const g of geometries) g.dispose();
      material.dispose();
    },
  };
}
