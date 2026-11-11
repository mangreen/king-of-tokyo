/**
 * Socket.IO 轉接層：把一條 socket 接到 @kot/room 的 Gateway。
 * 握手、身分、速率限制、閒置踢除與房間分派都在 Gateway（與傳輸無關，離線模式共用）。
 */
import type { Socket } from 'socket.io';
import type { EVENTS } from '@kot/protocol';
import {
  type GameCardsMessage,
  type GameUpdateMessage,
  type RoomStateMessage,
  type ServerError,
  type ServerHello,
} from '@kot/protocol';
import type { Gateway, GatewayConn, ServerEventMap } from '@kot/room';

export interface ClientToServerEvents {
  [EVENTS.clientHello]: (payload: unknown) => void;
  [EVENTS.clientActive]: (payload: unknown) => void;
  [EVENTS.roomCreate]: (payload: unknown, ack?: unknown) => void;
  [EVENTS.roomJoin]: (payload: unknown, ack?: unknown) => void;
  [EVENTS.roomLeave]: (payload: unknown, ack?: unknown) => void;
  [EVENTS.roomReady]: (payload: unknown, ack?: unknown) => void;
  [EVENTS.roomAddBot]: (payload: unknown, ack?: unknown) => void;
  [EVENTS.roomRemoveBot]: (payload: unknown, ack?: unknown) => void;
  [EVENTS.roomStart]: (payload: unknown, ack?: unknown) => void;
  [EVENTS.gameAction]: (payload: unknown, ack?: unknown) => void;
}

export interface ServerToClientEvents {
  [EVENTS.serverHello]: (payload: ServerHello) => void;
  [EVENTS.serverError]: (payload: ServerError) => void;
  [EVENTS.roomState]: (payload: RoomStateMessage) => void;
  [EVENTS.gameUpdate]: (payload: GameUpdateMessage) => void;
  [EVENTS.gameCards]: (payload: GameCardsMessage) => void;
}

export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function handleConnection(socket: GameSocket, gateway: Gateway): void {
  const conn: GatewayConn = {
    id: socket.id,
    emit<E extends keyof ServerEventMap>(event: E, payload: ServerEventMap[E]): void {
      (socket as unknown as { emit(e: string, p: unknown): void }).emit(event, payload);
    },
    close(): void {
      socket.disconnect(true);
    },
  };
  const handle = gateway.connect(conn);
  socket.onAny((event: string, payload: unknown, ack?: unknown) => {
    handle.receive(event, payload, ack);
  });
  socket.on('disconnect', () => {
    handle.closed();
  });
}
