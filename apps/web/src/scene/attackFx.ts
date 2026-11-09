import type { BufferGeometry, Group } from 'three';
import {
  AdditiveBlending,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  type Camera,
} from 'three';
import type { Power } from './director.js';
import { archetypeOf } from './monsters.js';
import type { DebrisSystem, DustSystem, ShockwaveSystem, CrackSystem } from './effects.js';

/**
 * 每種怪獸造型各自的攻擊特效（原創）：
 * 蜥蜴＝能量吐息、猿＝搥地、機械＝雷射、章魚＝墨汁鞭、螃蟹＝爪擊、龍＝噴火。
 * 純視覺：伺服器已決定傷害，這裡只在 lunge 時多播一段招式；可在設定關閉。
 */
export type AttackStyle = 'breath' | 'slam' | 'laser' | 'ink' | 'claw' | 'fire';

/** 順序對應 monsters.ts 的 BUILDERS（蜥蜴、猿、機械、章魚、螃蟹、龍）。 */
export const STYLE_BY_ARCHETYPE: readonly AttackStyle[] = [
  'breath',
  'slam',
  'laser',
  'ink',
  'claw',
  'fire',
];

export function attackStyleOf(seat: number): AttackStyle {
  return STYLE_BY_ARCHETYPE[archetypeOf(seat)] ?? 'slam';
}

export const STYLE_LABEL: Record<AttackStyle, string> = {
  breath: '能量吐息',
  slam: '搥地',
  laser: '雷射',
  ink: '墨汁鞭',
  claw: '爪擊',
  fire: '噴火',
};

export interface BeamSpec {
  color: string;
  core: string;
  /** 起點／終點的光柱半徑（世界單位）。 */
  w0: number;
  w1: number;
  /** 持續時間（秒）。 */
  dur: number;
  /** 閃爍強度 0–1。 */
  flicker: number;
  blend: 'add' | 'normal';
}

export interface BurstSpec {
  dust: { color: string; count: number; size: number; up: number; spread: number; life: number }[];
  debris: { colors: string[]; count: number; speed: number } | null;
  wave: { color: string; radius: number; dur: number } | null;
  /** 在攻擊者腳下也打一圈衝擊波（搥地）。 */
  selfWave: { color: string; radius: number } | null;
  crack: boolean;
  slash: boolean;
  shake: number;
}

export interface AttackPlan {
  style: AttackStyle;
  beam: BeamSpec | null;
  burst: BurstSpec;
  /** 光柱出現時間／落點效果出現時間（相對 lunge 開始，秒）。 */
  beamDelay: number;
  impactDelay: number;
}

const POWER_SCALE: Record<Power, number> = { light: 0.8, medium: 1, heavy: 1.35 };

/** 招式內容（純資料）。power 放大寬度、時間與粒子數。 */
export function planAttack(style: AttackStyle, power: Power): AttackPlan {
  const k = POWER_SCALE[power];
  const n = (c: number): number => Math.max(2, Math.round(c * k));
  switch (style) {
    case 'breath':
      return {
        style,
        beam: {
          color: '#4fd8ff',
          core: '#ffffff',
          w0: 0.35 * k,
          w1: 0.7 * k,
          dur: 0.55 * k,
          flicker: 0.25,
          blend: 'add',
        },
        burst: {
          dust: [{ color: '#bfefff', count: n(14), size: 2.4, up: 2.6, spread: 3, life: 1 }],
          debris: { colors: ['#9fe7ff', '#ffffff'], count: n(8), speed: 7 },
          wave: { color: '#6fe3ff', radius: 3 * k, dur: 0.6 },
          selfWave: null,
          crack: false,
          slash: false,
          shake: 0.4 * k,
        },
        beamDelay: 0.08,
        impactDelay: 0.22,
      };
    case 'fire':
      return {
        style,
        beam: {
          color: '#ff6a12',
          core: '#ffe27a',
          w0: 0.3 * k,
          w1: 1.7 * k,
          dur: 0.65 * k,
          flicker: 0.8,
          blend: 'add',
        },
        burst: {
          dust: [
            { color: '#ff9b3d', count: n(16), size: 2.2, up: 3.2, spread: 3.2, life: 1.2 },
            { color: '#ffd27a', count: n(8), size: 1.6, up: 4, spread: 2.2, life: 0.9 },
          ],
          debris: { colors: ['#ff7a1a', '#5b2a10'], count: n(6), speed: 6 },
          wave: { color: '#ff9b3d', radius: 3.4 * k, dur: 0.6 },
          selfWave: null,
          crack: false,
          slash: false,
          shake: 0.35 * k,
        },
        beamDelay: 0.1,
        impactDelay: 0.24,
      };
    case 'laser':
      return {
        style,
        beam: {
          color: '#ff3b3b',
          core: '#ffffff',
          w0: 0.2 * k,
          w1: 0.2 * k,
          dur: 0.34,
          flicker: 0.5,
          blend: 'add',
        },
        burst: {
          dust: [{ color: '#c9c9c9', count: n(8), size: 1.8, up: 1.8, spread: 2.4, life: 0.8 }],
          debris: { colors: ['#ffec8a', '#ff3b3b', '#ffffff'], count: n(10), speed: 10 },
          wave: { color: '#ff6a6a', radius: 2.2 * k, dur: 0.4 },
          selfWave: null,
          crack: false,
          slash: false,
          shake: 0.3 * k,
        },
        beamDelay: 0.1,
        impactDelay: 0.16,
      };
    case 'ink':
      return {
        style,
        beam: {
          color: '#3a1f5c',
          core: '#7a4cc2',
          w0: 0.55 * k,
          w1: 0.16,
          dur: 0.45,
          flicker: 0,
          blend: 'normal',
        },
        burst: {
          dust: [
            { color: '#2b1546', count: n(14), size: 3.2, up: 2, spread: 3.4, life: 1.4 },
            { color: '#7a4cc2', count: n(8), size: 2, up: 2.4, spread: 2.6, life: 1 },
          ],
          debris: null,
          wave: { color: '#6a3fb0', radius: 3 * k, dur: 0.6 },
          selfWave: null,
          crack: false,
          slash: false,
          shake: 0.3 * k,
        },
        beamDelay: 0.1,
        impactDelay: 0.3,
      };
    case 'claw':
      return {
        style,
        beam: null,
        burst: {
          dust: [{ color: '#d9f6ff', count: n(10), size: 1.6, up: 3.4, spread: 2.2, life: 1.1 }],
          debris: null,
          wave: { color: '#bfefff', radius: 2.6 * k, dur: 0.5 },
          selfWave: null,
          crack: false,
          slash: true,
          shake: 0.35 * k,
        },
        beamDelay: 0,
        impactDelay: 0.32,
      };
    case 'slam':
      return {
        style,
        beam: null,
        burst: {
          dust: [{ color: '#d8cdb8', count: n(22), size: 3, up: 2.6, spread: 4.2, life: 1.4 }],
          debris: { colors: ['#b8ad99', '#8f8777', '#d8cdb8'], count: n(16), speed: 9 },
          wave: { color: '#fff3c4', radius: 5 * k, dur: 0.7 },
          selfWave: { color: '#e0c9a0', radius: 4 * k },
          crack: true,
          slash: false,
          shake: 0.9 * k,
        },
        beamDelay: 0,
        impactDelay: 0.32,
      };
  }
}

// ── 光柱（吐息／雷射／火焰／墨汁鞭）──────────────────

const BEAM_VERT = /* glsl */ `
uniform float uLen;
uniform float uW0;
uniform float uW1;
varying float vZ;
varying vec3 vN;
void main() {
  vZ = position.z;
  vN = normalize(normalMatrix * normal);
  float w = mix(uW0, uW1, position.z);
  vec3 p = vec3(position.xy * w, position.z * uLen);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uAlpha;
uniform float uTime;
uniform float uFlicker;
varying float vZ;
varying vec3 vN;
void main() {
  float facing = abs(vN.z);
  float core = pow(facing, 2.5);
  vec3 col = mix(uColor, uCore, core);
  float fade = smoothstep(0.0, 0.05, vZ) * (1.0 - smoothstep(0.65, 1.0, vZ));
  float flick = 1.0 - uFlicker * 0.5 * (0.5 + 0.5 * sin(uTime * 45.0 + vZ * 22.0));
  float a = uAlpha * (0.3 + 0.7 * facing) * fade * flick;
  gl_FragColor = vec4(col, a);
}`;

let beamGeometry: BufferGeometry | null = null;
function sharedBeamGeometry(): BufferGeometry {
  if (!beamGeometry) {
    // 沿 +z、長度 1、半徑 1 的開口圓柱；shader 依 uniform 縮放
    const g = new CylinderGeometry(1, 1, 1, 14, 1, true);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.5);
    beamGeometry = g;
  }
  return beamGeometry;
}

interface BeamSlot {
  mesh: Mesh;
  mat: ShaderMaterial;
  t: number;
  delay: number;
  dur: number;
  active: boolean;
}

interface SlashSlot {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  t: number;
  delay: number;
  dur: number;
  size: number;
  active: boolean;
}

interface Timer {
  at: number;
  run: () => void;
}

/** 落點效果要用到的既有粒子系統。 */
export interface FxSink {
  dust: DustSystem;
  debris: DebrisSystem;
  waves: ShockwaveSystem;
  cracks: CrackSystem;
  /** 畫質對粒子數的縮放（0–1）。 */
  dustScale: () => number;
  shake: (amount: number) => void;
}

export interface Pt {
  x: number;
  z: number;
}

const MOUTH_HEIGHT = 3.6;
const TARGET_HEIGHT = 2.6;

function makeSlashTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.clearRect(0, 0, 128, 128);
    g.lineCap = 'round';
    // 兩組交叉的三道爪痕
    for (const flip of [1, -1]) {
      for (let i = -1; i <= 1; i++) {
        const off = i * 16;
        const grad = g.createLinearGradient(20, 20, 108, 108);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.35, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.strokeStyle = grad;
        g.lineWidth = 7 - Math.abs(i) * 1.5;
        g.beginPath();
        if (flip === 1) {
          g.moveTo(18 + off, 14);
          g.lineTo(100 + off, 114);
        } else {
          g.moveTo(110 + off * 0.0 - 14 + off, 14);
          g.lineTo(28 + off, 114);
        }
        g.stroke();
      }
    }
  }
  return new CanvasTexture(c);
}

export class AttackFxSystem {
  private readonly beams: BeamSlot[] = [];
  private readonly slashes: SlashSlot[] = [];
  private readonly timers: Timer[] = [];
  private readonly slashTexture: CanvasTexture;
  private readonly slashGeometry = new PlaneGeometry(1, 1);
  private clock = 0;
  private enabled: boolean;

  constructor(
    parent: Group,
    private readonly sink: FxSink,
    enabled = true,
  ) {
    this.enabled = enabled;
    this.slashTexture = makeSlashTexture();
    for (let i = 0; i < 3; i++) {
      const mat = new ShaderMaterial({
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        uniforms: {
          uLen: { value: 1 },
          uW0: { value: 0.3 },
          uW1: { value: 0.3 },
          uColor: { value: [1, 1, 1] },
          uCore: { value: [1, 1, 1] },
          uAlpha: { value: 0 },
          uTime: { value: 0 },
          uFlicker: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      });
      const mesh = new Mesh(sharedBeamGeometry(), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      parent.add(mesh);
      this.beams.push({ mesh, mat, t: 0, delay: 0, dur: 1, active: false });
    }
    for (let i = 0; i < 3; i++) {
      const mat = new MeshBasicMaterial({
        map: this.slashTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
      const mesh = new Mesh(this.slashGeometry, mat);
      mesh.visible = false;
      mesh.renderOrder = 7;
      parent.add(mesh);
      this.slashes.push({ mesh, mat, t: 0, delay: 0, dur: 0.4, size: 3, active: false });
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.clear();
  }

  /** 立刻清掉所有進行中的招式（跳過動畫、關閉特效時）。 */
  clear(): void {
    this.timers.length = 0;
    for (const b of this.beams) {
      b.active = false;
      b.mesh.visible = false;
    }
    for (const s of this.slashes) {
      s.active = false;
      s.mesh.visible = false;
    }
  }

  /** 攻擊者朝目標施放該造型的招式。 */
  play(style: AttackStyle, from: Pt, targets: readonly Pt[], power: Power): void {
    if (!this.enabled || targets.length === 0) return;
    const plan = planAttack(style, power);
    const at = (s: number, run: () => void): void => {
      this.timers.push({ at: this.clock + s, run });
    };
    const shown = targets.slice(0, 3);

    if (plan.beam) {
      const spec = plan.beam;
      shown.forEach((t, i) => {
        const slot = this.beams[i];
        if (!slot) return;
        const dx = t.x - from.x;
        const dz = t.z - from.z;
        const len = Math.hypot(dx, dz) || 1;
        // 光柱從嘴／手的位置射向目標胸口，略為縮短避免穿過目標
        const start = {
          x: from.x + (dx / len) * 1.6,
          y: MOUTH_HEIGHT,
          z: from.z + (dz / len) * 1.6,
        };
        slot.mesh.position.set(start.x, start.y, start.z);
        slot.mesh.lookAt(t.x, TARGET_HEIGHT, t.z);
        const u = slot.mat.uniforms;
        const dist = Math.hypot(t.x - start.x, TARGET_HEIGHT - start.y, t.z - start.z);
        (u['uLen'] as { value: number }).value = Math.max(1, dist - 1.2);
        (u['uW0'] as { value: number }).value = spec.w0;
        (u['uW1'] as { value: number }).value = spec.w1;
        (u['uColor'] as { value: number[] }).value = hex(spec.color);
        (u['uCore'] as { value: number[] }).value = hex(spec.core);
        (u['uFlicker'] as { value: number }).value = spec.flicker;
        slot.mat.blending = spec.blend === 'add' ? AdditiveBlending : NormalBlending;
        slot.mat.needsUpdate = true;
        slot.t = 0;
        slot.delay = plan.beamDelay;
        slot.dur = spec.dur;
        slot.active = true;
      });
    }

    // 落點效果（每個目標一份，粒子數依人數與畫質縮放）
    const per = 1 / Math.sqrt(shown.length);
    at(plan.impactDelay, () => {
      const b = plan.burst;
      const scale = this.sink.dustScale() * per;
      if (b.selfWave)
        this.sink.waves.fire(from.x, from.z, b.selfWave.radius, b.selfWave.color, 0.6);
      for (const t of shown) {
        const dx = t.x - from.x;
        const dz = t.z - from.z;
        const len = Math.hypot(dx, dz) || 1;
        const drift = { x: (dx / len) * 2.2, z: (dz / len) * 2.2 };
        for (const d of b.dust) {
          this.sink.dust.emit(t.x, 1.2, t.z, {
            count: Math.max(1, Math.round(d.count * scale)),
            spread: d.spread,
            up: d.up,
            size: d.size,
            color: d.color,
            life: d.life,
            ...(style === 'fire' || style === 'ink' ? { drift } : {}),
          });
        }
        if (b.debris) {
          this.sink.debris.burst(
            t.x,
            2.2,
            t.z,
            Math.max(2, Math.round(b.debris.count * scale)),
            b.debris.speed,
            b.debris.colors,
          );
        }
        if (b.wave) this.sink.waves.fire(t.x, t.z, b.wave.radius, b.wave.color, b.wave.dur);
        if (b.crack) this.sink.cracks.stamp(t.x, t.z, 4.5);
      }
      this.sink.shake(b.shake);
      if (b.slash) {
        shown.forEach((t, i) => {
          const s = this.slashes[i];
          if (!s) return;
          s.mesh.position.set(t.x, TARGET_HEIGHT + 0.6, t.z);
          s.mesh.rotation.set(0, 0, (Math.random() - 0.5) * 0.7);
          s.size = 5.4 * POWER_SCALE[power];
          s.t = 0;
          s.delay = 0;
          s.dur = 0.42;
          s.active = true;
        });
      }
    });
  }

  update(dt: number, camera: Camera): void {
    this.clock += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      if (t && this.clock >= t.at) {
        this.timers.splice(i, 1);
        t.run();
      }
    }
    for (const b of this.beams) {
      if (!b.active) continue;
      b.t += dt;
      const k = (b.t - b.delay) / b.dur;
      if (k >= 1) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      if (k < 0) continue;
      b.mesh.visible = true;
      const u = b.mat.uniforms;
      // 前 15% 快速長出，之後淡出
      const env = Math.min(1, k / 0.15) * (1 - Math.max(0, (k - 0.6) / 0.4));
      (u['uAlpha'] as { value: number }).value = 0.95 * env;
      (u['uTime'] as { value: number }).value = b.t;
    }
    for (const s of this.slashes) {
      if (!s.active) continue;
      s.t += dt;
      const k = (s.t - s.delay) / s.dur;
      if (k >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      if (k < 0) continue;
      s.mesh.visible = true;
      s.mesh.quaternion.copy(camera.quaternion);
      s.mesh.rotateZ(0);
      const grow = 0.6 + 0.4 * Math.min(1, k * 4);
      s.mesh.scale.setScalar(s.size * grow);
      s.mat.opacity = Math.min(1, k * 8) * (1 - k * k);
    }
  }

  dispose(): void {
    this.clear();
    for (const b of this.beams) b.mat.dispose();
    for (const s of this.slashes) s.mat.dispose();
    this.slashGeometry.dispose();
    this.slashTexture.dispose();
    beamGeometry?.dispose();
    beamGeometry = null;
  }
}

function hex(c: string): number[] {
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
