import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW,
  PAN_LIMIT,
  ZOOM_MAX,
  ZOOM_MIN,
  applyView,
  clampView,
  dragPan,
  groundHit,
  isDefaultView,
  zoomAt,
} from './view.js';
import { OVERVIEW_POSE } from './shots.js';

const A = 16 / 9;

describe('user view', () => {
  it('預設視角不改變姿態', () => {
    expect(applyView(OVERVIEW_POSE, DEFAULT_VIEW)).toEqual(OVERVIEW_POSE);
    expect(isDefaultView(DEFAULT_VIEW)).toBe(true);
  });

  it('縮放沿視線移動；平移讓位置與注視點一起平移', () => {
    const zoomed = applyView(OVERVIEW_POSE, { ...DEFAULT_VIEW, zoom: 2 });
    expect(zoomed.lookAt).toEqual(OVERVIEW_POSE.lookAt);
    expect(zoomed.position.y).toBeCloseTo(OVERVIEW_POSE.position.y / 2);
    const panned = applyView(OVERVIEW_POSE, { panX: 4, panZ: -3, zoom: 1 });
    expect(panned.position.x).toBeCloseTo(OVERVIEW_POSE.position.x + 4);
    expect(panned.lookAt.z).toBeCloseTo(OVERVIEW_POSE.lookAt.z - 3);
  });

  it('限制縮放與平移範圍', () => {
    const v = clampView({ panX: 999, panZ: -999, zoom: 99 });
    expect(v).toEqual({ panX: PAN_LIMIT, panZ: -PAN_LIMIT, zoom: ZOOM_MAX });
    expect(clampView({ ...DEFAULT_VIEW, zoom: 0.01 }).zoom).toBe(ZOOM_MIN);
  });

  it('螢幕中心對到注視點的地面；朝天的射線沒有交點', () => {
    const c = groundHit(OVERVIEW_POSE, A, 0, 0);
    expect(c?.x).toBeCloseTo(OVERVIEW_POSE.lookAt.x, 3);
    expect(c?.z).toBeCloseTo(OVERVIEW_POSE.lookAt.z, 3);
    expect(groundHit(OVERVIEW_POSE, A, 0, 5)).toBeNull();
  });

  it('拖曳：手指抓住的那塊地跟著手指走', () => {
    const from = { x: 0.2, y: -0.1 };
    const to = { x: -0.3, y: 0.15 };
    const grabbed = groundHit(applyView(OVERVIEW_POSE, DEFAULT_VIEW), A, from.x, from.y);
    const next = dragPan(OVERVIEW_POSE, DEFAULT_VIEW, A, from, to);
    const under = groundHit(applyView(OVERVIEW_POSE, next), A, to.x, to.y);
    expect(under?.x).toBeCloseTo(grabbed?.x ?? NaN, 3);
    expect(under?.z).toBeCloseTo(grabbed?.z ?? NaN, 3);
  });

  it('以游標縮放：游標下的地面不動', () => {
    const at = { x: 0.5, y: 0.2 };
    const g0 = groundHit(OVERVIEW_POSE, A, at.x, at.y);
    const v = zoomAt(OVERVIEW_POSE, DEFAULT_VIEW, A, at, at, 1.8);
    expect(v.zoom).toBeCloseTo(1.8);
    const g1 = groundHit(applyView(OVERVIEW_POSE, v), A, at.x, at.y);
    expect(g1?.x).toBeCloseTo(g0?.x ?? NaN, 3);
    expect(g1?.z).toBeCloseTo(g0?.z ?? NaN, 3);
  });

  it('縮到上限後再縮不會再變', () => {
    const v = zoomAt(
      OVERVIEW_POSE,
      { ...DEFAULT_VIEW, zoom: ZOOM_MAX },
      A,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      2,
    );
    expect(v.zoom).toBe(ZOOM_MAX);
  });
});
