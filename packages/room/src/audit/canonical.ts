/**
 * 正規化 JSON 與摘要：同樣內容的物件不論鍵的順序、傳輸方式，都得到同一個摘要。
 * 稽核用它比對「我在對局中看到的畫面狀態」與「重放出來的狀態」。
 */
import { sha256Hex } from '@kot/rules';

/** 鍵依字典序排序、略過 undefined 的 JSON。只處理 JSON 能表示的值（遊戲狀態本來就是）。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
  }
  return `{${parts.join(',')}}`;
}

/** 值的 SHA-256（十六進位）。 */
export function digestOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
