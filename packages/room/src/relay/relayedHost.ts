/**
 * 房主模式：在房主的瀏覽器（Worker）裡把「頁面自己的連線」與「中繼上的客人」放進同一個本機主機。
 * 頁面第一次要求 room:create 時才向中繼登記房號（沒開房就不佔伺服器的房號與連線）。
 */
import { EVENTS, type Ack } from '@kot/protocol';
import { createLocalHost, type LocalHost, type LocalHostOptions } from '../local/host.js';
import type { ToClient, ToHost } from '../local/protocol.js';
import { HostBridge, type BridgeStatus, type HostBridgeOptions } from './hostBridge.js';
import type { RelaySocket } from './socket.js';

export interface RelayedHost {
  local: LocalHost;
  bridge: HostBridge;
  /** 接上房主自己的頁面；回傳收訊函式（與 LocalHost.connect 相同）。 */
  connectPage(send: (message: ToClient) => void): (message: ToHost) => void;
}

export function createRelayedHost(
  options: LocalHostOptions & {
    socket: RelaySocket;
    /** 直連與停泊的設定；不提供 direct 就是純中繼（M6 行為）。 */
    bridge?: Omit<HostBridgeOptions, 'canPark'>;
  },
): RelayedHost {
  const local = createLocalHost(options);
  const bridge = new HostBridge(local, options.socket, {
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    ...options.bridge,
    canPark: () => local.host.rooms.allSteady,
  });

  return {
    local,
    bridge,
    connectPage(send) {
      const receive = local.connect(send);

      // 中繼把房間關了（閒置、無法接回…）：告訴頁面，並結束頁面這條連線
      bridge.onStatus((status: BridgeStatus) => {
        if (status.state !== 'closed') return;
        send({
          t: 'emit',
          event: EVENTS.serverError,
          payload: {
            code: status.reason === 'idle_timeout' ? 'idle_timeout' : 'room_closed',
            message:
              status.reason === 'idle_timeout'
                ? '閒置太久，房間已關閉。'
                : '與中繼伺服器的連線結束，房間已關閉。',
          },
        });
        send({ t: 'closed' });
      });

      return (message) => {
        if (message.t === 'event' && message.event === EVENTS.roomCreate && bridge.code === null) {
          const { ackId } = message;
          const reply = (result: Ack): void => {
            if (ackId !== undefined) send({ t: 'ack', ackId, result });
          };
          bridge.open().then(
            (code) => {
              local.host.rooms.presetCode(code);
              receive(message);
            },
            (error: unknown) => {
              const reason = error instanceof Error ? error.message : '';
              reply({
                ok: false,
                code: reason === 'server_full' ? 'too_many_rooms' : 'wrong_state',
              });
            },
          );
          return;
        }
        if (message.t === 'event' && message.event === EVENTS.clientActive) {
          // 房主自己有操作：也讓中繼知道，避免房主連線因閒置被踢（停泊中沒有連線，不用送）
          if (options.socket.connected) options.socket.emit('relay:ping');
        }
        if (message.t === 'close') bridge.close();
        receive(message);
        // 房主的操作（例如開始對局）可能讓房間進入「可停泊」狀態
        bridge.evaluate();
      };
    },
  };
}
