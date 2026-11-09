import { type CameraPose, type Vec3 } from './shots.js';

/** 玩家自己調整的地圖視角：平移（世界座標，公尺）與縮放（1 = 預設總覽）。 */
export interface UserView {
  panX: number;
  panZ: number;
  zoom: number;
}

export const DEFAULT_VIEW: UserView = { panX: 0, panZ: 0, zoom: 1 };
export const ZOOM_MIN = 0.55;
export const ZOOM_MAX = 2.8;
/** 平移上限：總覽中心往任一方向最多離開這麼遠（城市半徑 38）。 */
export const PAN_LIMIT = 30;

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

export function clampView(v: UserView): UserView {
  return {
    panX: clamp(v.panX, -PAN_LIMIT, PAN_LIMIT),
    panZ: clamp(v.panZ, -PAN_LIMIT, PAN_LIMIT),
    zoom: clamp(v.zoom, ZOOM_MIN, ZOOM_MAX),
  };
}

export function isDefaultView(v: UserView): boolean {
  return Math.abs(v.panX) < 0.01 && Math.abs(v.panZ) < 0.01 && Math.abs(v.zoom - 1) < 0.005;
}

/** 跟隨行動中的怪獸：總覽姿態平移到怪獸身上並拉近（方位不變，地圖不會旋轉）。 */
export const FOLLOW_ZOOM = 1.7;
export function followView(
  target: { x: number; z: number },
  center: { x: number; z: number },
): UserView {
  return clampView({ panX: target.x - center.x, panZ: target.z - center.z, zoom: FOLLOW_ZOOM });
}

/** 把使用者視角套到一個基準姿態：沿視線推近／拉遠，再整體平移。 */
export function applyView(base: CameraPose, v: UserView): CameraPose {
  const { position: p, lookAt: l } = base;
  const k = 1 / v.zoom;
  return {
    position: {
      x: l.x + (p.x - l.x) * k + v.panX,
      y: l.y + (p.y - l.y) * k,
      z: l.z + (p.z - l.z) * k + v.panZ,
    },
    lookAt: { x: l.x + v.panX, y: l.y, z: l.z + v.panZ },
    fov: base.fov,
  };
}

/**
 * 螢幕上某點（NDC：左下 -1,-1／右上 1,1）對應到地面（y = 0）的世界座標。
 * 看不到地面（射線朝天）時回傳 null。純數學，不依賴 three。
 */
export function groundHit(
  pose: CameraPose,
  aspect: number,
  ndcX: number,
  ndcY: number,
): { x: number; z: number } | null {
  const f = norm(sub(pose.lookAt, pose.position));
  const right = norm(cross(f, { x: 0, y: 1, z: 0 }));
  const up = cross(right, f);
  const t = Math.tan((pose.fov * Math.PI) / 360);
  const dir = {
    x: f.x + right.x * ndcX * t * aspect + up.x * ndcY * t,
    y: f.y + right.y * ndcX * t * aspect + up.y * ndcY * t,
    z: f.z + right.z * ndcX * t * aspect + up.z * ndcY * t,
  };
  if (dir.y >= -1e-6) return null;
  const s = -pose.position.y / dir.y;
  return { x: pose.position.x + dir.x * s, z: pose.position.z + dir.z * s };
}

/**
 * 縮放並讓「螢幕上 (ndcX, ndcY) 那一點下的地面」維持在原處（以游標／手指中心縮放）。
 * `to` 可以是新的螢幕位置（雙指移動時一邊縮放一邊平移）。
 */
export function zoomAt(
  base: CameraPose,
  view: UserView,
  aspect: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  factor: number,
): UserView {
  const before = groundHit(applyView(base, view), aspect, from.x, from.y);
  const zoomed = clampView({ ...view, zoom: view.zoom * factor });
  if (!before) return zoomed;
  const after = groundHit(applyView(base, zoomed), aspect, to.x, to.y);
  if (!after) return zoomed;
  return clampView({
    ...zoomed,
    panX: zoomed.panX + before.x - after.x,
    panZ: zoomed.panZ + before.z - after.z,
  });
}

/** 拖曳平移：讓「手指一開始抓住的那塊地」跟著手指移動。 */
export function dragPan(
  base: CameraPose,
  view: UserView,
  aspect: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
): UserView {
  return zoomAt(base, view, aspect, from, to, 1);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
