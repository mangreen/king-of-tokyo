/** Socket.IO 轉接：把 /relay 命名空間的連線接到 RelayRegistry。 */
import type { Namespace, Socket } from 'socket.io';
import { RELAY_EVENTS, type RelayServerEvents } from '@kot/protocol';
import type { RelayRegistry } from './registry.js';
import { type RelayConn } from './registry.js';

export function attachRelay(
  namespace: Namespace,
  registry: RelayRegistry,
  /** 連線數已達上限時回傳 true：新連線被告知名額已滿並中斷。 */
  isFull: () => boolean,
): void {
  namespace.on('connection', (socket: Socket) => {
    if (isFull()) {
      socket.emit(RELAY_EVENTS.error, { code: 'server_full' });
      socket.disconnect(true);
      return;
    }
    const conn: RelayConn = {
      id: socket.id,
      send<E extends keyof RelayServerEvents>(event: E, payload: RelayServerEvents[E]): void {
        socket.emit(event, payload);
      },
      close(): void {
        socket.disconnect(true);
      },
    };
    registry.connected(conn);

    const reply = (ack: unknown, result: unknown): void => {
      if (typeof ack === 'function') (ack as (r: unknown) => void)(result);
    };
    socket.on(RELAY_EVENTS.hostOpen, (payload: unknown, ack?: unknown) => {
      reply(ack, registry.hostOpen(conn, payload));
    });
    socket.on(RELAY_EVENTS.join, (payload: unknown, ack?: unknown) => {
      reply(ack, registry.join(conn, payload));
    });
    socket.on(RELAY_EVENTS.toHost, (payload: unknown) => {
      registry.toHost(conn, payload);
    });
    socket.on(RELAY_EVENTS.toGuest, (payload: unknown) => {
      registry.toGuest(conn, payload);
    });
    socket.on(RELAY_EVENTS.kick, (payload: unknown) => {
      registry.kick(conn, payload);
    });
    socket.on(RELAY_EVENTS.park, (_payload: unknown, ack?: unknown) => {
      reply(ack, registry.park(conn));
    });
    socket.on(RELAY_EVENTS.succession, (payload: unknown, ack?: unknown) => {
      reply(ack, registry.succession(conn, payload));
    });
    socket.on(RELAY_EVENTS.takeover, (payload: unknown, ack?: unknown) => {
      reply(ack, registry.takeover(conn, payload));
    });
    socket.on(RELAY_EVENTS.handover, (payload: unknown, ack?: unknown) => {
      reply(ack, registry.handover(conn, payload));
    });
    socket.on(RELAY_EVENTS.ping, () => {
      registry.ping(conn);
    });
    socket.on('disconnect', () => {
      registry.disconnected(conn);
    });
  });
}
