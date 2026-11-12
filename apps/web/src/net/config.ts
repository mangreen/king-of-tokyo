import { createGuestEndpoint } from '@kot/room';
import { parseDirectConfig, rtcSupported } from './direct.js';
import { setPathStatus } from './pathStatus.js';
import { createRtcConnector } from './rtcConnector.js';
import { resolveServerUrl } from '../serverUrl.js';
import type { GameClientOptions } from '../useGameClient.js';
import { localLinkFactory } from './localLink.js';
import { createWorkerEndpoint } from './localWorker.js';
import { parseMode, type Mode } from './mode.js';
import { createRelaySocket } from './relaySocket.js';
import { socketLinkFactory } from './socketLink.js';

export type ClientOptions = GameClientOptions & {
  mode: Mode;
  /**
   * 房主模式：登入前設定要加入的房號（客人）；不設定就是自己當房主。
   * 連線方式在登入時才決定，所以這個值要在呼叫 login 之前設好。
   */
  target: { code: string | null };
};

/** 依網址決定怎麼連：預設連伺服器；offline＝本分頁的本機主機；p2p＝房主模式（經中繼）。 */
export function createClientOptions(
  location: { search: string; origin: string },
  serverUrl: string | undefined,
): ClientOptions {
  const mode = parseMode(location.search);
  const target: { code: string | null } = { code: null };
  const url = resolveServerUrl(serverUrl, location.origin);

  if (mode === 'offline') {
    return {
      mode,
      target,
      link: localLinkFactory(() => createWorkerEndpoint()),
      persistSession: false,
    };
  }
  if (mode === 'p2p') {
    const direct = parseDirectConfig(
      location.search,
      import.meta.env as { VITE_DIRECT?: string; VITE_ICE_SERVERS?: string },
      rtcSupported(),
    );
    const connector = direct.enabled ? createRtcConnector(direct.iceServers) : undefined;
    return {
      mode,
      target,
      // 有房號＝客人（經中繼連到房主）；沒有＝自己當房主（Worker 跑房間，要開房時才向中繼登記）
      link: (handlers) => {
        const code = target.code;
        const factory =
          code === null
            ? localLinkFactory(() =>
                createWorkerEndpoint({
                  relayUrl: url,
                  ...(connector === undefined ? {} : { direct: connector }),
                  onPath: (info) => {
                    setPathStatus({ role: 'host', ...info });
                  },
                }),
              )
            : localLinkFactory(() =>
                createGuestEndpoint(createRelaySocket(url, { lazy: false }), code, {
                  ...(connector === undefined ? {} : { direct: connector }),
                  onPath: (path) => {
                    setPathStatus({ role: 'guest', path });
                  },
                }),
              );
        return factory(handlers);
      },
      // 重新整理會讓房主的房間消失，客人也無法接回（M8 才做）：不保存身分
      persistSession: false,
    };
  }
  return { mode, target, link: socketLinkFactory(url), persistSession: true };
}
