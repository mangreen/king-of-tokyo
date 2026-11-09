/**
 * Socket.IO 連線的 Origin 檢查（純函式，方便測試）。
 * - 沒有 Origin：非瀏覽器客戶端（測試工具等），允許。
 * - 在允許清單內：允許。
 * - allowSameOrigin 時：Origin 的 host 與請求的 Host 相同才允許（網頁與伺服器同一個網址）。
 *   瀏覽器一定會帶真實的 Origin，所以其他網站的惡意頁面 Origin 不會等於我們的 Host。
 */
export function isOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowedOrigins: readonly string[],
  allowSameOrigin: boolean,
): boolean {
  if (origin === undefined) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (!allowSameOrigin || host === undefined || host === '') return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
