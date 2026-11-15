/**
 * 產生 Service Worker 的原始碼（建置時由 vite.config.ts 呼叫）。
 *
 * 目的：讓離線單機模式在「完全沒有網路」時也打得開頁面。第一次開啟仍需要連網載入，
 * 載入完成後所有檔案（頁面、程式、3D 場景、背景執行緒）都存進瀏覽器，之後斷網也能開啟、玩離線模式。
 *
 * 範圍刻意很小：只處理同源 GET；頁面導覽「網路優先」（有網路就永遠拿最新版，沒網路才用存檔），
 * 建置產生的檔案（檔名帶雜湊）「存檔優先」。即時連線（socket.io）完全不經過這裡。
 */
export function buildServiceWorker(version: string, assets: readonly string[]): string {
  const list = [...new Set(['/', '/index.html', ...assets])].sort();
  return `// 由建置自動產生，請勿手動修改
const VERSION = ${JSON.stringify(version)};
const CACHE = 'kot-' + VERSION;
const ASSETS = ${JSON.stringify(list)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('kot-') && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/relay')) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then((hit) => hit || Response.error())),
    );
    return;
  }
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((hit) => hit || fetch(req)));
  }
});
`;
}
