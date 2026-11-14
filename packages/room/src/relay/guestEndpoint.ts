/**
 * 客人端點：LocalEndpoint 的中繼版。把「對房主的訊息」包進中繼的 data 送出，
 * 並把房主的訊息還原。頁面端（localLink）完全不知道訊息經過了伺服器，也不知道後來改走了直連。
 *
 * 直連（M7）：房主加入後會送 WebRTC 的 offer，客人回 answer；通道開啟後訊息無縫改走直連
 * （見 direct/session.ts），客人隨後關掉自己的中繼連線，不再佔伺服器連線。
 * 直連中斷時：對頁面來說就是「連線中斷」，端點重新連上中繼加入（房主會回到中繼等我們），
 * 頁面收到新的 open 後用原本的 token 重新握手、接回座位。
 */
import { RELAY_EVENTS, RELAY_PROTOCOL_VERSION, type RelayJoinAck } from '@kot/protocol';
import { DirectSession } from '../direct/session.js';
import type { DirectConnector } from '../direct/types.js';
import type { ReplicaSync } from '../failover/sync.js';
import {
  parseWireToClient,
  type LocalEndpoint,
  type ToClient,
  type ToHost,
  type WireReplica,
  type WireReplicaNeed,
  type WireRtc,
  type WireSwitch,
  type WireToClient,
} from '../local/protocol.js';
import { realScheduler, type Scheduler } from '../scheduler.js';
import type { RelaySocket } from './socket.js';

/** 客人看到的連線方式。 */
export type GuestPath = 'relay' | 'direct';

export interface GuestEndpointOptions {
  /** 連線方式改變時通知（畫面顯示用）。 */
  onPath?: (path: GuestPath) => void;
  /** 提供就會在房主邀請時建立直連。 */
  direct?: DirectConnector;
  scheduler?: Scheduler;
  /** 多久內沒連上直連就放棄（毫秒）。 */
  directTimeoutMs?: number;
  /** 雙向切換完成後，等多久再關掉中繼連線（讓最後的標記送完）。 */
  relayCloseDelayMs?: number;
  /** 加入時房主暫時離線（正在從停泊回來）：多久重試一次、最多等多久（毫秒）。 */
  joinRetryMs?: number;
  joinGiveUpMs?: number;
  /**
   * 這是重新整理後的接回（之前已經在這個房間裡）：房號在中繼上暫時找不到（房主還在重新登記、
   * 或中繼剛重啟）時，也在期限內重試，而不是立刻放棄。
   */
  resuming?: boolean;
  /** 收到房主送來的複本同步（成為後備房主用；頁面完全看不到）。 */
  onReplica?: (sync: ReplicaSync) => void;
  /**
   * 房主「不見了」或「回來了」。lost：房主的中繼斷線、直連中斷、或找不到房主；
   * back：房主（或接手的新房主）替我們開了新連線。後備房主靠這個決定何時計時接手。
   */
  onHostState?: (state: 'lost' | 'back') => void;
}

/** 客人端點：LocalEndpoint 加上「要求房主重送複本」。 */
export interface GuestEndpoint extends LocalEndpoint {
  requestReplica(): void;
}

export function createGuestEndpoint(
  socket: RelaySocket,
  code: string,
  options: GuestEndpointOptions = {},
): GuestEndpoint {
  const scheduler = options.scheduler ?? realScheduler;
  const joinRetryMs = options.joinRetryMs ?? 2_000;
  const joinGiveUpMs = options.joinGiveUpMs ?? 90_000;
  let handler: (message: ToClient) => void = () => undefined;
  let alive = true;
  /** 我們是否預期中繼連線是連著的（已改走直連而刻意關掉時為 false）。 */
  let relayWanted = true;
  let session: DirectSession<ToHost | WireReplicaNeed, ToClient | WireReplica> | null = null;
  let cancelClose: () => void = () => undefined;
  let cancelRetry: () => void = () => undefined;

  let hostLost = false;
  const setHostState = (state: 'lost' | 'back'): void => {
    if (state === 'lost' ? hostLost : !hostLost) return;
    hostLost = state === 'lost';
    options.onHostState?.(state);
  };

  const deliver = (message: WireToClient | ToClient): void => {
    if (!alive) return;
    if (message.t === 'replica') {
      options.onReplica?.(message.d);
      return;
    }
    handler(message as ToClient);
  };

  const relayEmit = (data: unknown): void => {
    socket.emit(RELAY_EVENTS.toHost, { data });
  };

  /** 房主 open 之後才建立：每一條新的閘道連線對應一個新的工作階段。 */
  const newSession = (): DirectSession<ToHost | WireReplicaNeed, ToClient | WireReplica> => {
    session?.close();
    cancelClose();
    const created: DirectSession<ToHost | WireReplicaNeed, ToClient | WireReplica> =
      new DirectSession<ToHost | WireReplicaNeed, ToClient | WireReplica>({
        role: 'guest',
        connector: options.direct ?? null,
        scheduler,
        connectTimeoutMs: options.directTimeoutMs ?? 15_000,
        sendRelay: (message) => {
          if (message.t === 'rtc' || message.t === 'switch') {
            if (socket.connected) relayEmit(message);
          } else relayEmit(message);
        },
        deliver,
        parse: (value) => {
          const parsed = parseWireToClient(value);
          // 協商與切換標記只走中繼，不會出現在直連上
          return parsed === null || parsed.t === 'rtc' || parsed.t === 'switch' ? null : parsed;
        },
        onSwitched: () => {
          options.onPath?.('direct');
          // 兩個方向都已走直連：稍等一下讓最後的標記送完，再關掉中繼連線
          if (!socket.pause) return;
          cancelClose = scheduler.after(options.relayCloseDelayMs ?? 1_000, () => {
            if (session === created && created.isDirect) {
              relayWanted = false;
              socket.pause?.();
            }
          });
        },
        onLost: () => {
          if (session !== created) return;
          resetToRelay();
        },
      });
    session = created;
    return created;
  };

  /** 直連中斷：對頁面是連線中斷；重新經中繼加入，房主會替我們換一條新連線。 */
  const resetToRelay = (): void => {
    options.onPath?.('relay');
    session?.close();
    session = null;
    cancelClose();
    deliver({ t: 'closed' });
    setHostState('lost'); // 直連斷了：可能是房主不見了（也可能只是我的網路）；接手與否由伺服器的時序決定
    relayWanted = true;
    if (socket.pause && socket.connect) {
      // 不論中繼是否還連著，都換一條全新的連線，房主那邊才會看到新的客人
      if (socket.connected) socket.pause();
      socket.connect();
    }
  };

  let joinDeadline = 0;
  /** 這個端點曾經成功加入過：之後連線中斷再回來，等同於接回。 */
  let joinedOnce = options.resuming === true;
  const join = (): void => {
    if (!alive || !socket.connected) return;
    socket.emit(RELAY_EVENTS.join, { relayVersion: RELAY_PROTOCOL_VERSION, code }, (result) => {
      const ack = result as RelayJoinAck;
      if (ack.ok) {
        joinedOnce = true;
        return;
      }
      const transient =
        ack.code === 'host_offline' || (ack.code === 'room_not_found' && joinedOnce);
      if (ack.code === 'host_offline') setHostState('lost');
      if (transient && scheduler.now() < joinDeadline) {
        // 房主正在從停泊回到中繼：稍後再試
        cancelRetry();
        cancelRetry = scheduler.after(joinRetryMs, join);
        return;
      }
      deliver({ t: 'error', code: ack.code });
    });
  };

  // 每次（重新）連上中繼都重新加入；房主那邊會把我們接成一條新連線並送來 open
  socket.onConnect(() => {
    joinDeadline = scheduler.now() + joinGiveUpMs;
    join();
  });
  socket.onConnectError(() => {
    if (relayWanted) deliver({ t: 'error', code: 'unreachable' });
  });
  socket.onDisconnect(() => {
    if (!relayWanted) return; // 已改走直連，刻意關掉的
    if (session?.isDirect) return;
    session?.close();
    session = null;
    deliver({ t: 'closed' });
  });
  socket.onEvent(RELAY_EVENTS.fromHost, (payload) => {
    if (typeof payload !== 'object' || payload === null) return;
    const message = parseWireToClient((payload as { data?: unknown }).data);
    if (message === null) return;
    if (message.t === 'rtc' || message.t === 'switch') {
      session?.receiveControl(message as WireRtc | WireSwitch);
      return;
    }
    if (message.t === 'open') {
      newSession();
      options.onPath?.('relay');
      setHostState('back');
    }
    if (session) session.receive(message);
    else deliver(message);
  });
  socket.onEvent(RELAY_EVENTS.hostStatus, (payload) => {
    // 房主暫時離線：先當作連線中斷；房主接回後會替我們換一條新連線並送 open
    if ((payload as { online?: unknown } | null)?.online === false) {
      session?.close();
      session = null;
      deliver({ t: 'closed' });
      setHostState('lost');
    }
  });
  socket.onEvent(RELAY_EVENTS.closed, () => {
    session?.close();
    session = null;
    deliver({ t: 'closed' });
  });
  socket.onEvent(RELAY_EVENTS.error, (payload) => {
    const code = (payload as { code?: unknown } | null)?.code;
    if (code === 'server_full' || code === 'room_not_found') {
      deliver({ t: 'error', code });
    }
  });

  return {
    post(message) {
      if (!alive) return;
      if (session) session.send(message);
      else relayEmit(message);
    },
    requestReplica() {
      if (!alive) return;
      const need: WireReplicaNeed = { t: 'replica-need' };
      if (session) session.send(need);
      else relayEmit(need);
    },
    listen(next) {
      handler = next;
    },
    terminate() {
      alive = false;
      cancelClose();
      cancelRetry();
      session?.close();
      session = null;
      socket.disconnect();
    },
  };
}
