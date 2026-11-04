import { z } from 'zod';

/**
 * 協定版本。任何不相容的訊息變更都必須遞增。
 * 伺服器在握手時比對版本，不符則回傳 error 並中斷連線。
 */
export const PROTOCOL_VERSION = 1;

/** Socket.IO 事件名稱（client → server 與 server → client）。 */
export const EVENTS = {
  clientHello: 'client:hello',
  serverHello: 'server:hello',
  serverError: 'server:error',
} as const;

/** 暱稱：去除前後空白後 1~20 字，只允許字母、數字、空白、底線、連字號。 */
export const NicknameSchema = z
  .string()
  .trim()
  .min(1, '暱稱不可為空')
  .max(20, '暱稱最多 20 字')
  .regex(/^[\p{L}\p{N} _-]+$/u, '暱稱只能包含字母、數字、空白、底線或連字號');

export const ClientHelloSchema = z.object({
  protocolVersion: z.number().int().nonnegative(),
  nickname: NicknameSchema,
});
export type ClientHello = z.infer<typeof ClientHelloSchema>;

export const ServerHelloSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  /** 伺服器端產生的不可猜測連線識別，M2 起作為重連 token 的基礎。 */
  connectionId: z.string().min(1),
});
export type ServerHello = z.infer<typeof ServerHelloSchema>;

export const ERROR_CODES = ['invalid_message', 'protocol_mismatch', 'rate_limited'] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** 對外錯誤格式：穩定的 code 加人類可讀訊息，不含 stack trace 或內部路徑。 */
export const ServerErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
});
export type ServerError = z.infer<typeof ServerErrorSchema>;
