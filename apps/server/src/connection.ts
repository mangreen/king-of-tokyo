import { randomBytes } from 'node:crypto';
import type { Socket } from 'socket.io';
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
import { TokenBucket } from './rooms/rateLimit.js';
import type { RoomManager } from './rooms/manager.js';
import type { Publisher } from './rooms/room.js';
import type { Scheduler } from './rooms/scheduler.js';
import type { Session, SessionStore } from './rooms/sessions.js';

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

/** 單一連線的訊息速率：突發 30 則，之後每秒補 5 則。回合制遊戲遠低於此。 */
const RATE_BURST = 30;
const RATE_PER_SECOND = 5;

export interface ConnectionContext {
  sessions: SessionStore;
  rooms: RoomManager;
  scheduler: Scheduler;
  helloTimeoutMs: number;
  /** 連線閒置多久沒有任何訊息就中斷（毫秒）；0＝不踢。 */
  idleKickMs: number;
  /** playerId → 目前連線。 */
  sockets: Map<string, GameSocket>;
  /** 握手時告知客戶端的可用卡牌組與預設值。 */
  cardSets: CardSetInfo[];
  defaultCardSetId: string;
}

/** 把房間的推送送到玩家目前的連線；不在線就略過。 */
export function createPublisher(sockets: Map<string, GameSocket>): Publisher {
  return {
    roomState(playerId: string, room: RoomSnapshot | null) {
      sockets.get(playerId)?.emit(EVENTS.roomState, { room });
    },
    gameCards(playerId: string, message: GameCardsMessage) {
      sockets.get(playerId)?.emit(EVENTS.gameCards, message);
    },
    gameUpdate(playerId: string, message: GameUpdateMessage) {
      sockets.get(playerId)?.emit(EVENTS.gameUpdate, message);
    },
  };
}

function rejectWith(socket: GameSocket, error: ServerError): void {
  socket.emit(EVENTS.serverError, error);
  socket.disconnect(true);
}

export function handleConnection(socket: GameSocket, ctx: ConnectionContext): void {
  const timer = setTimeout(() => {
    rejectWith(socket, { code: 'invalid_message', message: '握手逾時' });
  }, ctx.helloTimeoutMs);

  let session: Session | null = null;

  // 閒置踢除：任何客戶端訊息（含 client:active）都算「還有人」。連線建立時就開始計，
  // 所以開了網頁卻沒登入、或登入後丟著不管的連線都會被收掉。
  let lastActive = ctx.scheduler.now();
  let cancelIdle: () => void = () => undefined;
  const armIdle = (ms: number): void => {
    cancelIdle();
    cancelIdle = ctx.scheduler.after(ms, () => {
      const idleFor = ctx.scheduler.now() - lastActive;
      if (idleFor >= ctx.idleKickMs) {
        rejectWith(socket, {
          code: 'idle_timeout',
          message: '閒置太久，已中斷連線。按「重新連線」就會回到原本的座位。',
        });
      } else {
        armIdle(ctx.idleKickMs - idleFor);
      }
    });
  };
  if (ctx.idleKickMs > 0) {
    armIdle(ctx.idleKickMs);
    socket.onAny(() => {
      lastActive = ctx.scheduler.now();
    });
  }

  socket.on('disconnect', () => {
    cancelIdle();
    clearTimeout(timer);
    if (session && ctx.sessions.detach(session, socket.id)) {
      ctx.sockets.delete(session.playerId);
      ctx.rooms.roomOf(session.playerId)?.setConnected(session.playerId, false);
    }
  });

  // once：每個連線只接受一次握手，避免重複握手造成狀態混亂
  socket.once(EVENTS.clientHello, (payload) => {
    clearTimeout(timer);
    const parsed = ClientHelloSchema.safeParse(payload);
    if (!parsed.success) {
      rejectWith(socket, { code: 'invalid_message', message: '握手訊息格式錯誤' });
      return;
    }
    if (parsed.data.protocolVersion !== PROTOCOL_VERSION) {
      rejectWith(socket, {
        code: 'protocol_mismatch',
        message: `協定版本不符，伺服器為 ${String(PROTOCOL_VERSION)}，請重新整理頁面`,
      });
      return;
    }

    // 有效的 token：接回原身分（沿用原暱稱）；無效或過期：視為新玩家
    const resumedSession =
      parsed.data.sessionToken === undefined
        ? undefined
        : ctx.sessions.resume(parsed.data.sessionToken);
    let token = parsed.data.sessionToken ?? '';
    if (resumedSession) {
      session = resumedSession;
    } else {
      const created = ctx.sessions.create(parsed.data.nickname);
      session = created.session;
      token = created.token;
    }

    // 先綁定新連線，再踢掉同一身分的舊連線：舊連線的 disconnect 事件因 socket id 不符
    // 會被 detach 忽略，不會造成「離線→上線」的閃動，也不會重設對局計時。
    const previousSocketId = ctx.sessions.attach(session, socket.id);
    const previousSocket = ctx.sockets.get(session.playerId);
    ctx.sockets.set(session.playerId, socket);
    if (previousSocket && previousSocketId !== null && previousSocket.id !== socket.id) {
      rejectWith(previousSocket, { code: 'session_replaced', message: '此身分已在其他地方登入' });
    }

    socket.emit(EVENTS.serverHello, {
      protocolVersion: PROTOCOL_VERSION,
      playerId: session.playerId,
      sessionToken: token,
      resumed: resumedSession !== undefined,
      nickname: session.nickname,
      cardSets: ctx.cardSets,
      defaultCardSetId: ctx.defaultCardSetId,
    });

    const room = ctx.rooms.roomOf(session.playerId);
    if (room) {
      room.setConnected(session.playerId, true);
      room.resync(session.playerId);
    } else {
      socket.emit(EVENTS.roomState, { room: null });
    }

    registerHandlers(socket, session, ctx);
  });
}

function registerHandlers(socket: GameSocket, session: Session, ctx: ConnectionContext): void {
  const bucket = new TokenBucket(RATE_BURST, RATE_PER_SECOND, () => ctx.scheduler.now());

  function on<T>(
    event:
      | typeof EVENTS.roomCreate
      | typeof EVENTS.roomJoin
      | typeof EVENTS.roomLeave
      | typeof EVENTS.roomReady
      | typeof EVENTS.roomStart
      | typeof EVENTS.roomAddBot
      | typeof EVENTS.roomRemoveBot
      | typeof EVENTS.gameAction,
    schema: ZodType<T>,
    handler: (input: T) => Ack,
  ): void {
    socket.on(event, (payload: unknown, ack?: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (result: Ack) => void) : () => undefined;
      if (!bucket.take()) {
        reply({ ok: false, code: 'rate_limited' });
        return;
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        reply({ ok: false, code: 'invalid_message' });
        return;
      }
      try {
        reply(handler(parsed.data));
      } catch (error) {
        // 內部錯誤只記在伺服器，不回傳細節給客戶端
        console.error('處理訊息時發生錯誤', event, error instanceof Error ? error.message : error);
        reply({ ok: false, code: 'wrong_state' });
      }
    });
  }

  // 只用來讓 onAny 記錄活動；不需要回應
  socket.on(EVENTS.clientActive, () => undefined);

  const identity = { id: session.playerId, nickname: session.nickname };

  on(EVENTS.roomCreate, RoomCreateSchema, ({ cardSetId }) => {
    const result = ctx.rooms.createRoom(identity, cardSetId);
    return result.ok ? { ok: true } : result;
  });

  on(EVENTS.roomJoin, RoomJoinSchema, ({ code }) => {
    const result = ctx.rooms.joinRoom(code, identity);
    if (result.ok) ctx.rooms.roomOf(session.playerId)?.resync(session.playerId);
    return result;
  });

  on(EVENTS.roomLeave, EmptyPayloadSchema, () => ctx.rooms.leave(session.playerId));

  on(EVENTS.roomReady, RoomReadySchema, ({ ready }) => {
    const room = ctx.rooms.roomOf(session.playerId);
    return room ? room.setReady(session.playerId, ready) : { ok: false, code: 'not_in_room' };
  });

  on(EVENTS.roomStart, EmptyPayloadSchema, () => {
    const room = ctx.rooms.roomOf(session.playerId);
    return room ? room.start(session.playerId) : { ok: false, code: 'not_in_room' };
  });

  on(EVENTS.roomAddBot, EmptyPayloadSchema, () => {
    const room = ctx.rooms.roomOf(session.playerId);
    return room ? room.addBot(session.playerId) : { ok: false, code: 'not_in_room' };
  });

  on(EVENTS.roomRemoveBot, RoomRemoveBotSchema, ({ id }) => {
    const room = ctx.rooms.roomOf(session.playerId);
    return room ? room.removeBot(session.playerId, id) : { ok: false, code: 'not_in_room' };
  });

  on(EVENTS.gameAction, GameActionSchema, (input) => {
    const room = ctx.rooms.roomOf(session.playerId);
    return room ? room.act(session.playerId, input) : { ok: false, code: 'not_in_room' };
  });
}

/**
 * 對局的亂數 seed：16 個 CSPRNG 位元組（128 位元）。**seed 是機密**：知道它就能預測所有骰子與牌序，
 * 所以只留在伺服器記憶體與重放資料裡，不送給任何客戶端、不寫進日誌。
 */
export function randomSeed(): string {
  return randomBytes(16).toString('hex');
}
