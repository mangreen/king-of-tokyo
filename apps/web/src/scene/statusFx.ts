import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Points,
  ShaderMaterial,
  type Texture,
} from 'three';
import { makeSoftDotTexture } from './textures.js';

/**
 * 持續性狀態的 3D 特效（狀態驅動：只要怪獸身上有指示物就一直演，指示物消失就停）。
 *
 * - 中毒（poison）：紫綠色毒霧從腳下升起、繞著怪獸打轉，帶一點冒泡；怪獸身體紫綠閃爍（見 poisonGlow）。
 *   指示物越多，霧越濃。
 * - 縮小（shrink）：青白色光點從四周往怪獸中心收縮（縮小光線的感覺）；怪獸本身縮小（見 shrinkScale）。
 *
 * 粒子位置全部由「時間＋粒子編號」直接算出（不存每顆粒子的狀態），所以不需要發射器、
 * 也不會因為暫停／切換分頁而累積；數量固定、一次 draw call 一種。原創程式繪製，沒有外部素材。
 */

export interface StatusTarget {
  seat: number;
  x: number;
  z: number;
  /** 怪獸目前的高度（已含縮小）。 */
  height: number;
  poison: number;
  shrink: number;
}

export interface Particle {
  /** 相對於怪獸腳下位置的偏移。 */
  x: number;
  y: number;
  z: number;
  size: number;
  alpha: number;
  /** 0..1：在兩個顏色之間的位置。 */
  tone: number;
}

/** 每隻怪獸的粒子上限（中毒／縮小各一組）。 */
export const POISON_MAX = 64;
export const SHRINK_MAX = 26;
/** 指示物越多越濃，但有上限。 */
export const poisonCount = (tokens: number): number =>
  tokens <= 0 ? 0 : Math.min(POISON_MAX, 30 + 11 * Math.min(tokens, 3));
export const shrinkCount = (tokens: number): number =>
  tokens <= 0 ? 0 : Math.min(SHRINK_MAX, 12 + 7 * Math.min(tokens, 2));

/** 縮小後的大小倍率：有縮小指示物就是原來的一半（0.5×），與指示物數量無關。 */
export const SHRINK_SCALE = 0.5;
export const shrinkScale = (tokens: number): number => (tokens > 0 ? SHRINK_SCALE : 1);

/** 中毒時身體的閃爍強度（0..1）：快慢兩個頻率疊起來，忽明忽暗。 */
export function poisonGlow(time: number): number {
  const v = 0.5 + 0.5 * Math.sin(time * 9.5) * Math.sin(time * 3.1 + 1.3);
  return Math.min(1, Math.max(0, 0.25 + 0.75 * v));
}

/** 確定性的雜湊（0..1）：同一顆粒子永遠得到同一組隨機值。 */
export function hash(i: number, salt: number): number {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 毒霧：從腳下升到頭頂上方，繞著身體轉，邊升邊散開、淡入淡出。
 * 三種粒子：大塊的紫色霧團（貼著身體、慢慢飄，撐出「被毒霧包住」的輪廓）、
 * 一般的綠色毒煙、少數亮亮的小氣泡。
 */
export function poisonParticle(i: number, time: number, height: number): Particle {
  const speed = 0.28 + 0.2 * hash(i, 1);
  const u = (time * speed + hash(i, 2)) % 1; // 這顆粒子的一生 0→1
  const angle = hash(i, 3) * Math.PI * 2 + time * (0.7 + hash(i, 4)) * (hash(i, 5) > 0.5 ? 1 : -1);
  const kind = hash(i, 7);
  if (kind > 0.8) {
    // 小氣泡
    const radius = (0.9 + 1.1 * hash(i, 6)) * (0.8 + 0.5 * u);
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      y: 0.15 + u * height * 1.25 + 0.2 * Math.sin(time * 2 + i),
      size: 0.8 + 0.6 * hash(i, 8),
      alpha: Math.sin(Math.PI * u) * 0.95,
      tone: 0.05,
    };
  }
  if (kind > 0.45) {
    // 霧團：大、半透明、偏紫，貼著身體慢慢升
    const radius = 0.5 + 0.9 * hash(i, 6);
    return {
      x: Math.cos(angle * 0.4) * radius,
      z: Math.sin(angle * 0.4) * radius,
      y: 0.3 + height * (0.15 + 0.7 * u),
      size: 4.2 + 2.4 * hash(i, 8),
      alpha: Math.sin(Math.PI * u) * 0.38,
      tone: 0.75 + 0.25 * hash(i, 9),
    };
  }
  // 毒煙
  const radius = (0.9 + 1.1 * hash(i, 6)) * (0.8 + 0.5 * u);
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    y: 0.15 + u * height + 0.2 * Math.sin(time * 2 + i),
    size: 2.4 + 2.0 * hash(i, 8) * (0.6 + 0.8 * u),
    alpha: Math.sin(Math.PI * u) * 0.7,
    tone: 0.5 * hash(i, 9),
  };
}

/** 縮小光點：從外圍盤旋著收向怪獸的胸口，越近越小越亮。 */
export function shrinkParticle(i: number, time: number, height: number): Particle {
  const u = (time * (0.45 + 0.3 * hash(i, 1)) + hash(i, 2)) % 1;
  const k = 1 - u; // 1＝外圍，0＝中心
  const angle = hash(i, 3) * Math.PI * 2 + time * 2.4 + u * 5;
  const radius = 0.5 + 2.3 * k * (0.7 + 0.3 * hash(i, 4));
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    y: height * (0.5 + 0.35 * k * (hash(i, 5) - 0.3)) + 0.3,
    size: 0.35 + 0.55 * k + 0.15 * hash(i, 6),
    alpha: Math.min(1, u * 4) * Math.min(1, (1 - u) * 3 + 0.25),
    tone: hash(i, 7),
  };
}

const VERT = /* glsl */ `
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
const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor, t.a * vAlpha);
  }
`;

class Layer {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly color: Float32Array;
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private used = 0;

  constructor(
    readonly capacity: number,
    texture: Texture,
    additive: boolean,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
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
    this.geometry.setAttribute(
      'aColor',
      new BufferAttribute(this.color, 3).setUsage(DynamicDrawUsage),
    );
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: texture }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      ...(additive ? { blending: AdditiveBlending } : {}),
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.visible = false;
  }

  begin(): void {
    this.used = 0;
  }

  push(x: number, y: number, z: number, p: Particle, a: Color, b: Color, alphaMul: number): void {
    if (this.used >= this.capacity) return;
    const i = this.used++;
    this.pos[i * 3] = x + p.x;
    this.pos[i * 3 + 1] = y + p.y;
    this.pos[i * 3 + 2] = z + p.z;
    this.size[i] = p.size;
    this.alpha[i] = Math.max(0, Math.min(1, p.alpha * alphaMul));
    this.color[i * 3] = a.r + (b.r - a.r) * p.tone;
    this.color[i * 3 + 1] = a.g + (b.g - a.g) * p.tone;
    this.color[i * 3 + 2] = a.b + (b.b - a.b) * p.tone;
  }

  end(): void {
    for (let i = this.used; i < this.capacity; i++) this.alpha[i] = 0;
    this.geometry.setDrawRange(0, Math.max(1, this.used));
    for (const name of ['position', 'aSize', 'aAlpha', 'aColor'] as const) {
      (this.geometry.getAttribute(name) as BufferAttribute).needsUpdate = true;
    }
    this.points.visible = this.used > 0;
  }

  setViewScale(px: number): void {
    (this.material.uniforms['uScale'] as { value: number }).value = px;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

const GREEN = new Color('#7dff4a');
const PURPLE = new Color('#a24dff');
const ICE = new Color('#bff4ff');
const WHITE = new Color('#ffffff');

/** 所有怪獸的狀態特效（毒霧一層、縮小光點一層）。 */
export class StatusFxSystem {
  readonly group = new Group();
  private readonly fog: Layer;
  private readonly sparks: Layer;
  private readonly texture: Texture;

  constructor(seats = 6) {
    this.texture = makeSoftDotTexture();
    this.fog = new Layer(seats * POISON_MAX, this.texture, false);
    this.sparks = new Layer(seats * SHRINK_MAX, this.texture, true);
    this.group.add(this.fog.points, this.sparks.points);
  }

  /** 每格呼叫：targets＝目前有指示物的怪獸（沒有就傳空陣列）。 */
  update(time: number, targets: readonly StatusTarget[]): void {
    this.fog.begin();
    this.sparks.begin();
    const glow = poisonGlow(time);
    for (const t of targets) {
      const np = poisonCount(t.poison);
      for (let i = 0; i < np; i++) {
        this.fog.push(
          t.x,
          0,
          t.z,
          poisonParticle(i + t.seat * 97, time, t.height),
          GREEN,
          PURPLE,
          0.7 + 0.3 * glow,
        );
      }
      const ns = shrinkCount(t.shrink);
      for (let i = 0; i < ns; i++) {
        this.sparks.push(
          t.x,
          0,
          t.z,
          shrinkParticle(i + t.seat * 53, time, t.height),
          ICE,
          WHITE,
          1,
        );
      }
    }
    this.fog.end();
    this.sparks.end();
  }

  setViewScale(px: number): void {
    this.fog.setViewScale(px);
    this.sparks.setViewScale(px);
  }

  clear(): void {
    this.update(0, []);
  }

  dispose(): void {
    this.fog.dispose();
    this.sparks.dispose();
    this.texture.dispose();
  }
}

/** 震地暈眩的晃動（弧度／世界單位）：身體左右搖晃、前後點頭，再疊一層細小的顫抖。 */
export interface DizzySway {
  /** 左右傾斜（繞前後軸）。 */
  roll: number;
  /** 前後點頭。 */
  pitch: number;
  /** 水平位移（腳步不穩）。 */
  shift: number;
}

export const DIZZY_ROLL = 0.16;

/** amount＝0..1（淡入淡出）；time 單位秒；phase 讓每隻怪獸不同步。 */
export function dizzySway(time: number, amount: number): DizzySway {
  const slow = Math.sin(time * 3.2);
  const tremble = Math.sin(time * 21) * Math.sin(time * 6.3);
  return {
    roll: amount * (DIZZY_ROLL * slow + 0.025 * tremble),
    pitch: amount * (0.07 * Math.sin(time * 2.3 + 1.1) + 0.015 * tremble),
    shift: amount * 0.07 * Math.sin(time * 3.2 + 0.6),
  };
}
