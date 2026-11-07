/**
 * 把 card-sets/local/ 下的官方卡表 CSV 轉成 card-sets/local/set.json。
 * 用法：pnpm --filter @kot/cardsets run import
 * 輸入與輸出都在 card-sets/local/（.gitignore，不提交）。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importOfficialCsv } from '../src/csv.js';
import type { EffectMapping } from '../src/csv.js';
import { hashCardSet } from '../src/hash.js';

const here = dirname(fileURLToPath(import.meta.url));
const localDir = join(here, '..', '..', '..', 'card-sets', 'local');
const map = JSON.parse(readFileSync(join(here, '..', 'src', 'effect-map.json'), 'utf8')) as Record<
  string,
  EffectMapping
>;

const csvFiles = readdirSync(localDir).filter((f) => f.toLowerCase().endsWith('.csv'));
if (csvFiles.length === 0) {
  console.error(`在 ${localDir} 找不到 CSV 檔。請先把卡表放進去。`);
  process.exit(1);
}
if (csvFiles.length > 1) {
  console.error(`找到多個 CSV（${csvFiles.join('、')}），請只留一個。`);
  process.exit(1);
}
const file = csvFiles[0] as string;
try {
  const { set, fixes } = importOfficialCsv(readFileSync(join(localDir, file), 'utf8'), map);
  writeFileSync(join(localDir, 'set.json'), `${JSON.stringify(set, null, 2)}\n`);
  for (const fix of fixes) console.log(`修補：${fix}`);
  const keep = set.cards.filter((c) => c.kind === 'keep').length;
  console.log(
    `完成：${file} → set.json（${set.cards.length} 張，Keep ${keep}／Discard ${set.cards.length - keep}），雜湊 ${hashCardSet(set).slice(0, 12)}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
