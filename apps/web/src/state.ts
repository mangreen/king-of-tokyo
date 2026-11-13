import { describeEvent, type CardDef, type GameEvent } from '@kot/rules';
import {
  ServerErrorSchema,
  ServerHelloSchema,
  type CardSetInfo,
  type GameCardsMessage,
  type GameUpdateMessage,
  type RoomSnapshot,
  type RoomStateMessage,
} from '@kot/protocol';
import { transportErrorMessage } from './messages.js';

export type Connection =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'online'; playerId: string; nickname: string }
  /** 已登入過、目前斷線並自動重連中：畫面保留原本的內容。 */
  | { status: 'reconnecting'; playerId: string; nickname: string }
  /** 閒置太久被伺服器中斷：身分與座位還在，使用者按「重新連線」才會接回（不自動重連，否則踢除就沒意義）。 */
  | { status: 'timed-out'; message: string }
  | { status: 'error'; message: string };

/** 一次 game:update 帶來的事件，供 3D 場景重播（不影響狀態）。 */
export interface EventBatch {
  version: number;
  events: GameEvent[];
}

export interface AppState {
  connection: Connection;
  room: RoomSnapshot | null;
  game: GameUpdateMessage | null;
  /** 伺服器提供的卡牌組與預設值（握手時取得）。 */
  cardSets: CardSetInfo[];
  defaultCardSetId: string | null;
  /** 這場對局的卡牌目錄（game:cards）；對局開始前為 null。 */
  cards: CardDef[] | null;
  /** 收到最新 game:update 時，本機時間算出的決策截止時間（ms epoch）；沒有計時為 null。 */
  deadlineAt: number | null;
  /** 事件日誌（文字），最新的在最後。 */
  log: string[];
  /** 最近幾批事件（最新在最後），3D 場景依 version 去重後播放。 */
  feed: EventBatch[];
  /** 操作失敗等一次性提示。 */
  notice: string | null;
  /**
   * 剛（重新）握手：下一筆 game:update 即使版本比手上的舊也要接受。
   * 房主重新整理後從存檔還原，可能少了最後幾步（版本倒退），這時以房主為準。
   */
  acceptRewind: boolean;
}

export type AppAction =
  | { type: 'connecting' }
  | { type: 'hello'; payload: unknown }
  | { type: 'server-error'; payload: unknown }
  | { type: 'transport-error'; code?: string }
  | { type: 'disconnected' }
  | { type: 'room-state'; payload: unknown }
  | { type: 'game-cards'; payload: unknown }
  | { type: 'game-update'; payload: unknown; at: number }
  | { type: 'notice'; message: string | null }
  | { type: 'reset' };

export const LOG_LIMIT = 200;
export const FEED_LIMIT = 30;

export const initialAppState: AppState = {
  connection: { status: 'idle' },
  room: null,
  game: null,
  cardSets: [],
  defaultCardSetId: null,
  cards: null,
  deadlineAt: null,
  log: [],
  feed: [],
  notice: null,
  acceptRewind: false,
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

function isGameCards(value: unknown): value is GameCardsMessage {
  return (
    isRecord(value) &&
    typeof value['cardSetId'] === 'string' &&
    Array.isArray(value['cards']) &&
    value['cards'].every(
      (c) =>
        isRecord(c) &&
        typeof c['id'] === 'string' &&
        typeof c['name'] === 'string' &&
        typeof c['cost'] === 'number' &&
        typeof c['text'] === 'string',
    )
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
        cardSets: parsed.data.cardSets,
        defaultCardSetId: parsed.data.defaultCardSetId,
        acceptRewind: true,
      };
    }

    case 'server-error': {
      const parsed = ServerErrorSchema.safeParse(action.payload);
      if (parsed.success && parsed.data.code === 'idle_timeout') {
        return { ...state, connection: { status: 'timed-out', message: parsed.data.message } };
      }
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
      return {
        ...state,
        connection: { status: 'error', message: transportErrorMessage(action.code) },
      };

    case 'disconnected':
      // 斷線後 socket.io 會自動重連，並用 token 接回身分與座位
      if (state.connection.status === 'online') {
        const { playerId, nickname } = state.connection;
        return { ...state, connection: { status: 'reconnecting', playerId, nickname } };
      }
      return state.connection.status === 'error' || state.connection.status === 'timed-out'
        ? state
        : { ...state, connection: { status: 'connecting' } };

    case 'room-state': {
      const payload = action.payload as Partial<RoomStateMessage> | null;
      const room = isRecord(payload) ? payload.room : undefined;
      if (room === null) {
        // 不在任何房間：清掉對局畫面
        return {
          ...state,
          room: null,
          game: null,
          cards: null,
          deadlineAt: null,
          log: [],
          feed: [],
        };
      }
      return isRoomSnapshot(room) ? { ...state, room } : state;
    }

    case 'game-cards':
      return isGameCards(action.payload) ? { ...state, cards: action.payload.cards } : state;

    case 'game-update': {
      if (!isGameUpdate(action.payload)) return state;
      const update = action.payload;
      // 丟棄過期的更新（網路亂序時）；剛握手後的第一筆以房主為準（房主可能從存檔還原而倒退）
      const rewound = state.game !== null && update.version < state.game.version;
      if (rewound && !state.acceptRewind) return state;
      // 事件文字以玩家暱稱顯示（開局時房間快照已有座位）
      const nameOf = (seat: number): string =>
        state.room?.players.find((p) => p.seat === seat)?.nickname ?? `座位 ${String(seat)}`;
      const cardName = (id: string): string => state.cards?.find((c) => c.id === id)?.name ?? id;
      const lines = update.events
        .map((e) => describeEvent(e, nameOf, cardName))
        .filter((l) => l !== '');
      const log = [...state.log, ...lines].slice(-LOG_LIMIT);
      // 倒退時，比新版本更新的舊事件已不存在：從動畫佇列移除
      const kept = rewound
        ? state.feed.filter((b) =>
            update.events.length > 0 ? b.version < update.version : b.version <= update.version,
          )
        : state.feed;
      const feed =
        update.events.length === 0
          ? kept
          : [...kept, { version: update.version, events: update.events as GameEvent[] }].slice(
              -FEED_LIMIT,
            );
      return {
        ...state,
        acceptRewind: false,
        game: update,
        feed,
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
    connection.status === 'timed-out' ||
    connection.status === 'error'
  ) {
    return undefined;
  }
  if (!state.room) return undefined;
  const { playerId } = connection;
  return state.room.players.find((p) => p.id === playerId);
}
