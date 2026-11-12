/**
 * 中繼協定（ADR-0007）：房主在瀏覽器裡跑房間，伺服器只做「房號登記」與「轉發不透明訊息」。
 *
 * 這一層**不認識遊戲**：`data` 對伺服器是不透明的資料，伺服器只檢查大小與頻率，不解析、不記錄內容。
 * 遊戲訊息（握手、房間、對局）怎麼包在 `data` 裡，是房主與客人之間的事（見 @kot/room 的 local 協定）。
 */
import { z } from 'zod';
import { RoomCodeSchema } from './lobby.js';

/** 中繼協定版本；與遊戲協定（PROTOCOL_VERSION）獨立演進。 */
export const RELAY_PROTOCOL_VERSION = 2;

/** 中繼用的 Socket.IO 命名空間。 */
export const RELAY_NAMESPACE = '/relay';

export const RELAY_EVENTS = {
  // 客戶端 → 伺服器
  hostOpen: 'relay:host-open',
  join: 'relay:join',
  toHost: 'relay:to-host',
  toGuest: 'relay:to-guest',
  kick: 'relay:kick',
  /** 房主表示「所有客人都直連了，我先離線」：房間保留（停泊），不佔伺服器連線。 */
  park: 'relay:park',
  ping: 'relay:ping',
  // 伺服器 → 客戶端
  guestJoined: 'relay:guest-joined',
  guestLeft: 'relay:guest-left',
  fromGuest: 'relay:from-guest',
  fromHost: 'relay:from-host',
  hostStatus: 'relay:host-status',
  closed: 'relay:closed',
  error: 'relay:error',
} as const;

export const RELAY_ERROR_CODES = [
  'invalid_message',
  'protocol_mismatch',
  'room_not_found',
  'room_full',
  'server_full',
  'code_taken',
  'bad_host_key',
  'not_host',
  'not_guest',
  'host_offline',
  'guests_present',
  'rate_limited',
  'payload_too_large',
] as const;
export const RelayErrorCodeSchema = z.enum(RELAY_ERROR_CODES);
export type RelayErrorCode = z.infer<typeof RelayErrorCodeSchema>;

/** 單則中繼訊息的 data 上限（序列化後的位元組）。卡牌目錄約 10 KB，所以要比一般訊息寬。 */
export const RELAY_MAX_DATA_BYTES = 32_768;
/** 每個房間同時最多幾位客人（含房主共 MAX_PLAYERS 位真人；多出的給之後的觀戰）。 */
export const RELAY_MAX_GUESTS = 8;

/** 客人的連線代號：伺服器產生，只在這個房間內有意義。 */
export const GuestIdSchema = z.string().min(1).max(40);

export const RelayHostOpenSchema = z
  .object({
    relayVersion: z.literal(RELAY_PROTOCOL_VERSION),
    /** 重連時帶上原本的房號與金鑰；第一次建房兩者都省略（房號由伺服器產生）。 */
    code: RoomCodeSchema.optional(),
    hostKey: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    /**
     * 伺服器重啟、房號登記遺失時，房主（對局還在直連中進行）可以用原本的房號與金鑰重新登記。
     * 只有在該房號目前沒有被登記時才會成功。
     */
    restore: z.literal(true).optional(),
  })
  .strict();
export type RelayHostOpen = z.infer<typeof RelayHostOpenSchema>;

export const RelayJoinSchema = z
  .object({ relayVersion: z.literal(RELAY_PROTOCOL_VERSION), code: RoomCodeSchema })
  .strict();
export type RelayJoin = z.infer<typeof RelayJoinSchema>;

/** 客人 → 房主。data 不透明。 */
export const RelayToHostSchema = z.object({ data: z.unknown() }).strict();
/** 房主 → 某位客人。 */
export const RelayToGuestSchema = z.object({ guestId: GuestIdSchema, data: z.unknown() }).strict();
export const RelayKickSchema = z.object({ guestId: GuestIdSchema }).strict();

export type RelayHostOpenAck =
  { ok: true; code: string; hostKey: string } | { ok: false; code: RelayErrorCode };
export type RelayParkAck = { ok: true } | { ok: false; code: RelayErrorCode };
export type RelayJoinAck = { ok: true } | { ok: false; code: RelayErrorCode };

export type RelayClosedReason = 'host_left' | 'kicked' | 'idle_timeout' | 'room_closed';

/** 伺服器 → 客戶端的訊息型別（送出端與接收端共用）。 */
export interface RelayServerEvents {
  [RELAY_EVENTS.guestJoined]: { guestId: string };
  [RELAY_EVENTS.guestLeft]: { guestId: string };
  [RELAY_EVENTS.fromGuest]: { guestId: string; data: unknown };
  [RELAY_EVENTS.fromHost]: { data: unknown };
  [RELAY_EVENTS.hostStatus]: { online: boolean };
  [RELAY_EVENTS.closed]: { reason: RelayClosedReason };
  [RELAY_EVENTS.error]: { code: RelayErrorCode };
}
