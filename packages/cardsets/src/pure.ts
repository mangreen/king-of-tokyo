/**
 * 瀏覽器與 Worker 可用的部分：只有 schema 驗證與雜湊，沒有任何 node:* 依賴。
 * 檔案載入（load.ts）與官方 CSV 匯入（csv.ts）只在 Node 使用，不從這裡匯出。
 */
import { hashCardSet } from './hash.js';
import { parseCardSet } from './schema.js';
import type { CardSet } from './schema.js';

export { parseCardSet, validateCardSetSemantics, CardSetSchema } from './schema.js';
export type { CardSet } from './schema.js';
export { hashCardSet } from './hash.js';

export interface LoadedCardSet {
  set: CardSet;
  hash: string;
  /** 來源（original／local）。 */
  source: string;
}

/** 驗證一份卡牌組 JSON（例如瀏覽器內打包的原創卡組）並算出內容雜湊。 */
export function loadCardSetFromJson(json: unknown, source: string): LoadedCardSet {
  const set = parseCardSet(json);
  return { set, hash: hashCardSet(set), source };
}
