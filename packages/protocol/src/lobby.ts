import { z } from 'zod';
import type { CardDef, GameEvent, GameState } from '@kot/rules';

// ── 房間 ─────────────────────────────────────────────────

/** 房號字元：去掉容易看錯的 I、O、0、1。 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
/** 怪獸造型的種類數；每場開局時由伺服器隨機分配（0..MONSTER_COUNT-1）。 */
export const MONSTER_COUNT = 12;

export const RoomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{5}$/, '房號格式錯誤');

export const EmptyPayloadSchema = z.object({}).strict();
export const RoomJoinSchema = z.object({ code: RoomCodeSchema });
export const RoomReadySchema = z.object({ ready: z.boolean() });
/** 移除電腦玩家：id 是 PlayerInfo.id（伺服器產生，長度有上限即可）。 */
export const RoomRemoveBotSchema = z.object({ id: z.string().min(1).max(40) }).strict();

/** 卡牌組 id：小寫英數與連字號（與 set.json 一致）。 */
export const CardSetIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9-]+$/);
/** 建立房間：可指定卡牌組，省略則用伺服器預設。 */
export const RoomCreateSchema = z.object({ cardSetId: CardSetIdSchema.optional() }).strict();

const FaceSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal('energy'),
  z.literal('attack'),
  z.literal('heal'),
]);
const CardIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);
const SeatSchema = z.number().int().min(0).max(5);

/** 客戶端只送「意圖」，座位由伺服器依玩家身分決定。 */
export const GameActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('roll'),
    keep: z.array(z.number().int().min(0).max(11)).max(12),
  }),
  z.object({ type: z.literal('endRolling') }),
  z.object({
    type: z.literal('yieldDecision'),
    leave: z.boolean(),
    takeCard: CardIdSchema.optional(),
  }),
  z.object({
    type: z.literal('buy'),
    cardId: CardIdSchema,
    from: z.union([z.literal('deck'), SeatSchema]).optional(),
    energy: z.number().int().min(0).max(99).optional(),
    target: CardIdSchema.optional(),
  }),
  z.object({ type: z.literal('sweep') }),
  z.object({ type: z.literal('endTurn') }),
  z.object({
    type: z.literal('useCard'),
    cardId: CardIdSchema,
    args: z
      .object({
        die: z.number().int().min(0).max(11).optional(),
        face: FaceSchema.optional(),
        target: CardIdSchema.optional(),
        cards: z.array(CardIdSchema).max(20).optional(),
      })
      .strict()
      .optional(),
  }),
  z.object({ type: z.literal('reactDecision'), cardId: CardIdSchema.nullable() }),
  z.object({
    type: z.literal('heartsDecision'),
    self: z.number().int().min(0).max(30),
    poison: z.number().int().min(0).max(30),
    shrink: z.number().int().min(0).max(30),
    others: z.array(z.object({ seat: SeatSchema, amount: z.number().int().min(0).max(30) })).max(6),
  }),
  z.object({
    type: z.literal('probeDecision'),
    die: z.number().int().min(0).max(11).nullable(),
    target: SeatSchema.optional(),
  }),
  z.object({ type: z.literal('opportunityDecision'), buy: z.boolean() }),
]);
export type GameActionInput = z.infer<typeof GameActionSchema>;

// ── 回應（Socket.IO ack）──────────────────────────────────

export const ACK_ERROR_CODES = [
  // 協定與流量
  'invalid_message',
  'rate_limited',
  // 房間
  'already_in_room',
  'not_in_room',
  'room_not_found',
  'room_full',
  'game_in_progress',
  'too_many_rooms',
  'not_host',
  'not_enough_players',
  'not_ready',
  'wrong_state',
  // 規則引擎拒絕（與 @kot/rules 的 ErrorCode 相同）
  'game_over',
  'not_your_turn',
  'wrong_phase',
  'invalid_keep',
  'invalid_action',
  'no_rolls_left',
  'roll_first',
  'not_enough_energy',
  'card_unavailable',
  'cannot_use',
  // 卡牌組
  'unknown_card_set',
] as const;
export type AckErrorCode = (typeof ACK_ERROR_CODES)[number];

export type Ack = { ok: true } | { ok: false; code: AckErrorCode };

// ── 伺服器推送的狀態 ──────────────────────────────────────

export type RoomPhase = 'lobby' | 'playing' | 'over';

export interface PlayerInfo {
  id: string;
  nickname: string;
  /** 開局後的座位；大廳階段為 null。 */
  seat: number | null;
  /** 這場分配到的怪獸造型（0..MONSTER_COUNT-1）；大廳階段為 null。純外觀，不影響規則。 */
  monster: number | null;
  /** 電腦玩家（由房主加入，永遠在線、不受代管限制）。 */
  bot: boolean;
  ready: boolean;
  connected: boolean;
  /** 逾時未操作而由系統代打。玩家再操作一次就會解除。 */
  away: boolean;
  /** 已離開房間（對局中離開的座位由系統代打到結束）。 */
  left: boolean;
}

/** 卡牌組的摘要（不含卡牌內容）。 */
export interface CardSetInfo {
  id: string;
  name: string;
  cardCount: number;
}

export interface RoomSnapshot {
  code: string;
  /** 這個房間使用的卡牌組。 */
  cardSet: CardSetInfo;
  phase: RoomPhase;
  hostId: string;
  players: PlayerInfo[];
}

/** room 為 null 表示目前不在任何房間。 */
export interface RoomStateMessage {
  room: RoomSnapshot | null;
}

export interface GameUpdateMessage {
  /** 對應 state.version，客戶端用來丟棄過期訊息。 */
  version: number;
  /** 這個玩家視角的狀態（已遮蔽牌庫內容與亂數狀態）。 */
  state: GameState;
  /** 這次更新產生的事件（已依視角遮蔽），供演出回放；完整重送時為空陣列。 */
  events: GameEvent[];
  /** 目前決策的剩餘毫秒數（伺服器時鐘，避免客戶端時間誤差）；沒有計時為 null。 */
  remainingMs: number | null;
  /** 現在輪到誰決定；遊戲結束為 null。 */
  actorSeat: number | null;
}

/** 開局或重連時送出：這場對局使用的完整卡牌目錄（卡牌內容是公開資訊）。 */
export interface GameCardsMessage {
  cardSetId: string;
  cards: CardDef[];
}
