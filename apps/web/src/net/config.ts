import { resolveServerUrl } from '../serverUrl.js';
import type { GameClientOptions } from '../useGameClient.js';
import { parseOffline } from './offline.js';
import { localLinkFactory } from './localLink.js';
import { createWorkerEndpoint } from './localWorker.js';
import { socketLinkFactory } from './socketLink.js';

/** 依網址決定怎麼連：預設連伺服器；`?offline=1` 在本分頁跑一份本機主機（Worker）。 */
export function createClientOptions(
  location: { search: string; origin: string },
  serverUrl: string | undefined,
): GameClientOptions & { offline: boolean } {
  if (parseOffline(location.search)) {
    return {
      link: localLinkFactory(createWorkerEndpoint),
      persistSession: false,
      offline: true,
    };
  }
  return {
    link: socketLinkFactory(resolveServerUrl(serverUrl, location.origin)),
    persistSession: true,
    offline: false,
  };
}
