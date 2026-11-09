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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

export interface Spec {
  body: Builder;
  head: Builder;
  armL: Builder;
  armR: Builder;
  tail: Builder;
  pivots: { head: V3; armL: V3; armR: V3; tail: V3 };
}

export const newSpec = (seg: number): Spec => ({
  body: new Builder(seg),
  head: new Builder(seg),
  armL: new Builder(seg),
  armR: new Builder(seg),
  tail: new Builder(seg),
  pivots: { head: [0, 3.5, 0.5], armL: [1, 3, 0], armR: [-1, 3, 0], tail: [0, 1.6, -0.7] },
});
