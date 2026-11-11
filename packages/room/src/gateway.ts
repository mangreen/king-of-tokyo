/**
 * 連線閘道：握手、身分（token）、速率限制、閒置踢除，以及把客戶端訊息分派給房間。
 * 與傳輸無關——Socket.IO（伺服器）、同頁 Worker（離線／房主）、之後的 WebRTC 與中繼，
 * 都只要提供 GatewayConn（送出訊息、關閉連線），並把收到的訊息交給 ConnHandle.receive。
 */
import type { ZodType } from 'zod';
import {
  ClientHelloSchema,
  EVENTS,
  EmptyPayloadSchema,
  GameActionSchema,
  PROTOCOL_VERSION,
  RoomCreateSchema,
  RoomJoinSchema,
  RoomReadySchema,
  RoomRemoveBotSchema,
  type Ack,
  type CardSetInfo,
  type GameCardsMessage,
  type GameUpdateMessage,
  type RoomSnapshot,
  type RoomStateMessage,
  type ServerError,
  type ServerHello,
} from '@kot/protocol';
import type { RoomManager } from './manager.js';
import { TokenBucket } from './rateLimit.js';
import type { Publisher } from './room.js';
import type { Scheduler } from './scheduler.js';
import type { Session, SessionStore } from './sessions.js';

/** 伺服器（房間）送給客戶端的訊息。 */
export interface ServerEventMap {
  [EVENTS.serverHello]: ServerHello;
  [EVENTS.serverError]: ServerError;
  [EVENTS.roomState]: RoomStateMessage;
  [EVENTS.gameUpdate]: GameUpdateMessage;
  [EVENTS.gameCards]: GameCardsMessage;
}

/** 一條連線（任何傳輸）。 */
export interface GatewayConn {
  /** 這條連線的唯一識別（重連時用來判斷「舊連線」）。 */
  readonly id: string;
  emit<E extends keyof ServerEventMap>(event: E, payload: ServerEventMap[E]): void;
  /** 主動中斷（傳輸層之後應呼叫 ConnHandle.closed）。 */
  close(): void;
}

export interface ConnHandle {
  /** 傳輸層收到一則客戶端訊息。ack 若是函式，就用它回覆結果。 */
  receive(event: string, payload: unknown, ack?: unknown): void;
  /** 傳輸層確認連線已關閉（對方斷線或我們中斷）。可重複呼叫。 */
  closed(): void;
}

export interface GatewayOptions {
  scheduler: Scheduler;
  sessions: SessionStore;
  rooms: RoomManager;
  /** 握手時告知客戶端的可用卡牌組與預設值。 */
  cardSets: CardSetInfo[];
  defaultCardSetId: string;
  /** 連線後多久內必須完成握手（毫秒）。 */
  helloTimeoutMs: number;
  /** 連線閒置多久沒有任何訊息就中斷（毫秒）；0＝不踢。 */
  idleKickMs: number;
}

/** 單一連線的訊息速率：突發 30 則，之後每秒補 5 則。回合制遊戲遠低於此。 */
const RATE_BURST = 30;
const RATE_PER_SECOND = 5;

type GameEvents =
  | typeof EVENTS.roomCreate
  | typeof EVENTS.roomJoin
  | typeof EVENTS.roomLeave
  | typeof EVENTS.roomReady
  | typeof EVENTS.roomStart
  | typeof EVENTS.roomAddBot
  | typeof EVENTS.roomRemoveBot
  | typeof EVENTS.gameAction;

export class Gateway {
  /** playerId → 目前連線。 */
  private readonly conns = new Map<string, GatewayConn>();

  constructor(private readonly options: GatewayOptions) {}

  /** 把房間的推送送到玩家目前的連線；不在線就略過。 */
  readonly publisher: Publisher = {
    roomState: (playerId: string, room: RoomSnapshot | null) => {
      this.conns.get(playerId)?.emit(EVENTS.roomState, { room });
    },
    gameCards: (playerId: string, message: GameCardsMessage) => {
      this.conns.get(playerId)?.emit(EVENTS.gameCards, message);
    },
    gameUpdate: (playerId: string, message: GameUpdateMessage) => {
      this.conns.get(playerId)?.emit(EVENTS.gameUpdate, message);
    },
  };

  /** 目前有身分的連線數（測試與監控用）。 */
  get connectionCount(): number {
    return this.conns.size;
  }

  /** 接受一條新連線，回傳給傳輸層使用的處理器。 */
  connect(conn: GatewayConn): ConnHandle {
    const { scheduler, sessions, rooms } = this.options;
    let session: Session | null = null;
    let helloDone = false;
    let ended = false;
    let bucket: TokenBucket | null = null;
    let cancelHello: () => void = () => undefined;
    let cancelIdle: () => void = () => undefined;
    let lastActive = scheduler.now();

    const end = (): void => {
      if (ended) return;
      ended = true;
      cancelHello();
      cancelIdle();
      if (session && sessions.detach(session, conn.id)) {
        this.conns.delete(session.playerId);
        rooms.roomOf(session.playerId)?.setConnected(session.playerId, false);
      }
    };

    const reject = (error: ServerError): void => {
      conn.emit(EVENTS.serverError, error);
      conn.close();
      end();
    };

    cancelHello = scheduler.after(this.options.helloTimeoutMs, () => {
      reject({ code: 'invalid_message', message: '握手逾時' });
    });

    // 閒置踢除：任何客戶端訊息（含 client:active）都算「還有人」。連線建立時就開始計，
    // 所以開了網頁卻沒登入、或登入後丟著不管的連線都會被收掉。
    const armIdle = (ms: number): void => {
      cancelIdle();
      cancelIdle = scheduler.after(ms, () => {
        const idleFor = scheduler.now() - lastActive;
        if (idleFor >= this.options.idleKickMs) {
          reject({
            code: 'idle_timeout',
            message: '閒置太久，已中斷連線。按「重新連線」就會回到原本的座位。',
          });
        } else {
          armIdle(this.options.idleKickMs - idleFor);
        }
      });
    };
    if (this.options.idleKickMs > 0) armIdle(this.options.idleKickMs);

    const hello = (payload: unknown): void => {
      helloDone = true;
      cancelHello();
      const parsed = ClientHelloSchema.safeParse(payload);
      if (!parsed.success) {
        reject({ code: 'invalid_message', message: '握手訊息格式錯誤' });
        return;
      }
      if (parsed.data.protocolVersion !== PROTOCOL_VERSION) {
        reject({
          code: 'protocol_mismatch',
          message: `協定版本不符，伺服器為 ${String(PROTOCOL_VERSION)}，請重新整理頁面`,
        });
        return;
      }

      // 有效的 token：接回原身分（沿用原暱稱）；無效或過期：視為新玩家
      const resumed =
        parsed.data.sessionToken === undefined
          ? undefined
          : sessions.resume(parsed.data.sessionToken);
      let token = parsed.data.sessionToken ?? '';
      if (resumed) {
        session = resumed;
      } else {
        const created = sessions.create(parsed.data.nickname);
        session = created.session;
        token = created.token;
      }

      // 先綁定新連線，再踢掉同一身分的舊連線：舊連線的關閉事件因連線 id 不符
      // 會被 detach 忽略，不會造成「離線→上線」的閃動，也不會重設對局計時。
      const previousId = sessions.attach(session, conn.id);
      const previous = this.conns.get(session.playerId);
      this.conns.set(session.playerId, conn);
      if (previous && previousId !== null && previous.id !== conn.id) {
        previous.emit(EVENTS.serverError, {
          code: 'session_replaced',
          message: '此身分已在其他地方登入',
        });
        previous.close();
      }

      conn.emit(EVENTS.serverHello, {
        protocolVersion: PROTOCOL_VERSION,
        playerId: session.playerId,
        sessionToken: token,
        resumed: resumed !== undefined,
        nickname: session.nickname,
        cardSets: this.options.cardSets,
        defaultCardSetId: this.options.defaultCardSetId,
      });

      const room = rooms.roomOf(session.playerId);
      if (room) {
        room.setConnected(session.playerId, true);
        room.resync(session.playerId);
      } else {
        conn.emit(EVENTS.roomState, { room: null });
      }

      bucket = new TokenBucket(RATE_BURST, RATE_PER_SECOND, () => scheduler.now());
    };

    const handlers = this.handlers(() => session);

    const receive = (event: string, payload: unknown, ack?: unknown): void => {
      if (ended) return;
      lastActive = scheduler.now();
      // 每個連線只接受一次握手，避免重複握手造成狀態混亂
      if (event === EVENTS.clientHello) {
        if (!helloDone) hello(payload);
        return;
      }
      if (!helloDone || session === null || bucket === null) return;
      if (event === EVENTS.clientActive) return; // 只用來更新 lastActive
      const handler = handlers.get(event);
      if (!handler) return;

      const reply = typeof ack === 'function' ? (ack as (result: Ack) => void) : () => undefined;
      if (!bucket.take()) {
        reply({ ok: false, code: 'rate_limited' });
        return;
      }
      const parsed = handler.schema.safeParse(payload);
      if (!parsed.success) {
        reply({ ok: false, code: 'invalid_message' });
        return;
      }
      try {
        reply(handler.run(parsed.data));
      } catch (error) {
        // 內部錯誤只記在伺服器，不回傳細節給客戶端
        console.error('處理訊息時發生錯誤', event, error instanceof Error ? error.message : error);
        reply({ ok: false, code: 'wrong_state' });
      }
    };

    return { receive, closed: end };
  }

  /** 每個遊戲事件：驗證用 schema 與處理函式（以目前身分執行）。 */
  private handlers(
    currentSession: () => Session | null,
  ): Map<string, { schema: ZodType<unknown>; run: (input: unknown) => Ack }> {
    const { rooms } = this.options;
    const map = new Map<string, { schema: ZodType<unknown>; run: (input: unknown) => Ack }>();

    const on = <T>(event: GameEvents, schema: ZodType<T>, run: (id: Identity, input: T) => Ack) => {
      map.set(event, {
        schema: schema as ZodType<unknown>,
        run: (input: unknown) => {
          const session = currentSession();
          if (!session) return { ok: false, code: 'wrong_state' } as const;
          return run({ id: session.playerId, nickname: session.nickname }, input as T);
        },
      });
    };

    on(EVENTS.roomCreate, RoomCreateSchema, (who, { cardSetId }) => {
      const result = rooms.createRoom(who, cardSetId);
      return result.ok ? { ok: true } : result;
    });

    on(EVENTS.roomJoin, RoomJoinSchema, (who, { code }) => {
      const result = rooms.joinRoom(code, who);
      if (result.ok) rooms.roomOf(who.id)?.resync(who.id);
      return result;
    });

    on(EVENTS.roomLeave, EmptyPayloadSchema, (who) => rooms.leave(who.id));

    on(EVENTS.roomReady, RoomReadySchema, (who, { ready }) => {
      const room = rooms.roomOf(who.id);
      return room ? room.setReady(who.id, ready) : { ok: false, code: 'not_in_room' };
    });

    on(EVENTS.roomStart, EmptyPayloadSchema, (who) => {
      const room = rooms.roomOf(who.id);
      return room ? room.start(who.id) : { ok: false, code: 'not_in_room' };
    });

    on(EVENTS.roomAddBot, EmptyPayloadSchema, (who) => {
      const room = rooms.roomOf(who.id);
      return room ? room.addBot(who.id) : { ok: false, code: 'not_in_room' };
    });

    on(EVENTS.roomRemoveBot, RoomRemoveBotSchema, (who, { id }) => {
      const room = rooms.roomOf(who.id);
      return room ? room.removeBot(who.id, id) : { ok: false, code: 'not_in_room' };
    });

    on(EVENTS.gameAction, GameActionSchema, (who, input) => {
      const room = rooms.roomOf(who.id);
      return room ? room.act(who.id, input) : { ok: false, code: 'not_in_room' };
    });

    return map;
  }
}

interface Identity {
  id: string;
  nickname: string;
}
