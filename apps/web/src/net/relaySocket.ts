import { io } from 'socket.io-client';
import { RELAY_NAMESPACE } from '@kot/protocol';
import type { RelaySocket } from '@kot/room';

/**
 * Socket.IO 版的中繼連線。房主用 lazy（要登記房號時才連線，沒開房就不佔伺服器連線）；
 * 客人建立時就連線。自動重連開著：短暫斷線後由房主橋接／客人端點重新登記或加入。
 */
export function createRelaySocket(serverUrl: string, options: { lazy: boolean }): RelaySocket {
  const socket = io(`${serverUrl}${RELAY_NAMESPACE}`, {
    transports: ['websocket'],
    autoConnect: !options.lazy,
  });
  return {
    get connected() {
      return socket.connected;
    },
    emit(event, payload, ack) {
      if (ack) socket.emit(event, payload, ack);
      else if (payload === undefined) socket.emit(event);
      else socket.emit(event, payload);
    },
    onEvent: (event, handler) => {
      socket.on(event, handler);
    },
    onConnect: (handler) => {
      socket.on('connect', handler);
    },
    onDisconnect: (handler) => {
      socket.on('disconnect', handler);
    },
    onConnectError: (handler) => {
      socket.on('connect_error', handler);
    },
    connect: () => {
      if (!socket.active) socket.connect();
    },
    // 暫時中斷但保留訂閱（直連建立後不再佔用伺服器連線）；之後 connect() 可再連上，不會自動重連
    pause: () => {
      socket.disconnect();
    },
    disconnect: () => {
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
