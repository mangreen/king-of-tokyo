import { z } from 'zod';
import type { GameEvent, GameState } from '@kot/rules';

// ── 房間 ─────────────────────────────────────────────────

/** 房號字元：去掉容易看錯的 I、O、0、1。 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export const RoomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{5}$/, '房號格式錯誤');

export const EmptyPayloadSchema = z.object({}).strict();
export const RoomJoinSchema = z.object({ code: RoomCodeSchema });
export const RoomReadySchema = z.object({ ready: z.boolean() });

/** 客戶端只送「意圖」，座位由伺服器依玩家身分決定。 */
export const GameActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('roll'),
    keep: z.array(z.number().int().min(0).max(11)).max(12),
  }),
  z.object({ type: z.literal('endRolling') }),
  z.object({ type: z.literal('yieldDecision'), leave: z.boolean() }),
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
  ready: boolean;
  connected: boolean;
  /** 逾時未操作而由系統代打。玩家再操作一次就會解除。 */
  away: boolean;
  /** 已離開房間（對局中離開的座位由系統代打到結束）。 */
  left: boolean;
}

export interface RoomSnapshot {
  code: string;
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
  /** 這個玩家視角的狀態（M3 起會遮蔽隱藏資訊）。 */
  state: GameState;
  /** 這次更新產生的事件，供演出回放；完整重送時為空陣列。 */
  events: GameEvent[];
  /** 目前決策的剩餘毫秒數（伺服器時鐘，避免客戶端時間誤差）；沒有計時為 null。 */
  remainingMs: number | null;
  /** 現在輪到誰決定；遊戲結束為 null。 */
  actorSeat: number | null;
}
