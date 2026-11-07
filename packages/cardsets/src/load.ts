import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashCardSet } from './hash.js';
import { parseCardSet } from './schema.js';
import type { CardSet } from './schema.js';

export interface LoadedCardSet {
  set: CardSet;
  hash: string;
  /** 來源目錄名稱（original／local）。 */
  source: string;
}

/**
 * 載入 card-sets/ 下所有可用的卡牌組。original 一定要存在；local 不存在就略過
 * （例如 CI 或沒有放官方卡表的機器）。local 存在但格式錯誤會直接丟出錯誤，避免默默退回別的卡組。
 */
export function loadCardSets(root: string): Map<string, LoadedCardSet> {
  const result = new Map<string, LoadedCardSet>();
  for (const source of ['original', 'local']) {
    const file = join(root, source, 'set.json');
    if (!existsSync(file)) {
      if (source === 'original') {
        throw new Error(`找不到原創卡組：${file}`);
      }
      continue;
    }
    const set = parseCardSet(JSON.parse(readFileSync(file, 'utf8')) as unknown);
    if (result.has(set.id)) {
      throw new Error(`卡牌組 id 重複：${set.id}`);
    }
    result.set(set.id, { set, hash: hashCardSet(set), source });
  }
  return result;
}

/** 預設使用的卡牌組：有使用者自備的就用它，否則用原創卡組。 */
export function defaultCardSetId(sets: ReadonlyMap<string, LoadedCardSet>): string {
  for (const loaded of sets.values()) {
    if (loaded.source === 'local') return loaded.set.id;
  }
  return 'original';
}
