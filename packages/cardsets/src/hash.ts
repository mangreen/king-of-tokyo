import { sha256Hex } from '@kot/rules';
import type { CardSet } from './schema.js';

/** 穩定排序 key 的 JSON，使雜湊不受欄位順序影響。 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 卡牌組內容的 SHA-256（十六進位）。記錄進對局日誌，重放時用來確認卡表沒被改過。 */
export function hashCardSet(set: CardSet): string {
  return sha256Hex(canonical(set));
}
