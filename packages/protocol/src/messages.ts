import { z } from 'zod';

/**
 * 協定版本。任何不相容的訊息變更都必須遞增。
 * 伺服器在握手時比對版本，不符則回傳 error 並中斷連線。
 *
 * v2（M2）：握手加入重連用的 sessionToken；新增房間與對局訊息。
 * v3（M3）：卡牌——完整動作集、建房可選卡牌組、握手回傳可用卡牌組、game:cards 推送。
 */
export const PROTOCOL_VERSION = 3;

/** Socket.IO 事件名稱（client → server 與 server → client）。 */
export const EVENTS = {
  clientHello: 'client:hello',
  serverHello: 'server:hello',
  serverError: 'server:error',
  roomCreate: 'room:create',
  roomJoin: 'room:join',
  roomLeave: 'room:leave',
  roomReady: 'room:ready',
  roomStart: 'room:start',
  roomState: 'room:state',
  gameAction: 'game:action',
  gameUpdate: 'game:update',
  gameCards: 'game:cards',
} as const;

/** 暱稱：去除前後空白後 1~20 字，只允許字母、數字、空白、底線、連字號。 */
export const NicknameSchema = z
  .string()
  .trim()
  .min(1, '暱稱不可為空')
  .max(20, '暱稱最多 20 字')
  .regex(/^[\p{L}\p{N} _-]+$/u, '暱稱只能包含字母、數字、空白、底線或連字號');

/** 重連 token：伺服器以 CSPRNG 產生的 32 bytes（64 個十六進位字元）。 */
export const SessionTokenSchema = z.string().regex(/^[0-9a-f]{64}$/, 'sessionToken 格式錯誤');

export const ClientHelloSchema = z.object({
  protocolVersion: z.number().int().nonnegative(),
  nickname: NicknameSchema,
  /** 重連時帶上先前取得的 token；沒有或失效則視為新玩家。 */
  sessionToken: SessionTokenSchema.optional(),
});
export type ClientHello = z.infer<typeof ClientHelloSchema>;

export const ServerHelloSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  /** 對其他玩家公開的玩家識別（不可用來重連）。 */
  playerId: z.string().min(1),
  /** 重連憑證，等同密碼：只存在這位玩家的瀏覽器，不可顯示或記錄。 */
  sessionToken: SessionTokenSchema,
  /** 這次握手是否接回先前的身分。 */
  resumed: z.boolean(),
  nickname: NicknameSchema,
  /** 可選的卡牌組與伺服器預設值。 */
  cardSets: z.array(
    z.object({ id: z.string().min(1), name: z.string().min(1), cardCount: z.number().int() }),
  ),
  defaultCardSetId: z.string().min(1),
});
export type ServerHello = z.infer<typeof ServerHelloSchema>;

export const ERROR_CODES = [
  'invalid_message',
  'protocol_mismatch',
  'rate_limited',
  'session_replaced',
  'server_full',
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** 對外錯誤格式：穩定的 code 加人類可讀訊息，不含 stack trace 或內部路徑。 */
export const ServerErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
});
export type ServerError = z.infer<typeof ServerErrorSchema>;
