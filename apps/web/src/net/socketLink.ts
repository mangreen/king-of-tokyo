import { io } from 'socket.io-client';
import type { Ack } from '@kot/protocol';
import type { ClientLink, LinkFactory, LinkHandlers } from './link.js';

/** 伺服器模式：Socket.IO（只用 WebSocket）。 */
export function socketLinkFactory(url: string): LinkFactory {
  return (handlers: LinkHandlers): ClientLink => {
    const socket = io(url, { transports: ['websocket'] });
    socket.on('connect', () => {
      handlers.onOpen();
    });
    socket.onAny((event: string, payload: unknown) => {
      handlers.onEvent(event, payload);
    });
    socket.on('connect_error', () => {
      handlers.onError();
    });
    socket.on('disconnect', () => {
      handlers.onClose();
    });
    return {
      get connected() {
        return socket.connected;
      },
      emit(event, payload) {
        if (payload === undefined) socket.emit(event);
        else socket.emit(event, payload);
      },
      request(event, payload, timeoutMs): Promise<Ack> {
        return socket.timeout(timeoutMs).emitWithAck(event, payload) as Promise<Ack>;
      },
      close() {
        socket.removeAllListeners();
        socket.offAny();
        socket.disconnect();
      },
    };
  };
}
