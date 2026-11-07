import { describeEvent } from '@kot/rules';
import {
  ServerErrorSchema,
  ServerHelloSchema,
  type GameUpdateMessage,
  type RoomSnapshot,
  type RoomStateMessage,
} from '@kot/protocol';

export type Connection =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'online'; playerId: string; nickname: string }
  /** 已登入過、目前斷線並自動重連中：畫面保留原本的內容。 */
  | { status: 'reconnecting'; playerId: string; nickname: string }
  | { status: 'error'; message: string };

export interface AppState {
  connection: Connection;
  room: RoomSnapshot | null;
  game: GameUpdateMessage | null;
  /** 收到最新 game:update 時，本機時間算出的決策截止時間（ms epoch）；沒有計時為 null。 */
  deadlineAt: number | null;
  /** 事件日誌（文字），最新的在最後。 */
  log: string[];
  /** 操作失敗等一次性提示。 */
  notice: string | null;
}

export type AppAction =
  | { type: 'connecting' }
  | { type: 'hello'; payload: unknown }
  | { type: 'server-error'; payload: unknown }
  | { type: 'transport-error' }
  | { type: 'disconnected' }
  | { type: 'room-state'; payload: unknown }
  | { type: 'game-update'; payload: unknown; at: number }
  | { type: 'notice'; message: string | null }
  | { type: 'reset' };

export const LOG_LIMIT = 200;

export const initialAppState: AppState = {
  connection: { status: 'idle' },
  room: null,
  game: null,
  deadlineAt: null,
  log: [],
  notice: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  return (
    isRecord(value) &&
    typeof value['code'] === 'string' &&
    typeof value['hostId'] === 'string' &&
    Array.isArray(value['players'])
  );
}

function isGameUpdate(value: unknown): value is GameUpdateMessage {
  return (
    isRecord(value) &&
    typeof value['version'] === 'number' &&
    isRecord(value['state']) &&
    Array.isArray(value['events'])
  );
}

/** 純函式 reducer：把伺服器訊息轉成畫面狀態。外部資料先驗證，不信任伺服器的形狀。 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'connecting':
      return { ...state, connection: { status: 'connecting' } };

    case 'hello': {
      const parsed = ServerHelloSchema.safeParse(action.payload);
      if (!parsed.success) {
        return {
          ...state,
          connection: { status: 'error', message: '伺服器回應格式不符，請重新整理頁面' },
        };
      }
      return {
        ...state,
        connection: {
          status: 'online',
          playerId: parsed.data.playerId,
          nickname: parsed.data.nickname,
        },
      };
    }

    case 'server-error': {
      const parsed = ServerErrorSchema.safeParse(action.payload);
      return {
        ...state,
        connection: {
          status: 'error',
          message: parsed.success ? parsed.data.message : '伺服器回報未知錯誤',
        },
      };
    }

    case 'transport-error':
      // 已登入過：重連失敗只是暫時的，保留畫面繼續重試；第一次連線就失敗才顯示錯誤
      if (state.connection.status === 'online' || state.connection.status === 'reconnecting') {
        const { playerId, nickname } = state.connection;
        return { ...state, connection: { status: 'reconnecting', playerId, nickname } };
      }
      return { ...state, connection: { status: 'error', message: '無法連線到伺服器' } };

    case 'disconnected':
      // 斷線後 socket.io 會自動重連，並用 token 接回身分與座位
      if (state.connection.status === 'online') {
        const { playerId, nickname } = state.connection;
        return { ...state, connection: { status: 'reconnecting', playerId, nickname } };
      }
      return state.connection.status === 'error'
        ? state
        : { ...state, connection: { status: 'connecting' } };

    case 'room-state': {
      const payload = action.payload as Partial<RoomStateMessage> | null;
      const room = isRecord(payload) ? payload.room : undefined;
      if (room === null) {
        // 不在任何房間：清掉對局畫面
        return { ...state, room: null, game: null, deadlineAt: null, log: [] };
      }
      return isRoomSnapshot(room) ? { ...state, room } : state;
    }

    case 'game-update': {
      if (!isGameUpdate(action.payload)) return state;
      const update = action.payload;
      // 丟棄過期的更新（網路亂序時）
      if (state.game && update.version < state.game.version) return state;
      // 事件文字以玩家暱稱顯示（開局時房間快照已有座位）
      const nameOf = (seat: number): string =>
        state.room?.players.find((p) => p.seat === seat)?.nickname ?? `座位 ${String(seat)}`;
      const lines = update.events.map((e) => describeEvent(e, nameOf)).filter((l) => l !== '');
      const log = [...state.log, ...lines].slice(-LOG_LIMIT);
      return {
        ...state,
        game: update,
        deadlineAt: update.remainingMs === null ? null : action.at + update.remainingMs,
        log,
      };
    }

    case 'notice':
      return { ...state, notice: action.message };

    case 'reset':
      return initialAppState;
  }
}

/** 目前登入玩家在房間裡的資料。 */
export function selfPlayer(state: AppState): RoomSnapshot['players'][number] | undefined {
  const { connection } = state;
  if (
    connection.status === 'idle' ||
    connection.status === 'connecting' ||
    connection.status === 'error'
  ) {
    return undefined;
  }
  if (!state.room) return undefined;
  const { playerId } = connection;
  return state.room.players.find((p) => p.id === playerId);
}
