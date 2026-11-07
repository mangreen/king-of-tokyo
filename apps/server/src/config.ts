import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_HOST: z.string().min(1).default('0.0.0.0'),
  SERVER_PORT: z.coerce.number().int().min(0).max(65535).default(3001),
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
  MAX_ROOMS: z.coerce.number().int().min(1).max(100_000).default(2_000),
});

export interface ServerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  allowedOrigins: string[];
  /** 同時存在的房間上限，擋掉建立大量房間耗盡記憶體的行為。 */
  maxRooms: number;
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
    port: parsed.SERVER_PORT,
    allowedOrigins: parsed.ALLOWED_ORIGINS,
    maxRooms: parsed.MAX_ROOMS,
  };
}
