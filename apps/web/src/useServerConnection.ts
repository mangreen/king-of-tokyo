import { useEffect, useReducer } from 'react';
import { io } from 'socket.io-client';
import { EVENTS } from '@kot/protocol';
import {
  buildHello,
  connectionReducer,
  initialConnectionState,
  type ConnectionState,
} from './connection.js';

const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'http://localhost:3001';

export function useServerConnection(nickname: string): ConnectionState {
  const [state, dispatch] = useReducer(connectionReducer, initialConnectionState);

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ['websocket'] });

    // 每次（重新）連線都重送握手
    socket.on('connect', () => socket.emit(EVENTS.clientHello, buildHello(nickname)));
    socket.on(EVENTS.serverHello, (payload: unknown) => dispatch({ type: 'hello', payload }));
    socket.on(EVENTS.serverError, (payload: unknown) =>
      dispatch({ type: 'server-error', payload }),
    );
    socket.on('connect_error', () => dispatch({ type: 'transport-error' }));
    socket.on('disconnect', () => dispatch({ type: 'disconnected' }));

    return () => {
      socket.disconnect();
    };
  }, [nickname]);

  return state;
}
