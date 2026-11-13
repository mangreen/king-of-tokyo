/**
 * 中繼協定（ADR-0007）：房主在瀏覽器裡跑房間，伺服器只做「房號登記」與「轉發不透明訊息」。
 *
 * 這一層**不認識遊戲**：`data` 對伺服器是不透明的資料，伺服器只檢查大小與頻率，不解析、不記錄內容。
 * 遊戲訊息（握手、房間、對局）怎麼包在 `data` 裡，是房主與客人之間的事（見 @kot/room 的 local 協定）。
 */
import { z } from 'zod';
import { RoomCodeSchema } from './lobby.js';

/** 中繼協定版本；與遊戲協定（PROTOCOL_VERSION）獨立演進。 */
export const RELAY_PROTOCOL_VERSION = 3;

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
  /** 房主登記後備順序（接手金鑰的雜湊，依順位排列）。伺服器只存雜湊，不知道金鑰與遊戲內容。 */
  succession: 'relay:succession',
  /** 後備房主出示接手金鑰，要求成為新房主（故障接手或計畫性交接）。 */
  takeover: 'relay:takeover',
  /** 房主指定某位後備立刻接手（計畫性交接）；之後那位的 takeover 不必等寬限期。 */
  handover: 'relay:handover',
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
  /** 要求接手時，原房主仍在線上（或停泊中且沒有人懷疑他不在了）。 */
  'host_online',
  /** 接手的時間還沒到（順位越後面等越久）；ack 的 retryInMs 是還要等多久。 */
  'too_early',
  /** 沒有登記後備順序、或出示的金鑰不在順序裡。 */
  'bad_takeover',
  /** 這個房主金鑰已被新房主取代（房主轉移後舊房主回來）；請降為客人加入同一個房號。 */
  'superseded',
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
    /** restore 時：房主手上的世代（伺服器登記遺失，無從得知）。 */
    epoch: z.number().int().min(0).max(1_000_000).optional(),
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

/** SHA-256 十六進位（接手金鑰的雜湊）。 */
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** 後備房主順序：接手金鑰的雜湊，第 1 個是第一順位。最多與客人數量相同。 */
export const RelaySuccessionSchema = z
  .object({ order: z.array(Sha256HexSchema).max(RELAY_MAX_GUESTS) })
  .strict();
export type RelaySuccession = z.infer<typeof RelaySuccessionSchema>;

export const RelayTakeoverSchema = z
  .object({
    relayVersion: z.literal(RELAY_PROTOCOL_VERSION),
    code: RoomCodeSchema,
    /** 房主簽發給這位後備的接手金鑰（128 位元，十六進位）。 */
    key: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .strict();
export type RelayTakeover = z.infer<typeof RelayTakeoverSchema>;

/** 計畫性交接：指定要接手的後備（接手金鑰的雜湊）。 */
export const RelayHandoverSchema = z.object({ target: Sha256HexSchema }).strict();
export type RelayHandover = z.infer<typeof RelayHandoverSchema>;

export type RelayHostOpenAck =
  { ok: true; code: string; hostKey: string; epoch: number } | { ok: false; code: RelayErrorCode };
export type RelayTakeoverAck =
  | { ok: true; code: string; hostKey: string; epoch: number }
  | { ok: false; code: RelayErrorCode; retryInMs?: number };
export type RelaySimpleAck = { ok: true } | { ok: false; code: RelayErrorCode };
export type RelayParkAck = { ok: true } | { ok: false; code: RelayErrorCode };
export type RelayJoinAck = { ok: true } | { ok: false; code: RelayErrorCode };

export type RelayClosedReason =
  | 'host_left'
  | 'kicked'
  | 'idle_timeout'
  | 'room_closed'
  /** 房主被新房主取代（房主轉移）。 */
  | 'superseded';

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
