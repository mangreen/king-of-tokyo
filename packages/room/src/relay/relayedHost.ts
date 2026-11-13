/**
 * 房主模式：在房主的瀏覽器（Worker）裡把「頁面自己的連線」與「中繼上的客人」放進同一個本機主機。
 * 頁面第一次要求 room:create 時才向中繼登記房號（沒開房就不佔伺服器的房號與連線）。
 */
import { EVENTS, type Ack } from '@kot/protocol';
import { createLocalHost, type LocalHost, type LocalHostOptions } from '../local/host.js';
import type { ToClient, ToHost } from '../local/protocol.js';
import { RECOVERY_GRACE_MS } from '../host.js';
import { RoomSaver, type RoomStore } from '../persist.js';
import { HostBridge, type BridgeStatus, type HostBridgeOptions } from './hostBridge.js';
import type { RelaySocket } from './socket.js';

export interface RelayedHost {
  local: LocalHost;
  bridge: HostBridge;
  /** 接上房主自己的頁面；回傳收訊函式（與 LocalHost.connect 相同）。 */
  connectPage(send: (message: ToClient) => void): (message: ToHost) => void;
  /**
   * 房主重新整理後，從存檔還原房間並向中繼重新登記同一個房號。
   * 要在頁面連上來握手之前呼叫並等待完成；沒有存檔或存檔不能用時回傳原因（這時就當作全新的房主）。
   */
  restore(code: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** 等待目前排隊的存檔寫入完成（測試用）。 */
  flush(): Promise<void>;
}

export function createRelayedHost(
  options: LocalHostOptions & {
    socket: RelaySocket;
    /** 直連與停泊的設定；不提供 direct 就是純中繼（M6 行為）。 */
    bridge?: Omit<HostBridgeOptions, 'canPark'>;
    /** 有提供就會持續存檔，房主重新整理後可以用 restore 接回。 */
    store?: RoomStore;
    /** 還原後的復原寬限（毫秒）。 */
    recoveryGraceMs?: number;
  },
): RelayedHost {
  const { store } = options;
  // saver 要等 local／bridge 都建好才能讀到內容，所以用延遲取得
  let saver: RoomSaver | null = null;
  const local = createLocalHost({
    ...options,
    onRoomChange: (code) => {
      saver?.request(code);
      options.onRoomChange?.(code);
    },
    onRoomClosed: (code) => {
      saver?.remove(code);
      options.onRoomClosed?.(code);
    },
  });
  const bridge = new HostBridge(local, options.socket, {
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    ...options.bridge,
    canPark: () => local.host.rooms.allSteady,
  });
  if (store) {
    saver = new RoomSaver(store, (code) => {
      const creds = bridge.credentials;
      const replica = local.host.exportRoom(code);
      if (!creds || creds.code !== code || !replica) return null;
      return { version: 1, replica, hostKey: creds.hostKey, savedAt: Date.now() };
    });
    // 登記成功（拿到房主金鑰）時補存一次：房號在登記前沒有金鑰，存不了
    bridge.onStatus((status) => {
      if (status.state === 'online') saver?.request(status.code);
    });
  }

  return {
    local,
    bridge,
    flush: () => saver?.flush() ?? Promise.resolve(),
    async restore(code) {
      if (!store) return { ok: false, reason: '沒有儲存空間' };
      const save = await store.load(code);
      if (!save) return { ok: false, reason: '沒有存檔' };
      if (save.replica.code !== code) return { ok: false, reason: '存檔的房號不符' };
      const result = local.host.importRoom(
        save.replica,
        options.recoveryGraceMs ?? RECOVERY_GRACE_MS,
      );
      if (!result.ok) return result;
      bridge.adopt({ code, hostKey: save.hostKey });
      return { ok: true };
    },
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
        if (message.t === 'close') {
          // 房主主動結束（不是重新整理）：存檔不再有用
          const code = bridge.code;
          if (code !== null) saver?.remove(code);
          bridge.close();
        }
        receive(message);
        // 房主的操作（例如開始對局）可能讓房間進入「可停泊」狀態
        bridge.evaluate();
      };
    },
  };
}
