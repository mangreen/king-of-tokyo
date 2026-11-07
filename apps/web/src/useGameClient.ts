import { useCallback, useEffect, useReducer, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  EVENTS,
  PROTOCOL_VERSION,
  ServerHelloSchema,
  type Ack,
  type GameActionInput,
} from '@kot/protocol';
import { ackMessage } from './messages.js';
import { session } from './session.js';
import { appReducer, initialAppState, type AppState } from './state.js';

const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'http://localhost:3001';
const ACK_TIMEOUT_MS = 5_000;

export interface GameClient {
  state: AppState;
  /** 用暱稱登入（沒有帳號）；之後以 token 自動重連。 */
  login(nickname: string): void;
  logout(): void;
  createRoom(): void;
  joinRoom(code: string): void;
  leaveRoom(): void;
  setReady(ready: boolean): void;
  startGame(): void;
  act(action: GameActionInput): void;
  dismissNotice(): void;
}

export function useGameClient(): GameClient {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const socketRef = useRef<Socket | null>(null);

  const disconnect = useCallback(() => {
    socketRef.current?.removeAllListeners();
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, []);

  const login = useCallback(
    (nickname: string) => {
      disconnect();
      dispatch({ type: 'connecting' });
      const socket = io(SERVER_URL, { transports: ['websocket'] });
      socketRef.current = socket;

      // 每次（重新）連線都重送握手，帶上 token 就會接回原身分與座位
      socket.on('connect', () => {
        const token = session.token();
        socket.emit(EVENTS.clientHello, {
          protocolVersion: PROTOCOL_VERSION,
          nickname,
          ...(token === null ? {} : { sessionToken: token }),
        });
      });
      socket.on(EVENTS.serverHello, (payload: unknown) => {
        const parsed = ServerHelloSchema.safeParse(payload);
        if (parsed.success) session.save(parsed.data.nickname, parsed.data.sessionToken);
        dispatch({ type: 'hello', payload });
      });
      socket.on(EVENTS.serverError, (payload: unknown) => {
        dispatch({ type: 'server-error', payload });
      });
      socket.on(EVENTS.roomState, (payload: unknown) => {
        dispatch({ type: 'room-state', payload });
      });
      socket.on(EVENTS.gameUpdate, (payload: unknown) => {
        dispatch({ type: 'game-update', payload, at: Date.now() });
      });
      socket.on('connect_error', () => {
        dispatch({ type: 'transport-error' });
      });
      socket.on('disconnect', () => {
        dispatch({ type: 'disconnected' });
      });
    },
    [disconnect],
  );

  const logout = useCallback(() => {
    disconnect();
    session.clear();
    dispatch({ type: 'reset' });
  }, [disconnect]);

  const request = useCallback((event: string, payload: unknown) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      dispatch({ type: 'notice', message: '尚未連線到伺服器' });
      return;
    }
    socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(event, payload)
      .then((ack: Ack) => {
        if (!ack.ok) dispatch({ type: 'notice', message: ackMessage(ack.code) });
      })
      .catch(() => {
        dispatch({ type: 'notice', message: '伺服器沒有回應，請稍後再試' });
      });
  }, []);

  // 重新整理頁面後，用同一分頁保存的身分自動接回
  useEffect(() => {
    const nickname = session.nickname();
    if (nickname !== null && session.token() !== null) login(nickname);
    return disconnect;
  }, [login, disconnect]);

  return {
    state,
    login,
    logout,
    createRoom: () => {
      request(EVENTS.roomCreate, {});
    },
    joinRoom: (code) => {
      request(EVENTS.roomJoin, { code });
    },
    leaveRoom: () => {
      request(EVENTS.roomLeave, {});
    },
    setReady: (ready) => {
      request(EVENTS.roomReady, { ready });
    },
    startGame: () => {
      request(EVENTS.roomStart, {});
    },
    act: (action) => {
      request(EVENTS.gameAction, action);
    },
    dismissNotice: () => {
      dispatch({ type: 'notice', message: null });
    },
  };
}
