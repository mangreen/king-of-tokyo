import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  EVENTS,
  PROTOCOL_VERSION,
  ServerHelloSchema,
  type Ack,
  type GameActionInput,
} from '@kot/protocol';
import { ACTIVITY_EVENTS, createActivityPing } from './activity.js';
import { ackMessage } from './messages.js';
import type { ClientLink, LinkFactory } from './net/link.js';
import { session } from './session.js';
import { appReducer, initialAppState, type AppState } from './state.js';

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

export interface GameClientOptions {
  /** 怎麼連到遊戲主機：伺服器（Socket.IO）或本機離線主機（Worker）。 */
  link: LinkFactory;
  /** 是否把身分存在分頁（用於重新整理後接回）。離線主機重新整理就消失，所以不存。 */
  persistSession: boolean;
}

export function useGameClient({ link, persistSession }: GameClientOptions): GameClient {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const linkRef = useRef<ClientLink | null>(null);

  const disconnect = useCallback(() => {
    linkRef.current?.close();
    linkRef.current = null;
  }, []);

  const login = useCallback(
    (nickname: string) => {
      disconnect();
      dispatch({ type: 'connecting' });
      // 先建立連線再指派：handlers 只會在非同步事件裡被呼叫，不會在 link() 回傳前觸發
      const connection: ClientLink = link({
        // 每次（重新）連線都重送握手，帶上 token 就會接回原身分與座位
        onOpen: () => {
          const token = persistSession ? session.token() : null;
          connection.emit(EVENTS.clientHello, {
            protocolVersion: PROTOCOL_VERSION,
            nickname,
            ...(token === null ? {} : { sessionToken: token }),
          });
        },
        onEvent: (event, payload) => {
          switch (event) {
            case EVENTS.serverHello: {
              const parsed = ServerHelloSchema.safeParse(payload);
              if (parsed.success && persistSession) {
                session.save(parsed.data.nickname, parsed.data.sessionToken);
              }
              dispatch({ type: 'hello', payload });
              break;
            }
            case EVENTS.serverError:
              dispatch({ type: 'server-error', payload });
              break;
            case EVENTS.roomState:
              dispatch({ type: 'room-state', payload });
              break;
            case EVENTS.gameCards:
              dispatch({ type: 'game-cards', payload });
              break;
            case EVENTS.gameUpdate:
              dispatch({ type: 'game-update', payload, at: Date.now() });
              break;
          }
        },
        onError: (code) => {
          dispatch({ type: 'transport-error', ...(code === undefined ? {} : { code }) });
        },
        onClose: () => {
          dispatch({ type: 'disconnected' });
        },
      });
      linkRef.current = connection;
    },
    [disconnect, link, persistSession],
  );

  const logout = useCallback(() => {
    disconnect();
    session.clear();
    dispatch({ type: 'reset' });
  }, [disconnect]);

  const reconnect = useCallback(() => {
    const nickname = persistSession ? session.nickname() : null;
    if (nickname === null) {
      dispatch({ type: 'reset' });
      return;
    }
    login(nickname);
  }, [login, persistSession]);

  // 使用者有操作就通知伺服器「我還在」；沒有操作（丟著不管、分頁在背景）就不送，
  // 伺服器會在閒置一段時間後中斷連線，不再佔用執行個體的計費時間。
  useEffect(() => {
    const ping = createActivityPing(
      () => {
        const connection = linkRef.current;
        if (!connection?.connected) return false;
        connection.emit(EVENTS.clientActive);
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
    const connection = linkRef.current;
    if (!connection?.connected) {
      dispatch({ type: 'notice', message: '尚未連線到伺服器' });
      return;
    }
    connection
      .request(event, payload, ACK_TIMEOUT_MS)
      .then((ack: Ack) => {
        if (!ack.ok) dispatch({ type: 'notice', message: ackMessage(ack.code) });
      })
      .catch(() => {
        dispatch({ type: 'notice', message: '伺服器沒有回應，請稍後再試' });
      });
  }, []);

  // 重新整理頁面後，用同一分頁保存的身分自動接回
  useEffect(() => {
    const nickname = persistSession ? session.nickname() : null;
    if (nickname !== null && session.token() !== null) login(nickname);
    return disconnect;
  }, [login, disconnect, persistSession]);

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
