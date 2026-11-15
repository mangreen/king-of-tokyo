/**
 * 房主模式：在房主的瀏覽器（Worker）裡把「頁面自己的連線」與「中繼上的客人」放進同一個本機主機。
 * 頁面第一次要求 room:create 時才向中繼登記房號（沒開房就不佔伺服器的房號與連線）。
 */
import { EVENTS, type Ack } from '@kot/protocol';
import type { Seed } from '@kot/rules';
import { beginCeremony, finishCeremony, type Ceremony } from '../audit/ceremony.js';
import { createLocalHost, type LocalHost, type LocalHostOptions } from '../local/host.js';
import type { ToClient, ToHost } from '../local/protocol.js';
import { RECOVERY_GRACE_MS } from '../host.js';
import { randomSeed } from '../random.js';
import { RoomSaver, type RoomStore } from '../persist.js';
import type { RoomReplica } from '../replica.js';
import {
  HostBridge,
  type BridgeStatus,
  type HostBridgeOptions,
  type TakeoverResult,
} from './hostBridge.js';
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
  /**
   * 後備房主接手（M9）第一步：把複本還原到本機主機（只做一次）。成功後才能呼叫 takeover。
   * 失敗（複本損毀、卡牌組不符）時回傳原因，呼叫端應放棄這個主機。
   */
  prepare(replica: RoomReplica): { ok: true } | { ok: false; reason: string };
  /** 第二步：向中繼出示接手金鑰。太早（too_early）時可以稍後再呼叫。 */
  takeover(code: string, key: string): Promise<TakeoverResult>;
  /** 等待目前排隊的存檔寫入完成（測試用）。 */
  flush(): Promise<void>;
}

export type RelayedHostOptions = LocalHostOptions & {
  socket: RelaySocket;
  /** 直連與停泊的設定；不提供 direct 就是純中繼（M6 行為）。 */
  bridge?: Omit<HostBridgeOptions, 'canPark'>;
  /** 有提供就會持續存檔，房主重新整理後可以用 restore 接回。 */
  store?: RoomStore;
  /** 還原後的復原寬限（毫秒）。 */
  recoveryGraceMs?: number;
  /** 種子共同產生（M10）。預設開啟；關掉就和以前一樣由房主單方面抽種子。 */
  ceremony?: { enabled?: boolean; timeoutMs?: number };
};

/** 等客人回送貢獻的上限（毫秒）。全部回來就提早結束，所以正常情況只是一個往返。 */
export const SEED_CEREMONY_TIMEOUT_MS = 5_000;

export function createRelayedHost(options: RelayedHostOptions): RelayedHost {
  const { store } = options;
  // saver 要等 local／bridge 都建好才能讀到內容，所以用延遲取得
  let saver: RoomSaver | null = null;
  let bridgeRef: HostBridge | null = null;

  // ── 種子共同產生（M10）──────────────────────────────
  const baseSeed = options.newSeed ?? randomSeed;
  /** 下一次開局要用的種子（儀式算出來的）；用過即丟。 */
  let pendingSeed: Seed | null = null;
  /** 目前這局種子的儀式紀錄；只有 seed 與房間的種子相同時才算數（換局後自動失效）。 */
  let ceremony: { record: Ceremony; seed: Seed } | null = null;
  let attemptCounter = 0;
  let ceremonyRunning = false;
  /** 房主自己的頁面的玩家 id（握手後才知道）；種子的 missing 不把房主自己算進去。 */
  let hostPlayerId: string | undefined;
  const ceremonyEnabled = options.ceremony?.enabled !== false;

  const local = createLocalHost({
    ...options,
    newSeed: () => {
      const seed = pendingSeed ?? baseSeed();
      pendingSeed = null;
      return seed;
    },
    onRoomChange: (code) => {
      saver?.request(code);
      bridgeRef?.pushReplicas(); // 後備房主的複本（M9）
      options.onRoomChange?.(code);
    },
    onRoomClosed: (code) => {
      saver?.remove(code);
      options.onRoomClosed?.(code);
    },
  });
  /** 把「開始對局」攔下來：先和客人共同產生種子，再交給房間開局。 */
  const withCeremony = (
    send: (message: ToClient) => void,
    receive: (message: ToHost) => void,
  ): ((message: ToHost) => void) => {
    return (message) => {
      const code = bridgeRef?.code ?? null;
      if (
        !ceremonyEnabled ||
        message.t !== 'event' ||
        message.event !== EVENTS.roomStart ||
        code === null ||
        local.host.exportRoom(code)?.phase !== 'lobby'
      ) {
        receive(message);
        return;
      }
      if (ceremonyRunning) {
        if (message.ackId !== undefined) {
          send({ t: 'ack', ackId: message.ackId, result: { ok: false, code: 'wrong_state' } });
        }
        return;
      }
      ceremonyRunning = true;
      attemptCounter = Math.max(attemptCounter, ceremony?.record.attempt ?? 0) + 1;
      const begun = beginCeremony(code, attemptCounter);
      void bridgeRef
        ?.collectSeed(
          begun.attempt,
          begun.commit,
          options.ceremony?.timeoutMs ?? SEED_CEREMONY_TIMEOUT_MS,
        )
        .then((parts) => {
          ceremonyRunning = false;
          const before = local.host.exportRoom(code);
          const expected = (before?.members ?? [])
            .filter((m) => !m.bot && !m.left && m.id !== hostPlayerId)
            .map((m) => m.id);
          if (parts.size > 0 || expected.length > 0) {
            const done = finishCeremony(code, begun, Object.fromEntries(parts), expected);
            pendingSeed = done.seed;
            receive(message);
            pendingSeed = null;
            const after = local.host.exportRoom(code);
            ceremony =
              after?.seed === done.seed ? { record: done.ceremony, seed: done.seed } : null;
          } else {
            // 房間裡只有房主一位真人：沒有人可以一起抽，維持單方面抽種子
            receive(message);
            ceremony = null;
          }
          bridgeRef?.evaluate();
        });
    };
  };

  /** 複本帶上儀式紀錄（要與複本裡的種子相符）。 */
  const withRecord = (replica: RoomReplica): RoomReplica =>
    ceremony !== null && replica.seed === ceremony.seed
      ? { ...replica, ceremony: ceremony.record }
      : replica;

  /** 接手或還原：沿用複本裡的儀式紀錄，局後這位房主才拿得出稽核用的資料。 */
  const adoptCeremony = (replica: RoomReplica): void => {
    ceremony =
      replica.ceremony && replica.seed !== null
        ? { record: replica.ceremony, seed: replica.seed }
        : null;
  };

  const bridge = new HostBridge(
    {
      ...local,
      connect: (send) => withCeremony(send, local.connect(send)),
    },
    options.socket,
    {
      ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
      ...options.bridge,
      canPark: () => local.host.rooms.allSteady,
      replica: () => {
        const code = bridgeRef?.code;
        const replica = code === undefined || code === null ? null : local.host.exportRoom(code);
        return replica ? withRecord(replica) : null;
      },
    },
  );
  bridgeRef = bridge;
  if (store) {
    saver = new RoomSaver(store, (code) => {
      const creds = bridge.credentials;
      const replica = local.host.exportRoom(code);
      if (!creds || creds.code !== code || !replica) return null;
      return {
        version: 1,
        replica: { ...withRecord(replica), epoch: bridge.epoch },
        hostKey: creds.hostKey,
        savedAt: Date.now(),
        takeoverKeys: bridge.takeoverKeys,
      };
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
      adoptCeremony(save.replica);
      if (save.takeoverKeys) bridge.loadTakeoverKeys(save.takeoverKeys);
      bridge.adopt({ code, hostKey: save.hostKey, epoch: save.replica.epoch });
      return { ok: true };
    },
    prepare(replica) {
      const result = local.host.importRoom(replica, options.recoveryGraceMs ?? RECOVERY_GRACE_MS);
      if (result.ok) adoptCeremony(replica);
      return result.ok ? { ok: true } : result;
    },
    takeover: (code, key) => bridge.takeover(code, key),
    connectPage(page) {
      const send = (message: ToClient): void => {
        if (message.t === 'emit' && message.event === EVENTS.serverHello) {
          const id = (message.payload as { playerId?: unknown } | null)?.playerId;
          if (typeof id === 'string') hostPlayerId = id;
        }
        page(message);
      };
      const receive = withCeremony(send, local.connect(send));

      // 中繼把房間關了（閒置、無法接回…）：告訴頁面，並結束頁面這條連線
      bridge.onStatus((status: BridgeStatus) => {
        if (status.state !== 'closed') return;
        // 房主被新房主取代（房主轉移）：不是房間關閉，由角色切換端點接手處理
        if (status.reason === 'superseded') return;
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
