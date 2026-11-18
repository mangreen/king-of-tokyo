/**
 * 連線模式（網址參數 `mode`，舊的 `?offline=1` 仍可用）：
 * - p2p：房主模式（預設）。房主的瀏覽器跑房間，伺服器只登記房號與轉送訊息（ADR-0007）
 * - server：伺服器權威模式（`?mode=server`）。伺服器跑房間，需要嚴格防作弊時用
 * - offline：本分頁跑一份本機主機，不連伺服器（單人加電腦）
 */
export type Mode = 'server' | 'offline' | 'p2p';

/** 玩法在大廳的排列順序。 */
const ALL_MODES: readonly Mode[] = ['p2p', 'offline', 'server'];

/**
 * 這個建置是否開放伺服器模式。試玩 image 在建置時設 `VITE_DISABLE_SERVER_MODE=1`，
 * 大廳就不會出現這個選項，也不接受網址上手動加的 `?mode=server`（伺服器端另外會拒絕連線）。
 */
export function serverModeEnabled(env: { VITE_DISABLE_SERVER_MODE?: string | undefined }): boolean {
  const flag = env.VITE_DISABLE_SERVER_MODE;
  return !(flag === '1' || flag === 'true');
}

/** 大廳可以選的玩法。 */
export function availableModes(serverMode: boolean): readonly Mode[] {
  return serverMode ? ALL_MODES : ALL_MODES.filter((m) => m !== 'server');
}

export function parseMode(search: string, serverMode = true): Mode {
  const params = new URLSearchParams(search);
  const mode = params.get('mode');
  if (mode === 'server') return serverMode ? 'server' : 'p2p';
  if (mode === 'offline' || mode === 'p2p') return mode;
  const legacy = params.get('offline');
  return legacy === '1' || legacy === 'true' ? 'offline' : 'p2p';
}

/** 邀請連結要保留的模式參數（房主模式的客人必須用中繼連到房主）。 */
export const MODE_PARAM = 'mode';

/** 切換模式後要前往的網址：保留其他參數，拿掉舊的 offline 參數與邀請（邀請只屬於房主模式）。 */
export function modeUrl(href: string, mode: Mode): string {
  const url = new URL(href);
  url.searchParams.delete('offline');
  url.searchParams.delete('room');
  if (mode === 'p2p') url.searchParams.delete(MODE_PARAM);
  else url.searchParams.set(MODE_PARAM, mode);
  return url.toString();
}

export const MODE_LABEL: Record<Mode, { title: string; hint: string }> = {
  p2p: { title: '線上對戰（房主模式）', hint: '約朋友一起玩：一人開房，其他人輸入房號加入。' },
  server: { title: '線上對戰（伺服器模式）', hint: '房間由伺服器執行，適合需要嚴格防作弊時。' },
  offline: { title: '離線單機', hint: '一個人加電腦對戰，不需要網路，也不需要房號。' },
};
