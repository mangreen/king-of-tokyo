import { Color } from 'three';
import type { Power } from './director.js';
import type { Spot } from './layout.js';
import type { MonsterRig } from './monsters.js';

/**
 * 一隻怪獸的程序動畫狀態。位置與存活由遊戲狀態決定（setSpot / setAlive），
 * 撲擊、受擊、咆哮等「演出」由事件導演的 cue 觸發；沒有任何骨架或剪輯檔。
 */

const HOP_DURATION = 0.8;
const HOP_HEIGHT = 2.2;
const LUNGE_DURATION = 0.7;
const KO_DURATION = 0.9;

const ease = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export class MonsterActor {
  x: number;
  z: number;
  yaw: number;
  private baseYaw: number;
  /** 攻擊時暫時轉向目標；結束後回到站位朝向。 */
  private faceYaw: number | null = null;
  private hop: { fromX: number; fromZ: number; toX: number; toZ: number; t: number } | null = null;
  private target: Spot;
  private lungeState: { t: number; power: Power } | null = null;
  private flinchState: { t: number; dx: number; dz: number; power: Power } | null = null;
  private koT = 0;
  private koTarget = false;
  private roarT = -1;
  private flash = 0;
  /** 站位落地時通知（踩踏特效）。 */
  onLand: ((actor: MonsterActor, spot: Spot) => void) | null = null;
  private readonly phase: number;
  private readonly base = new Color('#ffffff');
  private tint = 1;

  constructor(
    readonly seat: number,
    readonly rig: MonsterRig,
    spot: Spot,
  ) {
    this.x = spot.x;
    this.z = spot.z;
    this.yaw = this.baseYaw = spot.yaw;
    this.target = spot;
    this.phase = seat * 1.7;
    this.apply(0);
  }

  get alive(): boolean {
    return !this.koTarget;
  }

  get isHopping(): boolean {
    return this.hop !== null;
  }

  /** 前往新的站位（跳過去）。instant 用於初次載入／快轉。 */
  setSpot(spot: Spot, instant = false): void {
    if (spot.x === this.target.x && spot.z === this.target.z && !this.hop) {
      this.baseYaw = spot.yaw;
      this.target = spot;
      return;
    }
    this.target = spot;
    this.baseYaw = spot.yaw;
    if (instant) {
      this.hop = null;
      this.x = spot.x;
      this.z = spot.z;
      this.yaw = spot.yaw;
      return;
    }
    this.hop = { fromX: this.x, fromZ: this.z, toX: spot.x, toZ: spot.z, t: 0 };
  }

  setAlive(alive: boolean, instant = false): void {
    if (alive === !this.koTarget) return;
    this.koTarget = !alive;
    if (instant) this.koT = alive ? 0 : 1;
    if (alive) this.koT = 0;
  }

  lunge(toX: number, toZ: number, power: Power): void {
    if (this.koTarget) return;
    this.faceYaw = Math.atan2(toX - this.x, toZ - this.z);
    this.lungeState = { t: 0, power };
  }

  flinch(fromX: number, fromZ: number, power: Power): void {
    if (this.koTarget) return;
    const dx = this.x - fromX;
    const dz = this.z - fromZ;
    const len = Math.max(0.001, Math.hypot(dx, dz));
    this.flinchState = { t: 0, dx: dx / len, dz: dz / len, power };
    this.flash = 1;
  }

  roar(): void {
    this.roarT = 0;
  }

  update(dt: number, time: number): void {
    // 轉向
    const wantYaw = this.faceYaw ?? this.baseYaw;
    this.yaw += angleDelta(this.yaw, wantYaw) * Math.min(1, dt * 9);

    if (this.hop) {
      this.hop.t += dt / HOP_DURATION;
      const k = ease(this.hop.t);
      this.x = this.hop.fromX + (this.hop.toX - this.hop.fromX) * k;
      this.z = this.hop.fromZ + (this.hop.toZ - this.hop.fromZ) * k;
      this.faceYaw = Math.atan2(this.hop.toX - this.hop.fromX, this.hop.toZ - this.hop.fromZ);
      if (this.hop.t >= 1) {
        this.hop = null;
        this.faceYaw = null;
        this.x = this.target.x;
        this.z = this.target.z;
        this.onLand?.(this, this.target);
      }
    }

    if (this.lungeState) {
      this.lungeState.t += dt / LUNGE_DURATION;
      if (this.lungeState.t >= 1) {
        this.lungeState = null;
        if (!this.hop) this.faceYaw = null;
      }
    }
    if (this.flinchState) {
      this.flinchState.t += dt / 0.55;
      if (this.flinchState.t >= 1) this.flinchState = null;
    }
    if (this.roarT >= 0) {
      this.roarT += dt / 1.4;
      if (this.roarT >= 1) this.roarT = -1;
    }
    if (this.koTarget) this.koT += dt / KO_DURATION;
    this.koT = Math.max(0, Math.min(1, this.koT));
    this.flash = Math.max(0, this.flash - dt / 0.2);
    this.apply(time);
  }

  private apply(time: number): void {
    const { rig } = this;
    const t = time + this.phase;
    const alive = 1 - ease(this.koT);

    // 站位與跳躍
    let y = 0;
    let lean = 0;
    if (this.hop) {
      y = Math.sin(Math.PI * Math.min(1, this.hop.t)) * HOP_HEIGHT;
      lean = 0.22 * Math.sin(Math.PI * Math.min(1, this.hop.t));
    }
    rig.root.position.set(this.x, y, this.z);
    rig.root.rotation.y = this.yaw;

    // 撲擊：身體前傾、向前衝；手臂揮擊
    let forward = 0;
    let swing = 0;
    if (this.lungeState) {
      const k = this.lungeState.t;
      const wind = k < 0.35 ? -0.25 * ease(k / 0.35) : 0;
      const strike = k >= 0.35 ? Math.sin(Math.PI * ease((k - 0.35) / 0.65)) : 0;
      const power =
        this.lungeState.power === 'heavy' ? 1.35 : this.lungeState.power === 'medium' ? 1.1 : 0.9;
      forward = (wind + strike * 1.6) * power;
      swing =
        (k < 0.35 ? -0.8 * (k / 0.35) : -0.8 + 2.6 * Math.sin(Math.PI * ease((k - 0.35) / 0.65))) *
        power;
      lean += (k < 0.35 ? -0.12 : 0.3 * strike) * power;
    }

    // 受擊：向後彈開並傾斜
    let kx = 0;
    let kz = 0;
    let tilt = 0;
    if (this.flinchState) {
      const f = this.flinchState;
      const amp = f.power === 'heavy' ? 1.5 : f.power === 'medium' ? 0.95 : 0.55;
      const bump = Math.sin(Math.PI * Math.min(1, f.t)) * amp;
      kx = f.dx * bump;
      kz = f.dz * bump;
      tilt = -0.28 * Math.sin(Math.PI * Math.min(1, f.t)) * (amp > 0.9 ? 1.3 : 1);
    }

    const breathe = 1 + 0.014 * Math.sin(t * 2.2) * alive;
    rig.body.position.set(0, 0, forward);
    rig.root.position.x += kx;
    rig.root.position.z += kz;
    rig.body.scale.set(1, breathe, 1);
    rig.body.rotation.x = lean * alive - (Math.PI / 2) * ease(this.koT);
    rig.body.rotation.z = tilt * alive;
    rig.body.position.y = 0.95 * ease(this.koT);

    // 咆哮：頭上仰、雙臂舉起
    const roar = this.roarT >= 0 ? Math.sin(Math.PI * this.roarT) : 0;
    rig.head.rotation.set(
      (-0.55 * roar + 0.25 * Math.max(0, swing) * 0.4) * alive,
      Math.sin(t * 0.9) * 0.16 * alive * (1 - roar),
      0,
    );
    const sway = Math.sin(t * 1.7) * 0.07 * alive;
    rig.armL.rotation.x = (sway - swing - 1.1 * roar) * alive;
    rig.armR.rotation.x = (-sway - swing * 0.85 - 1.1 * roar) * alive;
    rig.armL.rotation.z = (0.05 + 0.35 * roar) * alive;
    rig.armR.rotation.z = (-0.05 - 0.35 * roar) * alive;
    rig.tail.rotation.y = Math.sin(t * 1.3) * 0.2 * alive;
    rig.tail.rotation.x = (0.05 * Math.sin(t * 2.1) + (this.hop ? -0.3 : 0)) * alive;

    // 受擊閃白、倒下變暗
    const m = rig.material;
    m.emissive.setRGB(this.flash * 0.9, this.flash * 0.9, this.flash * 0.9);
    const shade = 1 - 0.45 * ease(this.koT);
    if (shade !== this.tint) {
      this.tint = shade;
      m.color.copy(this.base).multiplyScalar(shade);
    }
  }

  dispose(): void {
    this.onLand = null;
    this.rig.dispose();
  }
}
