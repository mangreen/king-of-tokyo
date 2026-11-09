/**
 * 鏡頭跟隨的「實際」狀態。偏好是開著，但玩家手動拖曳／縮放地圖後，自動鏡頭會暫停
 * （手動視角優先），這時 UI 不能還顯示「跟隨：開」，否則按一下反而變成關閉。
 */
export interface FollowUi {
  /** 現在鏡頭真的會跟隨。 */
  active: boolean;
  /** 偏好是開，但因為手動視角而暫停。 */
  paused: boolean;
}

export function followUi(pref: boolean, motion: boolean, customView: boolean): FollowUi {
  const wanted = pref && motion;
  return { active: wanted && !customView, paused: wanted && customView };
}

export interface FollowClick {
  /** 要不要先重置手動視角。 */
  resetView: boolean;
  /** 新的偏好值。 */
  pref: boolean;
}

/** 按下跟隨開關：手動視角中＝回到跟隨（重置視角並確保開啟）；否則一般切換。 */
export function followClick(pref: boolean, customView: boolean): FollowClick {
  if (customView) return { resetView: true, pref: true };
  return { resetView: false, pref: !pref };
}

export function followTitle(ui: FollowUi): string {
  if (ui.paused) return '鏡頭跟隨已暫停（你調整了視角）。點一下回到跟隨';
  return ui.active ? '鏡頭跟隨：開' : '鏡頭跟隨：關';
}
