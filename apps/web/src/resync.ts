/**
 * 「我可能漏了訊息」的判斷（M8）。中繼與直連都不保證訊息一定送到（轉送中遇到斷線、分頁在背景被凍結…），
 * 客戶端自己發現不對勁就送 client:resync，房主會重送完整狀態（不含事件，不會重播動畫）。
 */

/** 更新的版本跳號：中間有訊息沒收到（引擎每個動作的版本剛好加 1）。 */
export function hasGap(lastVersion: number | null, version: number): boolean {
  return lastVersion !== null && version > lastVersion + 1;
}

/** 決策時間早就過了卻還沒有任何新更新：很可能漏了（房主會在時間到時自動處理並廣播）。 */
export const STALL_GRACE_MS = 8_000;
export function isStalled(deadlineAt: number | null, now: number): boolean {
  return deadlineAt !== null && now > deadlineAt + STALL_GRACE_MS;
}

/** 限制重送頻率：就算一直偵測到問題，也不會灌爆房主。 */
export function createResyncGate(now: () => number, minIntervalMs: number): { tryPass(): boolean } {
  let last = Number.NEGATIVE_INFINITY;
  return {
    tryPass() {
      const t = now();
      if (t - last < minIntervalMs) return false;
      last = t;
      return true;
    },
  };
}
