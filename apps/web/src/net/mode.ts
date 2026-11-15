/**
 * 連線模式（網址參數 `mode`，舊的 `?offline=1` 仍可用）：
 * - p2p：房主模式（預設）。房主的瀏覽器跑房間，伺服器只登記房號與轉送訊息（ADR-0007）
 * - server：伺服器權威模式（`?mode=server`）。伺服器跑房間，需要嚴格防作弊時用
 * - offline：本分頁跑一份本機主機，不連伺服器（單人加電腦）
 */
export type Mode = 'server' | 'offline' | 'p2p';

export function parseMode(search: string): Mode {
  const params = new URLSearchParams(search);
  const mode = params.get('mode');
  if (mode === 'offline' || mode === 'p2p' || mode === 'server') return mode;
  const legacy = params.get('offline');
  return legacy === '1' || legacy === 'true' ? 'offline' : 'p2p';
}

/** 邀請連結要保留的模式參數（房主模式的客人必須用中繼連到房主）。 */
export const MODE_PARAM = 'mode';
