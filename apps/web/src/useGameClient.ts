import { useCallback, useEffect, useReducer, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  EVENTS,
  PROTOCOL_VERSION,
  ServerHelloSchema,
  type Ack,
  type GameActionInput,
} from '@kot/protocol';
import { ACTIVITY_EVENTS, createActivityPing } from './activity.js';
import { ackMessage } from './messages.js';
import { resolveServerUrl } from './serverUrl.js';
import { session } from './session.js';
import { appReducer, initialAppState, type AppState } from './state.js';

const SERVER_URL: string = resolveServerUrl(
  import.meta.env.VITE_SERVER_URL as string | undefined,
  window.location.origin,
);
const ACK_TIMEOUT_MS = 5_000;
/** 使用者有操作時，最多每隔這麼久通知伺服器一次（伺服器的閒置上限是分鐘等級）。 */
const ACTIVITY_INTERVAL_MS = 20_000;

export interface GameClient {
  state: AppState;
  /** 用暱稱登入（沒有帳號）；之後以 token 自動重連。 */
  login(nickname: string): void;
  logout(): void;
  /** 被閒置踢除後，用原本的身分重新連線（接回座位）。 */
  reconnect(): void;
  createRoom(cardSetId?: string): void;
  joinRoom(code: string): void;
  leaveRoom(): void;
  setReady(ready: boolean): void;
  startGame(): void;
  /** 房主在大廳加入／移除電腦玩家。 */
  addBot(): void;
  removeBot(id: string): void;
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
      socket.on(EVENTS.gameCards, (payload: unknown) => {
        dispatch({ type: 'game-cards', payload });
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

  const reconnect = useCallback(() => {
    const nickname = session.nickname();
    if (nickname === null) {
      dispatch({ type: 'reset' });
      return;
    }
    login(nickname);
  }, [login]);

  // 使用者有操作就通知伺服器「我還在」；沒有操作（丟著不管、分頁在背景）就不送，
  // 伺服器會在閒置一段時間後中斷連線，不再佔用執行個體的計費時間。
  useEffect(() => {
    const ping = createActivityPing(
      () => {
        const socket = socketRef.current;
        if (!socket?.connected) return false;
        socket.emit(EVENTS.clientActive);
        return true;
      },
      () => Date.now(),
      ACTIVITY_INTERVAL_MS,
    );
    const touch = (): void => {
      if (document.visibilityState === 'visible') ping.touch();
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, touch, { passive: true });
    document.addEventListener('visibilitychange', touch);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, touch);
      document.removeEventListener('visibilitychange', touch);
    };
  }, []);

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
    reconnect,
    createRoom: (cardSetId) => {
      request(EVENTS.roomCreate, cardSetId === undefined ? {} : { cardSetId });
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
    addBot: () => {
      request(EVENTS.roomAddBot, {});
    },
    removeBot: (id) => {
      request(EVENTS.roomRemoveBot, { id });
    },
    act: (action) => {
      request(EVENTS.gameAction, action);
    },
    dismissNotice: () => {
      dispatch({ type: 'notice', message: null });
    },
  };
}
