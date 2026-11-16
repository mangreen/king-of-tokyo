/** 登記 Service Worker（只在正式建置、且瀏覽器支援時；開發伺服器不登記，避免舊檔干擾）。 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 登記失敗只代表無法離線開啟，不影響遊戲
    });
  });
}

/** 離線檔案是否已存好（下次沒網路也能開啟）。不支援或尚未存好回傳 false。 */
export async function offlineReady(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const keys = await caches.keys();
    return keys.some((k) => k.startsWith('kot-'));
  } catch {
    return false;
  }
}
