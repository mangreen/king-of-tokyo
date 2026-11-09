import { describe, expect, it } from 'vitest';
import { followClick, followTitle, followUi } from './followState.js';

describe('followState', () => {
  it('偏好開＋沒有手動視角 → 跟隨中', () => {
    expect(followUi(true, true, false)).toEqual({ active: true, paused: false });
  });
  it('拖曳地圖後：偏好仍開，但顯示為暫停（不是「開」）', () => {
    expect(followUi(true, true, true)).toEqual({ active: false, paused: true });
  });
  it('偏好關或沒有鏡頭動態 → 不跟隨也不算暫停', () => {
    expect(followUi(false, true, true)).toEqual({ active: false, paused: false });
    expect(followUi(true, false, true)).toEqual({ active: false, paused: false });
  });
  it('暫停時按下 → 重置視角並保持開啟（不會被關掉）', () => {
    expect(followClick(true, true)).toEqual({ resetView: true, pref: true });
    expect(followClick(false, true)).toEqual({ resetView: true, pref: true });
  });
  it('一般狀態按下 → 切換偏好', () => {
    expect(followClick(true, false)).toEqual({ resetView: false, pref: false });
    expect(followClick(false, false)).toEqual({ resetView: false, pref: true });
  });
  it('提示文字區分三種狀態', () => {
    expect(followTitle({ active: true, paused: false })).toContain('開');
    expect(followTitle({ active: false, paused: false })).toContain('關');
    expect(followTitle({ active: false, paused: true })).toContain('暫停');
  });
});
