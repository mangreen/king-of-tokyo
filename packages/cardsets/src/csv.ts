/**
 * 官方卡表 CSV 的匯入。CSV 只存在使用者的機器上（card-sets/local/，不提交）。
 * 本檔只含「怎麼讀」與「怎麼對應效果」；對應表以卡名的雜湊為 key（effect-map.json），
 * 因此公開 repo 裡不會出現卡表的卡名清單（ADR-0004）。
 */
import { createHash } from 'node:crypto';
import type { CardDef, CardParams } from '@kot/rules';
import { parseCardSet } from './schema.js';
import type { CardSet } from './schema.js';

/** 一般的 CSV 解析（RFC 4180：雙引號包住欄位、`""` 代表一個引號、欄位內可有換行）。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface EffectMapping {
  effectId: string;
  params: CardParams;
}

/** 卡名正規化：小寫、去掉 (xN) 後綴與所有非英數字元。 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(\s*x\s*\d+\s*\)/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function nameKey(name: string): string {
  return createHash('sha256').update(normalizeName(name)).digest('hex');
}

const SYMBOLS: [RegExp, string][] = [
  [/\[Star\]/gi, '★'],
  [/\[Heart\]/gi, '❤'],
  [/\[Energy\]/gi, '⚡'],
  [/\[Attack\]/gi, '💥'],
];

/** 修補 CSV 的已知瑕疵並把記號換成符號。回傳文字與做過的修補。 */
export function cleanAbility(raw: string): { text: string; fixes: string[] } {
  const fixes: string[] = [];
  let text = raw.trim();
  const stripped = text.replace(/^"+|"+$/g, '');
  if (stripped !== text) {
    fixes.push('移除多餘的雙引號');
    text = stripped;
  }
  const open = (text.match(/\(/g) ?? []).length;
  const close = (text.match(/\)/g) ?? []).length;
  if (open > close) {
    fixes.push('補上缺少的右括號');
    text += ')'.repeat(open - close);
  }
  if (/[A-Za-z0-9]$/.test(text)) {
    fixes.push('補上句尾句點');
    text += '.';
  }
  for (const [pattern, symbol] of SYMBOLS) {
    text = text.replace(pattern, symbol);
  }
  text = text.replace(/\[(\d)\]/g, '[$1]');
  return { text, fixes };
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(\s*x\s*\d+\s*\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ImportResult {
  set: CardSet;
  /** 修補的紀錄（卡名 → 修補內容），供匯入腳本在本機印出。 */
  fixes: string[];
}

/**
 * 把官方卡表 CSV 轉成卡牌組。每張卡都必須在對應表中找到效果，否則丟出錯誤並列出卡名
 * （只會印在使用者自己的終端機，不會寫進任何提交的檔案）。
 */
export function importOfficialCsv(
  csv: string,
  map: Readonly<Record<string, EffectMapping>>,
  meta: { id: string; name: string; version?: number } = { id: 'local', name: '自備卡表' },
): ImportResult {
  const rows = parseCsv(csv).filter((r) => r.some((f) => f.trim() !== ''));
  const header = rows.shift();
  if (!header || header.length < 4 || header[0]?.trim().toLowerCase() !== 'name') {
    throw new Error('CSV 欄位應為 Name, Cost, Type, Ability');
  }
  const cards: CardDef[] = [];
  const fixes: string[] = [];
  const unmapped: string[] = [];
  const ids = new Set<string>();

  for (const [index, row] of rows.entries()) {
    const rawName = (row[0] ?? '').trim();
    const cost = Number((row[1] ?? '').trim());
    const type = (row[2] ?? '').trim().toLowerCase();
    if (!rawName || !Number.isInteger(cost) || (type !== 'keep' && type !== 'discard')) {
      throw new Error(`CSV 第 ${String(index + 2)} 筆資料格式不正確`);
    }
    const copies = Number(/\(\s*x\s*(\d+)\s*\)/i.exec(rawName)?.[1] ?? '1');
    const name = rawName.replace(/\s*\(\s*x\s*\d+\s*\)/i, '').trim();
    const mapping = map[nameKey(name)];
    if (!mapping) {
      unmapped.push(name);
      continue;
    }
    const { text, fixes: f } = cleanAbility(row[3] ?? '');
    if (f.length > 0) fixes.push(`${name}：${f.join('、')}`);
    for (let n = 1; n <= copies; n += 1) {
      const base = slug(name);
      const id = copies > 1 ? `${base}-${String(n)}` : base;
      if (ids.has(id)) throw new Error(`卡牌 id 重複：${id}`);
      ids.add(id);
      cards.push({
        id,
        name,
        cost,
        kind: type,
        text,
        effectId: mapping.effectId,
        params: { ...mapping.params },
      });
    }
  }
  if (unmapped.length > 0) {
    throw new Error(
      `有 ${String(unmapped.length)} 張卡沒有對應的效果（不會被略過）：${unmapped.join('、')}`,
    );
  }
  const set = parseCardSet({
    id: meta.id,
    name: meta.name,
    version: meta.version ?? 1,
    cards,
  });
  return { set, fixes };
}
