import type { BufferGeometry } from 'three';
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** 程序化怪獸的共用積木：把球、方塊、錐形圓柱、尖刺合併成少數幾個 mesh。 */

export type V3 = [number, number, number];

export interface Palette {
  main: string;
  dark: string;
  light: string;
  accent: string;
  eye: string;
}

interface Part {
  geo: BufferGeometry;
}

/** 依位置算出的雜訊（0..1）：同一個位置永遠得到同一個值，所以接縫處的頂點不會裂開。 */
export function posNoise(x: number, y: number, z: number, freq = 1): number {
  const qx = Math.round(x * freq * 40);
  const qy = Math.round(y * freq * 40);
  const qz = Math.round(z * freq * 40);
  const h = Math.sin(qx * 12.9898 + qy * 78.233 + qz * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * 風化凹凸：把頂點沿著「從中心往外」的方向前後位移（粗細兩層雜訊疊加），
 * 並依位移量讓顏色略深／略淺（凹處暗、凸處亮），做出風化岩石的質感。
 * amount：位移量（相對於幾何本身的大小，0.1 ≈ 凹凸起伏約 10%）。
 */
export function roughen(geo: BufferGeometry, amount: number, color: string): BufferGeometry {
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const merged = mergeVertices(geo, 1e-4); // 先把接縫的重複頂點併起來，位移後才不會裂開
  geo.dispose();
  const pos = merged.getAttribute('position');
  const n = pos.count;
  let extent = 0;
  for (let i = 0; i < n; i++)
    extent = Math.max(extent, Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
  const base = new Color(color);
  const colors = new Float32Array(n * 3);
  const tmp = new Vector3();
  for (let i = 0; i < n; i++) {
    tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const coarse = posNoise(tmp.x, tmp.y, tmp.z, 1.7 / Math.max(extent, 0.3));
    const fine = posNoise(tmp.x, tmp.y, tmp.z, 4.1 / Math.max(extent, 0.3));
    const d = (coarse - 0.5) * 0.7 + (fine - 0.5) * 0.3; // -0.5..0.5
    const len = tmp.length();
    if (len > 1e-6) tmp.multiplyScalar(1 + (d * 2 * amount * extent) / len);
    pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
    const shade = 1 + d * 0.8; // 凸處亮、凹處暗
    colors[i * 3] = Math.min(1, base.r * shade);
    colors[i * 3 + 1] = Math.min(1, base.g * shade);
    colors[i * 3 + 2] = Math.min(1, base.b * shade);
  }
  merged.setAttribute('color', new Float32BufferAttribute(colors, 3));
  merged.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
  merged.computeVertexNormals();
  return merged;
}

export class Builder {
  readonly parts: Part[] = [];
  /** 風化凹凸程度（0＝光滑；>0 時之後加入的球與方塊會帶凹凸與深淺變化）。 */
  rough = 0;
  constructor(private readonly seg: number) {}

  private add(
    geo: BufferGeometry,
    color: string,
    pos: V3,
    scale?: V3,
    rot?: V3,
    painted = false,
  ): void {
    if (scale) geo.scale(...scale);
    if (rot) {
      geo.rotateX(rot[0]);
      geo.rotateY(rot[1]);
      geo.rotateZ(rot[2]);
    }
    geo.translate(...pos);
    if (!painted) this.paint(geo, color);
    this.parts.push({ geo });
  }

  ball(r: number, color: string, pos: V3, scale: V3 = [1, 1, 1]): this {
    const geo = new SphereGeometry(r, this.seg, Math.max(6, this.seg - 4));
    this.add(
      this.rough > 0 ? roughen(geo, this.rough, color) : geo,
      color,
      pos,
      scale,
      undefined,
      this.rough > 0,
    );
    return this;
  }

  box(size: V3, color: string, pos: V3, rot?: V3): this {
    let geo: BufferGeometry;
    if (this.rough > 0) {
      // 面要多切幾格，位移之後才有凹凸可言
      const seg = (d: number): number => Math.max(1, Math.min(4, Math.round(d / 0.45)));
      geo = roughen(
        new BoxGeometry(...size, seg(size[0]), seg(size[1]), seg(size[2])),
        this.rough,
        color,
      );
    } else {
      geo = new BoxGeometry(...size);
    }
    this.add(geo, color, pos, undefined, rot, this.rough > 0);
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

export interface Spec {
  body: Builder;
  head: Builder;
  armL: Builder;
  armR: Builder;
  tail: Builder;
  /** 翅膀（只有會飛的怪獸有；左右各一個部位，繞肩膀／翅根拍動）。 */
  wingL: Builder;
  wingR: Builder;
  pivots: { head: V3; armL: V3; armR: V3; tail: V3; wingL?: V3; wingR?: V3 };
}

export const newSpec = (seg: number): Spec => ({
  body: new Builder(seg),
  head: new Builder(seg),
  armL: new Builder(seg),
  armR: new Builder(seg),
  tail: new Builder(seg),
  wingL: new Builder(seg),
  wingR: new Builder(seg),
  pivots: { head: [0, 3.5, 0.5], armL: [1, 3, 0], armR: [-1, 3, 0], tail: [0, 1.6, -0.7] },
});
