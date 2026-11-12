/**
 * 直連（WebRTC）設定。預設開啟；`?direct=0`（或建置時 VITE_DIRECT=0）關閉，全部走中繼。
 * ICE 伺服器只有 STUN（用來讓雙方知道自己的公開位址），**沒有 TURN 轉送**：
 * 兩端 NAT 太嚴格連不上時，就維持走我們自己的中繼，不會經過任何第三方轉送資料。
 * 代價：向 STUN 伺服器查詢位址時，對方會看到你的 IP；`VITE_ICE_SERVERS` 可換成自己的或留空（只用區網位址）。
 */
export const DEFAULT_ICE_SERVERS = ['stun:stun.l.google.com:19302'];

export interface DirectConfig {
  enabled: boolean;
  iceServers: { urls: string }[];
}

/** 逗號分隔的 stun:／turn: 網址；undefined＝預設，空字串＝不使用 ICE 伺服器。 */
export function parseIceServers(raw: string | undefined): { urls: string }[] {
  const list = raw === undefined ? DEFAULT_ICE_SERVERS : raw.split(',');
  return list
    .map((url) => url.trim())
    .filter((url) => /^(stun|turn|stuns|turns):/.test(url))
    .map((urls) => ({ urls }));
}

export function parseDirectConfig(
  search: string,
  env: { VITE_DIRECT?: string | undefined; VITE_ICE_SERVERS?: string | undefined },
  supported: boolean,
): DirectConfig {
  const param = new URLSearchParams(search).get('direct');
  const disabled =
    param === '0' || param === 'false' || (param === null && env.VITE_DIRECT === '0');
  return { enabled: supported && !disabled, iceServers: parseIceServers(env.VITE_ICE_SERVERS) };
}

export function rtcSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined';
}
