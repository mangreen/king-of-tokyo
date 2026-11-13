/**
 * 測試用：把 RelayRegistry 與房主橋接／客人端點接在記憶體裡（不經 Socket.IO、沒有真實計時器）。
 *
 * 所有事件進同一條先進先出佇列，由 pump() 依序處理：結果完全確定，也沒有重入問題。
 * 測試的節奏是「做一件事 → pump()」，時間由假時鐘控制。可以讓任何一條連線突然消失（kill）、
 * 或之後再連回來，用來做房主轉移的故障注入。
 */
import { RELAY_EVENTS, type RelayServerEvents } from '@kot/protocol';
import type { RelaySocket } from '@kot/room';
import { cryptoRandomInt, randomHex } from '@kot/room';
import type { FakeScheduler } from '@kot/room/testing';
import { RelayRegistry, type RelayConn, type RelayOptions } from './registry.js';

export interface MemorySocket extends RelaySocket {
  /** 突然消失（分頁關閉、網路中斷）：伺服器偵測到斷線，這一端收到 disconnect。 */
  kill(): void;
  /** 這條連線目前是否連著（伺服器認得）。 */
  readonly attached: boolean;
}

export interface MemoryRelay {
  registry: RelayRegistry;
  /** 新的客戶端連線（初始未連線；呼叫 connect 或由端點／橋接自己連）。 */
  socket(options?: { autoConnect?: boolean }): MemorySocket;
  /** 處理佇列直到空（含處理過程中新增的事件）。 */
  pump(): void;
  /** 目前連著的連線數。 */
  readonly connections: number;
}

export function createMemoryRelay(
  scheduler: FakeScheduler,
  overrides: Partial<RelayOptions> = {},
): MemoryRelay {
  const registry = new RelayRegistry({
    scheduler,
    maxRooms: 20,
    maxGuests: 8,
    idleKickMs: 0,
    hostGraceMs: 30_000,
    parkTtlMs: 2 * 60 * 60_000,
    hostBurst: 1_000_000,
    hostPerSecond: 1_000_000,
    roomBytesBurst: 1_000_000_000,
    roomBytesPerSecond: 1_000_000_000,
    randomInt: cryptoRandomInt,
    randomHex,
    ...overrides,
  });
  const queue: Array<() => void> = [];
  let serial = 0;
  let attached = 0;

  const pump = (): void => {
    for (let guard = 0; queue.length > 0; guard += 1) {
      if (guard > 1_000_000) throw new Error('記憶體中繼：事件佇列沒有收斂');
      queue.shift()?.();
    }
  };

  const socket = (options: { autoConnect?: boolean } = {}): MemorySocket => {
    serial += 1;
    const id = `m${String(serial)}`;
    const handlers = new Map<string, ((payload: unknown) => void)[]>();
    const onConnect: (() => void)[] = [];
    const onDisconnect: (() => void)[] = [];
    const onConnectError: (() => void)[] = [];
    let connected = false;
    /** 這個 socket 目前的伺服器端連線（每次連上都是新的）。 */
    let conn: RelayConn | null = null;
    let generation = 0;

    const fire = (list: (() => void)[]): void => {
      for (const handler of [...list]) handler();
    };

    const detach = (notifyClient: boolean): void => {
      const current = conn;
      if (!current) return;
      conn = null;
      connected = false;
      attached -= 1;
      registry.disconnected(current);
      if (notifyClient) fire(onDisconnect);
    };

    const open = (): void => {
      if (conn) return;
      generation += 1;
      const mine = generation;
      const created: RelayConn = {
        id: `${id}.${String(mine)}`,
        send<E extends keyof RelayServerEvents>(event: E, payload: RelayServerEvents[E]): void {
          queue.push(() => {
            if (conn !== created) return;
            for (const handler of handlers.get(event) ?? []) handler(payload);
          });
        },
        close(): void {
          queue.push(() => {
            if (conn === created) detach(true); // 伺服器主動中斷：不會自動重連
          });
        },
      };
      conn = created;
      connected = true;
      attached += 1;
      registry.connected(created);
      queue.push(() => {
        if (conn === created) fire(onConnect);
      });
    };

    const dispatch = (event: string, payload: unknown): unknown => {
      const current = conn;
      if (!current) return undefined;
      switch (event) {
        case RELAY_EVENTS.hostOpen:
          return registry.hostOpen(current, payload);
        case RELAY_EVENTS.join:
          return registry.join(current, payload);
        case RELAY_EVENTS.park:
          return registry.park(current);
        case RELAY_EVENTS.succession:
          return registry.succession(current, payload);
        case RELAY_EVENTS.takeover:
          return registry.takeover(current, payload);
        case RELAY_EVENTS.handover:
          return registry.handover(current, payload);
        case RELAY_EVENTS.toHost:
          return registry.toHost(current, payload);
        case RELAY_EVENTS.toGuest:
          return registry.toGuest(current, payload);
        case RELAY_EVENTS.kick:
          return registry.kick(current, payload);
        case RELAY_EVENTS.ping:
          return registry.ping(current);
        default:
          return undefined;
      }
    };

    const result: MemorySocket = {
      get connected() {
        return connected;
      },
      get attached() {
        return conn !== null;
      },
      emit(event, payload, ack) {
        if (!conn) return; // 沒連線時送出的訊息就丟掉（和真實連線的緩衝不同，較嚴格）
        const sentOn = conn;
        queue.push(() => {
          if (conn !== sentOn) return;
          const reply = dispatch(event, payload);
          if (ack) queue.push(() => ack(reply));
        });
      },
      onEvent(event, handler) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      onConnect(handler) {
        onConnect.push(handler);
      },
      onDisconnect(handler) {
        onDisconnect.push(handler);
      },
      onConnectError(handler) {
        onConnectError.push(handler);
      },
      connect() {
        open();
      },
      pause() {
        queue.push(() => {
          detach(true);
        });
      },
      disconnect() {
        queue.push(() => {
          detach(false);
          handlers.clear();
          onConnect.length = 0;
          onDisconnect.length = 0;
          onConnectError.length = 0;
        });
      },
      kill() {
        queue.push(() => {
          detach(true);
        });
      },
    };
    if (options.autoConnect !== false) open();
    return result;
  };

  return {
    registry,
    socket,
    pump,
    get connections() {
      return attached;
    },
  };
}
