/**
 * 離線主機：在本機（Worker 或測試中的同一執行緒）跑一份完整的 @kot/room——
 * 與伺服器模式相同的閘道、房間、計時與電腦玩家，只是傳輸換成 postMessage。
 */
import type { LoadedCardSet } from '@kot/cardsets/pure';
import type { GatewayConn, ServerEventMap } from '../gateway.js';
import { createGameHost, type GameHost } from '../host.js';
import type { Timings } from '../room.js';
import { realScheduler, type Scheduler } from '../scheduler.js';
import type { ToClient, ToHost } from './protocol.js';

export interface LocalHostOptions {
  cardSet: LoadedCardSet;
  /** 測試可注入假時鐘；預設用真實計時器。 */
  scheduler?: Scheduler;
  timings?: Timings;
  /** 房間內容改變／關閉時通知（持久化用）。 */
  onRoomChange?: (code: string) => void;
  onRoomClosed?: (code: string) => void;
}

export interface LocalHost {
  host: GameHost;
  /** 接上一個客戶端；回傳收訊函式。send 會收到 open／emit／ack／closed。 */
  connect(send: (message: ToClient) => void): (message: ToHost) => void;
}

export function createLocalHost(options: LocalHostOptions): LocalHost {
  const host = createGameHost({
    scheduler: options.scheduler ?? realScheduler,
    cardSets: new Map([[options.cardSet.set.id, options.cardSet]]),
    defaultCardSetId: options.cardSet.set.id,
    // 離線只有自己一個人：一間房就夠，也不需要閒置踢除（沒有伺服器要保護）
    maxRooms: 1,
    idleKickMs: 0,
    ...(options.timings === undefined ? {} : { timings: options.timings }),
    ...(options.onRoomChange === undefined ? {} : { onRoomChange: options.onRoomChange }),
    ...(options.onRoomClosed === undefined ? {} : { onRoomClosed: options.onRoomClosed }),
  });
  let serial = 0;

  return {
    host,
    connect(send) {
      serial += 1;
      const conn: GatewayConn = {
        id: `local-${String(serial)}`,
        emit<E extends keyof ServerEventMap>(event: E, payload: ServerEventMap[E]): void {
          send({ t: 'emit', event: String(event), payload });
        },
        close(): void {
          send({ t: 'closed' });
        },
      };
      const handle = host.gateway.connect(conn);
      send({ t: 'open' });
      return (message) => {
        if (message.t === 'close') {
          handle.closed();
          return;
        }
        const { ackId } = message;
        handle.receive(
          message.event,
          message.payload,
          ackId === undefined
            ? undefined
            : (result: never) => {
                send({ t: 'ack', ackId, result });
              },
        );
      };
    },
  };
}
