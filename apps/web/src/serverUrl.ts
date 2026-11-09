/**
 * 伺服器網址：
 * - 沒設定 VITE_SERVER_URL → 本機開發預設（網頁與伺服器分開跑）
 * - 設成空字串 → 與網頁同一個網址（單一容器的試玩版）
 * - 其他 → 照設定
 */
export const DEV_SERVER_URL = 'http://localhost:3001';

export function resolveServerUrl(raw: string | undefined, pageOrigin: string): string {
  if (raw === undefined) return DEV_SERVER_URL;
  const trimmed = raw.trim();
  return trimmed === '' ? pageOrigin : trimmed;
}
