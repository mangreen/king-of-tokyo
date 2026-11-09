import type { Spot } from './layout.js';

/**
 * 鏡頭鏡位（純數學）。預設是高角度俯瞰全場；事件觸發時切到短鏡頭
 * （低角度英雄、推近、環繞、特寫），播完回到俯瞰。ADR-0003。
 */

export type ShotType = 'overview' | 'lowHero' | 'pushIn' | 'orbit' | 'closeUp';

export interface ShotSpec {
  type: ShotType;
  /** 主角座位（lowHero：攻擊者；pushIn／closeUp／orbit：被拍的怪獸）。 */
  seat?: number;
  /** lowHero 的被攻擊者（鏡頭看向他們）。 */
  targets?: number[];
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraPose {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
}

/** 怪獸模型原始身高 4.2，場景中放大 1.3 倍（巨大感）。 */
export const MONSTER_SCALE = 1.3;
export const MONSTER_HEIGHT = 4.2 * MONSTER_SCALE;

export const OVERVIEW_POSE: CameraPose = {
  position: { x: 5, y: 32, z: 36 },
  lookAt: { x: 5, y: 0, z: -1 },
  fov: 42,
};

type SpotOf = (seat: number) => Spot | undefined;

const mid = (spots: Spot[]): Spot => {
  const n = spots.length;
  return {
    x: spots.reduce((s, p) => s + p.x, 0) / n,
    z: spots.reduce((s, p) => s + p.z, 0) / n,
    yaw: 0,
  };
};

/** `t` 為鏡頭已進行的比例 0–1，只有環繞鏡位會用到。 */
export function poseFor(spec: ShotSpec, spotOf: SpotOf, t = 0): CameraPose {
  const subject = spec.seat === undefined ? undefined : spotOf(spec.seat);
  if (spec.type === 'overview' || !subject) return OVERVIEW_POSE;
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));

  switch (spec.type) {
    case 'lowHero': {
      // 攻擊者背後偏低、仰視，看向被攻擊者（或前方）
      const targets = (spec.targets ?? []).map(spotOf).filter((s): s is Spot => s !== undefined);
      const focus =
        targets.length > 0
          ? mid(targets)
          : { x: subject.x + Math.sin(subject.yaw), z: subject.z + Math.cos(subject.yaw), yaw: 0 };
      const dx = focus.x - subject.x;
      const dz = focus.z - subject.z;
      const len = Math.max(0.001, Math.hypot(dx, dz));
      const back = 6.5;
      const side = 2.2;
      return {
        position: {
          x: subject.x - (dx / len) * back - (dz / len) * side,
          y: 2.6,
          z: subject.z - (dz / len) * back + (dx / len) * side,
        },
        lookAt: {
          x: (subject.x + focus.x) / 2,
          y: MONSTER_HEIGHT * 0.65,
          z: (subject.z + focus.z) / 2,
        },
        fov: 52,
      };
    }
    case 'pushIn':
      return {
        position: { x: subject.x + 4.5, y: 5.5, z: subject.z + 9 },
        lookAt: { x: subject.x, y: MONSTER_HEIGHT * 0.55, z: subject.z },
        fov: 44,
      };
    case 'closeUp': {
      // 從怪獸前方、略高處拍特寫（怪獸倒下時身體也在畫面中）
      return {
        position: {
          x: subject.x + Math.sin(subject.yaw) * 8.5,
          y: MONSTER_HEIGHT * 0.75,
          z: subject.z + Math.cos(subject.yaw) * 8.5,
        },
        lookAt: { x: subject.x, y: MONSTER_HEIGHT * 0.4, z: subject.z },
        fov: 40,
      };
    }
    case 'orbit': {
      const angle = subject.yaw + Math.PI / 5 + clamp(t) * Math.PI * 0.9;
      return {
        position: {
          x: subject.x + Math.sin(angle) * 9.5,
          y: MONSTER_HEIGHT * 0.9,
          z: subject.z + Math.cos(angle) * 9.5,
        },
        lookAt: { x: subject.x, y: MONSTER_HEIGHT * 0.55, z: subject.z },
        fov: 46,
      };
    }
  }
}

/** 兩個姿態之間的混合（鏡頭平滑移動用）。 */
export function blendPose(a: CameraPose, b: CameraPose, k: number): CameraPose {
  const t = Math.max(0, Math.min(1, k));
  const l = (x: number, y: number): number => x + (y - x) * t;
  return {
    position: {
      x: l(a.position.x, b.position.x),
      y: l(a.position.y, b.position.y),
      z: l(a.position.z, b.position.z),
    },
    lookAt: {
      x: l(a.lookAt.x, b.lookAt.x),
      y: l(a.lookAt.y, b.lookAt.y),
      z: l(a.lookAt.z, b.lookAt.z),
    },
    fov: l(a.fov, b.fov),
  };
}

/** 平滑的緩入緩出。 */
export function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}
