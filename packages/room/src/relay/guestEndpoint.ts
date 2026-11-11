/**
 * 客人端點：LocalEndpoint 的中繼版。把「對房主的訊息」包進中繼的 data 送出，
 * 並把房主的訊息還原。頁面端（localLink）完全不知道訊息經過了伺服器。
 */
import { RELAY_EVENTS, RELAY_PROTOCOL_VERSION, type RelayJoinAck } from '@kot/protocol';
import { ToClientSchema, type LocalEndpoint, type ToClient } from '../local/protocol.js';
import type { RelaySocket } from './socket.js';

export function createGuestEndpoint(socket: RelaySocket, code: string): LocalEndpoint {
  let handler: (message: ToClient) => void = () => undefined;
  let alive = true;
  const deliver = (message: ToClient): void => {
    if (alive) handler(message);
  };

  // 每次（重新）連上中繼都重新加入；房主那邊會把我們接成一條新連線並送來 open
  socket.onConnect(() => {
    socket.emit(RELAY_EVENTS.join, { relayVersion: RELAY_PROTOCOL_VERSION, code }, (result) => {
      const ack = result as RelayJoinAck;
      if (!ack.ok) deliver({ t: 'error', code: ack.code });
    });
  });
  socket.onConnectError(() => {
    deliver({ t: 'error', code: 'unreachable' });
  });
  socket.onDisconnect(() => {
    deliver({ t: 'closed' });
  });
  socket.onEvent(RELAY_EVENTS.fromHost, (payload) => {
    if (typeof payload !== 'object' || payload === null) return;
    const parsed = ToClientSchema.safeParse((payload as { data?: unknown }).data);
    if (parsed.success) deliver(parsed.data as ToClient);
  });
  socket.onEvent(RELAY_EVENTS.hostStatus, (payload) => {
    // 房主暫時離線：先當作連線中斷；房主接回後會替我們換一條新連線並送 open
    if ((payload as { online?: unknown } | null)?.online === false) deliver({ t: 'closed' });
  });
  socket.onEvent(RELAY_EVENTS.closed, () => {
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
      socket.emit(RELAY_EVENTS.toHost, { data: message });
    },
    listen(next) {
      handler = next;
    },
    terminate() {
      alive = false;
      socket.disconnect();
    },
  };
}
