/**
 * 計時抽象：房間與計時器不直接呼叫 setTimeout／Date.now，
 * 測試時可注入假時鐘，快速、確定地驗證逾時與重連行為。
 */
export interface Scheduler {
  /** 目前時間（毫秒）。 */
  now(): number;
  /** 在 ms 毫秒後執行 fn，回傳取消函式（重複取消無害）。 */
  after(ms: number, fn: () => void): () => void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  after(ms, fn) {
    const handle = setTimeout(fn, ms);
    handle.unref();
    return () => {
      clearTimeout(handle);
    };
  },
};
