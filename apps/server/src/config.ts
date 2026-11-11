import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_HOST: z.string().min(1).default('0.0.0.0'),
  SERVER_PORT: z.coerce.number().int().min(0).max(65535).optional(),
  // Cloud Run 等平台以 PORT 指定要監聽的埠；SERVER_PORT 優先
  PORT: z.coerce.number().int().min(0).max(65535).optional(),
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .refine((origins) => origins.length > 0, 'ALLOWED_ORIGINS 至少需要一個來源')
    .refine((origins) => !origins.includes('*'), 'ALLOWED_ORIGINS 不可使用萬用字元 *'),
  CARD_SETS_DIR: z.string().min(1).default('card-sets'),
  MAX_ROOMS: z.coerce.number().int().min(1).max(100_000).default(2_000),
  /** 同時連線數上限（含大廳）；試玩版用它保護免費額度。 */
  MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100_000).default(10_000),
  /**
   * 閒置多久（毫秒）沒有任何訊息就中斷連線；0＝不踢。
   * 開著網頁卻離開座位的連線會一直佔著 Cloud Run 執行個體（計費時間），所以要踢；
   * 玩家的身分與座位保留，回來按「重新連線」就接回。
   */
  IDLE_KICK_MS: z.coerce.number().int().min(0).max(86_400_000).default(600_000),
  /** 設定後，由伺服器直接提供建置好的網頁（單一容器的試玩版）。 */
  WEB_DIR: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? null : v.trim())),
  /** 允許「Origin 與請求 Host 相同」的連線（網頁與伺服器同一個網址時用）。 */
  ALLOW_SAME_ORIGIN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export interface ServerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  allowedOrigins: string[];
  /** 同時存在的房間上限，擋掉建立大量房間耗盡記憶體的行為。 */
  maxRooms: number;
  /** 卡牌組目錄（內含 original/ 與選用的 local/）。相對路徑以啟動時的工作目錄為準。 */
  cardSetsDir: string;
  /** 同時連線數上限（含大廳）。超過的新連線會被告知名額已滿。 */
  maxConnections: number;
  /** 連線閒置多久沒有任何訊息就中斷（毫秒）；0＝不踢。 */
  idleKickMs: number;
  /** 建置好的網頁目錄；null＝不提供網頁（開發、前後端分開部署）。 */
  webDir: string | null;
  /** 允許 Origin 與請求 Host 相同的連線（單一容器、同網址的部署）。 */
  allowSameOrigin: boolean;
}

/** 從環境變數解析設定；格式錯誤時丟出可讀的錯誤（不回顯變數值，避免洩漏機密）。 */
export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`環境變數設定錯誤：${problems}`);
  }
  const parsed = result.data;
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.SERVER_HOST,
    port: parsed.SERVER_PORT ?? parsed.PORT ?? 3001,
    allowedOrigins: parsed.ALLOWED_ORIGINS,
    maxRooms: parsed.MAX_ROOMS,
    cardSetsDir: parsed.CARD_SETS_DIR,
    maxConnections: parsed.MAX_CONNECTIONS,
    idleKickMs: parsed.IDLE_KICK_MS,
    webDir: parsed.WEB_DIR,
    allowSameOrigin: parsed.ALLOW_SAME_ORIGIN,
  };
}
