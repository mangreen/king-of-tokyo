/**
 * 「使用者還在」的訊號：有操作就通知伺服器，伺服器才不會把這個連線當成被丟著不管的分頁而踢掉。
 * 純函式（時鐘與送出都由外面傳入），方便測試。
 */
export interface ActivityPing {
  /** 有使用者操作時呼叫；距離上次送出不到 intervalMs 就忽略。 */
  touch(): void;
}

export function createActivityPing(
  /** 回傳 false 表示這次沒有真的送出（例如還沒連線）；沒送出就不算，下次操作再試。 */
  send: () => boolean | void,
  now: () => number,
  intervalMs: number,
): ActivityPing {
  let last = Number.NEGATIVE_INFINITY;
  return {
    touch() {
      const t = now();
      if (t - last < intervalMs) return;
      if (send() === false) return;
      last = t;
    },
  };
}

/** 視為「有人在」的使用者操作。滑鼠移動、捲動、觸控、鍵盤；背景分頁不會產生這些事件。 */
export const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchstart',
] as const;
