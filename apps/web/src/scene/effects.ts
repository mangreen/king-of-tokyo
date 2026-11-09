import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Group,
  type Texture,
} from 'three';
import { makeCrackTexture, makeSoftDotTexture } from './textures.js';

/**
 * 特效：煙塵（單一 Points，一次 draw call）、碎片（單一 InstancedMesh，簡易彈道）、
 * 衝擊環、地裂貼花、六角護盾。全部有數量上限，由畫質分級決定（ADR-0003）。
 * 不使用物理引擎；沒有後處理。
 */

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

// ── 煙塵 ───────────────────────────────────────────

const DUST_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const DUST_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor, t.a * vAlpha);
  }
`;

export interface DustOptions {
  count: number;
  /** 水平擴散速度。 */
  spread?: number;
  /** 向上速度。 */
  up?: number;
  size?: number;
  color?: string;
  life?: number;
  /** 起始位置的隨機半徑。 */
  radius?: number;
}

export class DustSystem {
  readonly points: Points;
  private readonly capacity: number;
  private cap: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly color: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private cursor = 0;
  private readonly material: ShaderMaterial;
  private readonly texture: Texture;
  private readonly geometry: BufferGeometry;
  private live = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'aSize',
      new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'aAlpha',
      new BufferAttribute(this.alpha, 1).setUsage(DynamicDrawUsage),
    );
    this.geometry.setAttribute('aColor', new BufferAttribute(this.color, 3));
    this.texture = makeSoftDotTexture();
    this.material = new ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: { uMap: { value: this.texture }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
  }

  /** 畫質降級時調低同時存在的粒子上限。 */
  setCapacity(n: number): void {
    this.cap = Math.max(1, Math.min(this.capacity, n));
    if (this.cursor >= this.cap) this.cursor = 0;
    for (let i = this.cap; i < this.capacity; i++) {
      this.life[i] = 0;
      this.alpha[i] = 0;
    }
    (this.geometry.getAttribute('aAlpha') as BufferAttribute).needsUpdate = true;
  }

  setViewScale(pixelsPerUnit: number): void {
    (this.material.uniforms['uScale'] as { value: number }).value = pixelsPerUnit;
  }

  emit(x: number, y: number, z: number, o: DustOptions): void {
    const c = new Color(o.color ?? '#d8cdb8');
    for (let n = 0; n < o.count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.cap;
      const a = Math.random() * Math.PI * 2;
      const sp = (o.spread ?? 3) * rand(0.4, 1);
      const r = (o.radius ?? 0.4) * Math.random();
      this.pos[i * 3] = x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z + Math.sin(a) * r;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = (o.up ?? 1.5) * rand(0.5, 1.2);
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      this.color[i * 3] = c.r;
      this.color[i * 3 + 1] = c.g;
      this.color[i * 3 + 2] = c.b;
      this.baseSize[i] = (o.size ?? 2.2) * rand(0.7, 1.3);
      this.life[i] = this.maxLife[i] = (o.life ?? 1.1) * rand(0.7, 1.2);
    }
    (this.geometry.getAttribute('aColor') as BufferAttribute).needsUpdate = true;
    this.points.visible = true;
  }

  update(dt: number): void {
    if (!this.points.visible) return;
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      const l = this.life[i] ?? 0;
      if (l <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      live++;
      const nl = l - dt;
      this.life[i] = nl;
      const k = Math.max(0, nl / (this.maxLife[i] ?? 1)); // 1 → 0
      const drag = Math.exp(-2.2 * dt);
      this.vel[i * 3] = (this.vel[i * 3] ?? 0) * drag;
      this.vel[i * 3 + 1] = (this.vel[i * 3 + 1] ?? 0) * drag;
      this.vel[i * 3 + 2] = (this.vel[i * 3 + 2] ?? 0) * drag;
      this.pos[i * 3] = (this.pos[i * 3] ?? 0) + (this.vel[i * 3] ?? 0) * dt;
      this.pos[i * 3 + 1] = (this.pos[i * 3 + 1] ?? 0) + (this.vel[i * 3 + 1] ?? 0) * dt;
      this.pos[i * 3 + 2] = (this.pos[i * 3 + 2] ?? 0) + (this.vel[i * 3 + 2] ?? 0) * dt;
      this.size[i] = (this.baseSize[i] ?? 1) * (1.6 - k * 0.6);
      this.alpha[i] = Math.min(0.75, k * 1.2);
    }
    this.live = live;
    for (const name of ['position', 'aSize', 'aAlpha'] as const) {
      (this.geometry.getAttribute(name) as BufferAttribute).needsUpdate = true;
    }
    if (live === 0) this.points.visible = false;
  }

  get activeCount(): number {
    return this.live;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

// ── 碎片 ───────────────────────────────────────────

const GRAVITY = -20;

export class DebrisSystem {
  readonly mesh: InstancedMesh;
  private readonly capacity: number;
  private cap: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private cursor = 0;
  private live = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly euler = new Euler();
  private readonly geometry = new BoxGeometry(0.34, 0.34, 0.34);
  private readonly material = new MeshLambertMaterial({ color: '#ffffff' });

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.rot = new Float32Array(capacity * 3);
    this.spin = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.mesh = new InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    const white = new Color('#ffffff');
    for (let i = 0; i < capacity; i++) {
      this.mesh.setColorAt(i, white);
      this.hide(i);
    }
  }

  setCapacity(n: number): void {
    this.cap = Math.max(1, Math.min(this.capacity, n));
    if (this.cursor >= this.cap) this.cursor = 0;
    for (let i = this.cap; i < this.capacity; i++) {
      this.life[i] = 0;
      this.hide(i);
    }
  }

  private hide(i: number): void {
    this.m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, this.m);
  }

  /** 從一點炸出碎片；colors 隨機取色（建築灰、怪獸色…）。 */
  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    force: number,
    colors: readonly string[],
  ): void {
    const tmp = new Color();
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.cap;
      const a = Math.random() * Math.PI * 2;
      const sp = force * rand(0.4, 1);
      this.pos.set([x + Math.cos(a) * 0.4, y, z + Math.sin(a) * 0.4], i * 3);
      this.vel.set([Math.cos(a) * sp, force * rand(0.6, 1.4), Math.sin(a) * sp], i * 3);
      this.rot.set([rand(0, 6), rand(0, 6), rand(0, 6)], i * 3);
      this.spin.set([rand(-9, 9), rand(-9, 9), rand(-9, 9)], i * 3);
      this.size[i] = rand(0.5, 1.5);
      this.life[i] = rand(1.2, 2.0);
      tmp.set(colors[Math.floor(Math.random() * colors.length)] ?? '#999999');
      this.mesh.setColorAt(i, tmp);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = true;
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      const l = this.life[i] ?? 0;
      if (l <= 0) continue;
      live++;
      const nl = l - dt;
      this.life[i] = nl;
      if (nl <= 0) {
        this.hide(i);
        continue;
      }
      let vy = (this.vel[i * 3 + 1] ?? 0) + GRAVITY * dt;
      let y = (this.pos[i * 3 + 1] ?? 0) + vy * dt;
      if (y < 0.15) {
        y = 0.15;
        vy = Math.abs(vy) * 0.3;
        this.vel[i * 3] = (this.vel[i * 3] ?? 0) * 0.6;
        this.vel[i * 3 + 2] = (this.vel[i * 3 + 2] ?? 0) * 0.6;
      }
      this.vel[i * 3 + 1] = vy;
      this.pos[i * 3] = (this.pos[i * 3] ?? 0) + (this.vel[i * 3] ?? 0) * dt;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = (this.pos[i * 3 + 2] ?? 0) + (this.vel[i * 3 + 2] ?? 0) * dt;
      for (let k = 0; k < 3; k++) {
        this.rot[i * 3 + k] = (this.rot[i * 3 + k] ?? 0) + (this.spin[i * 3 + k] ?? 0) * dt;
      }
      this.euler.set(this.rot[i * 3] ?? 0, this.rot[i * 3 + 1] ?? 0, this.rot[i * 3 + 2] ?? 0);
      this.q.setFromEuler(this.euler);
      const sc = (this.size[i] ?? 1) * Math.min(1, nl * 2.5);
      this.p.set(this.pos[i * 3] ?? 0, y, this.pos[i * 3 + 2] ?? 0);
      this.s.set(sc, sc, sc);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.live = live;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (live === 0) this.mesh.visible = false;
  }

  get activeCount(): number {
    return this.live;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

// ── 衝擊環與地裂 ────────────────────────────────────

interface Ring {
  mesh: Mesh;
  t: number;
  dur: number;
  maxR: number;
}

export class ShockwaveSystem {
  private readonly rings: Ring[] = [];
  private readonly geometry = new RingGeometry(0.82, 1, 48);

  constructor(parent: Group, size = 5) {
    for (let i = 0; i < size; i++) {
      const mat = new MeshBasicMaterial({
        color: '#fff3c4',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(this.geometry, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 4;
      parent.add(mesh);
      this.rings.push({ mesh, t: 0, dur: 1, maxR: 1 });
    }
  }

  fire(x: number, z: number, maxR: number, color = '#fff3c4', dur = 0.55): void {
    const r = this.rings.find((q) => !q.mesh.visible) ?? this.rings[0];
    if (!r) return;
    r.t = 0;
    r.dur = dur;
    r.maxR = maxR;
    r.mesh.position.set(x, 0.12, z);
    (r.mesh.material as MeshBasicMaterial).color.set(color);
    r.mesh.visible = true;
  }

  update(dt: number): void {
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - (1 - k) * (1 - k);
      r.mesh.scale.setScalar(Math.max(0.01, e * r.maxR));
      (r.mesh.material as MeshBasicMaterial).opacity = 0.85 * (1 - k);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const r of this.rings) (r.mesh.material as MeshBasicMaterial).dispose();
  }
}

export class CrackSystem {
  private readonly items: { mesh: Mesh; age: number }[] = [];
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly texture = makeCrackTexture();
  private next = 0;

  constructor(parent: Group, size = 4) {
    for (let i = 0; i < size; i++) {
      const mat = new MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new Mesh(this.geometry, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 2;
      parent.add(mesh);
      this.items.push({ mesh, age: 0 });
    }
  }

  stamp(x: number, z: number, size: number): void {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    if (!it) return;
    it.age = 0;
    it.mesh.position.set(x, 0.07, z);
    it.mesh.scale.setScalar(size);
    it.mesh.rotation.z = Math.random() * Math.PI * 2;
    it.mesh.visible = true;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.age += dt;
      const life = 9;
      const k = it.age / life;
      if (k >= 1) {
        it.mesh.visible = false;
        continue;
      }
      (it.mesh.material as MeshBasicMaterial).opacity =
        k < 0.8 ? 0.85 : 0.85 * (1 - (k - 0.8) / 0.2);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.texture.dispose();
    for (const it of this.items) (it.mesh.material as MeshBasicMaterial).dispose();
  }
}

// ── 六角護盾 ───────────────────────────────────────

const SHIELD_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const SHIELD_FRAG = /* glsl */ `
  uniform float uFade;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, normalize(vec2(1.0, 1.73))), p.x);
  }
  void main() {
    vec2 uv = vUv * vec2(18.0, 9.0);
    vec2 r = vec2(1.0, 1.73);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    float edge = smoothstep(0.38, 0.48, hexDist(gv));
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
    float a2 = (0.18 + edge * 0.7 + fres * 0.6) * uFade;
    gl_FragColor = vec4(uColor, a2);
  }
`;

export class ShieldSystem {
  private readonly geometry = new SphereGeometry(1, 24, 14);
  private readonly shields: { mesh: Mesh; t: number; follow: { x: number; z: number } }[] = [];

  constructor(parent: Group, size = 3) {
    for (let i = 0; i < size; i++) {
      const mat = new ShaderMaterial({
        vertexShader: SHIELD_VERT,
        fragmentShader: SHIELD_FRAG,
        uniforms: { uFade: { value: 0 }, uColor: { value: new Color('#7de3ff') } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
      const mesh = new Mesh(this.geometry, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      parent.add(mesh);
      this.shields.push({ mesh, t: 0, follow: { x: 0, z: 0 } });
    }
  }

  pop(x: number, z: number, radius = 2.8): void {
    const s = this.shields.find((q) => !q.mesh.visible) ?? this.shields[0];
    if (!s) return;
    s.t = 0;
    s.mesh.position.set(x, 2.1, z);
    s.mesh.scale.setScalar(radius);
    s.mesh.visible = true;
  }

  update(dt: number): void {
    for (const s of this.shields) {
      if (!s.mesh.visible) continue;
      s.t += dt;
      const dur = 0.75;
      const k = s.t / dur;
      if (k >= 1) {
        s.mesh.visible = false;
        continue;
      }
      const u = (s.mesh.material as ShaderMaterial).uniforms['uFade'] as { value: number };
      u.value = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      s.mesh.rotation.y += dt * 1.2;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const s of this.shields) (s.mesh.material as ShaderMaterial).dispose();
  }
}
