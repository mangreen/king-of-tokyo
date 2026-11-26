import { BAY_SPOT, CITY_SPOT, MAX_SEATS, ringSpot, type Spot } from './layout.js';

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

/** 總覽鏡頭的俯角與朝向：從南方偏高處往北看（方位固定，地圖不會旋轉）。 */
const OVERVIEW_ELEVATION = (46 * Math.PI) / 180;
const OVERVIEW_FOV = 42;
/** 頭上名牌（名字、血量、狀態列、皇冠）要留的空間：怪獸頭頂再往上這麼高也要在畫面內。 */
export const TAG_HEADROOM = 4.8;
/** 名牌寬度的一半（世界單位，保守估計）。 */
export const TAG_HALF_WIDTH = 5.5;
/** 飛行怪獸懸空的高度（seaStance.ts 的 SEA_OFFSET.fly 加上漂浮）。 */
const FLY_LIFT = 3.2;
/** 畫面邊緣留白（NDC，1＝貼邊）。 */
const FIT_MARGIN_X = 0.93;
const FIT_MARGIN_Y = 0.92;

/** 世界座標點投影到螢幕（NDC：左下 -1,-1／右上 1,1）；在鏡頭後方回傳 null。 */
export function projectNdc(
  pose: CameraPose,
  aspect: number,
  p: Vec3,
): { x: number; y: number } | null {
  const f = unit(subV(pose.lookAt, pose.position));
  const right = unit(crossV(f, { x: 0, y: 1, z: 0 }));
  const up = crossV(right, f);
  const v = subV(p, pose.position);
  const zc = v.x * f.x + v.y * f.y + v.z * f.z;
  if (zc < 0.5) return null;
  const t = Math.tan((pose.fov * Math.PI) / 360);
  return {
    x: (v.x * right.x + v.y * right.y + v.z * right.z) / (zc * t * aspect),
    y: (v.x * up.x + v.y * up.y + v.z * up.z) / (zc * t),
  };
}

/** 一隻怪獸在畫面上需要容納的範圍：腳（沒入水面）到頭上名牌／皇冠／狀態列（含飛行的高度）。 */
export function spotExtent(spot: Spot): Vec3[] {
  return [
    { x: spot.x, y: -1.2, z: spot.z },
    { x: spot.x, y: MONSTER_HEIGHT + FLY_LIFT + TAG_HEADROOM, z: spot.z },
    // 身體寬度（左右各約 3）
    { x: spot.x - 3, y: MONSTER_HEIGHT * 0.6, z: spot.z },
    { x: spot.x + 3, y: MONSTER_HEIGHT * 0.6, z: spot.z },
    // 名牌本身有寬度（約 90 px，在最小的縮放下相當於左右各 5.5 個世界單位）
    { x: spot.x - TAG_HALF_WIDTH, y: MONSTER_HEIGHT + FLY_LIFT + 1.5, z: spot.z },
    { x: spot.x + TAG_HALF_WIDTH, y: MONSTER_HEIGHT + FLY_LIFT + 1.5, z: spot.z },
  ];
}

/** 這一局總覽鏡頭要涵蓋的站位：所有外圍座位＋東京市＋東京灣。 */
export function overviewSpots(playerCount: number): Spot[] {
  const n = Math.max(1, Math.min(MAX_SEATS, playerCount));
  const out: Spot[] = [CITY_SPOT, BAY_SPOT];
  for (let seat = 0; seat < n; seat++) out.push(ringSpot(seat, n));
  return out;
}

const poseAt = (center: { x: number; z: number }, dist: number): CameraPose => ({
  position: {
    x: center.x,
    y: Math.sin(OVERVIEW_ELEVATION) * dist,
    z: center.z + Math.cos(OVERVIEW_ELEVATION) * dist,
  },
  lookAt: { x: center.x, y: 0, z: center.z },
  fov: OVERVIEW_FOV,
});

function fits(pose: CameraPose, aspect: number, pts: Vec3[]): boolean {
  return pts.every((p) => {
    const n = projectNdc(pose, aspect, p);
    return n !== null && Math.abs(n.x) <= FIT_MARGIN_X && Math.abs(n.y) <= FIT_MARGIN_Y;
  });
}

const fitCache = new Map<string, CameraPose>();

/**
 * 總覽鏡頭：固定方位與俯角，依「畫面長寬比」與「這局的站位」算出剛好把所有怪獸、
 * 頭上名牌（含狀態列、皇冠）和飛行高度都收進畫面的位置與距離。直向螢幕會拉得更遠。
 */
export function overviewPoseFor(aspect: number, playerCount: number): CameraPose {
  const a = Math.max(0.3, Math.min(3, aspect));
  const key = `${a.toFixed(3)}|${String(playerCount)}`;
  const hit = fitCache.get(key);
  if (hit) return hit;
  const pts = overviewSpots(playerCount).flatMap(spotExtent);
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  const center = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    z: (Math.min(...zs) + Math.max(...zs)) / 2,
  };
  const t = Math.tan((OVERVIEW_FOV * Math.PI) / 360);
  let pose = poseAt(center, 60);
  for (let round = 0; round < 6; round++) {
    // 最小的距離（二分搜尋）：所有點都在畫面內
    let lo = 12;
    let hi = 400;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(poseAt(center, mid), a, pts)) hi = mid;
      else lo = mid;
    }
    pose = poseAt(center, hi);
    // 把內容的螢幕範圍置中：左右用世界 x 平移、上下沿著地面南北平移
    const ndc = pts.map((p) => projectNdc(pose, a, p)).filter((n) => n !== null);
    if (ndc.length === 0) break;
    const cx = (Math.min(...ndc.map((n) => n.x)) + Math.max(...ndc.map((n) => n.x))) / 2;
    const cy = (Math.min(...ndc.map((n) => n.y)) + Math.max(...ndc.map((n) => n.y))) / 2;
    if (Math.abs(cx) < 0.003 && Math.abs(cy) < 0.003) break;
    center.x += cx * hi * t * a;
    center.z -= (cy * hi * t) / Math.sin(OVERVIEW_ELEVATION);
  }
  fitCache.set(key, pose);
  return pose;
}

/** 預設總覽鏡頭（橫向 16:9、6 位玩家）：給預設值與不需要精確適配的計算用。 */
export const OVERVIEW_POSE: CameraPose = overviewPoseFor(16 / 9, MAX_SEATS);

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

/** 多位勝者時每隔多久換一位（毫秒）。 */
export const VICTORY_SWITCH_MS = 7000;

/**
 * 勝利鏡頭：繞著勝者慢慢轉一圈又一圈（約 21 秒一圈），從偏高處俯看，把整隻怪獸和頭上的皇冠都收進畫面。
 * `ms` 是場景累計的演出時間；所有玩家用同一個公式，所以看到的是同一個鏡位。
 */
export function victoryPose(subject: Spot, ms: number): CameraPose {
  const angle = subject.yaw + Math.PI / 5 + (ms / 1000) * 0.3;
  return {
    position: {
      x: subject.x + Math.sin(angle) * 14,
      y: MONSTER_HEIGHT * 1.6,
      z: subject.z + Math.cos(angle) * 14,
    },
    lookAt: { x: subject.x, y: MONSTER_HEIGHT * 0.95, z: subject.z },
    fov: 46,
  };
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

function subV(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function crossV(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function unit(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
