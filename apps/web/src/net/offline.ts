/** 離線模式的網址參數：`?offline=1`（只在這個分頁跑一份本機主機，不連伺服器）。 */
export function parseOffline(search: string): boolean {
  const value = new URLSearchParams(search).get('offline');
  return value === '1' || value === 'true';
}
