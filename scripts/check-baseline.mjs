// 基準機相容性守門：確認 lockfile 沒有引入基準機（macOS 11 Big Sur）跑不動的原生工具。
//
// 背景：esbuild 從 0.27.0 起，macOS 二進位檔的最低系統版本由 11 升到 12
// （使用了 macOS 12 才有的 SecTrustCopyCertificateChain），在 Big Sur 上
// `pnpm install` 的 postinstall 會以 dyld "Symbol not found" 失敗。
// 見 AGENTS.md「環境約束」。
//
// 這裡只檢查已知會出問題的套件；新增限制時請在 RULES 加一筆並註明原因。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const RULES = [
  {
    name: 'esbuild',
    // 允許的最高版本（不含）；0.27.0 起需要 macOS 12
    below: [0, 27, 0],
    reason: 'esbuild >= 0.27.0 的 macOS 二進位檔需要 macOS 12，基準機（Big Sur 11）無法安裝',
    hint: 'tsx 請用 4.20.x（宣告 esbuild ~0.25）、tsup 請用 8.5.0（宣告 ^0.25）；不要用 pnpm update --latest',
  },
];

function parse(version) {
  return version.split('.').map((part) => Number.parseInt(part, 10));
}

function isBelow(version, limit) {
  const parts = parse(version);
  for (let i = 0; i < limit.length; i += 1) {
    const a = parts[i] ?? 0;
    const b = limit[i];
    if (a !== b) return a < b;
  }
  return false;
}

const lockfile = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const problems = [];

for (const rule of RULES) {
  // lockfile 的 packages 區段每個套件一行：  esbuild@0.25.12:
  const pattern = new RegExp(`^ {2}${rule.name}@(\\d+\\.\\d+\\.\\d+):`, 'gm');
  const versions = [...new Set([...lockfile.matchAll(pattern)].map((match) => match[1]))];
  for (const version of versions) {
    if (!isBelow(version, rule.below)) {
      problems.push(`${rule.name}@${version}：${rule.reason}\n  處理：${rule.hint}`);
    }
  }
}

// 大小寫不敏感的檔案系統（macOS 預設）：foo.ts 與 Foo.tsx 會被當成同一個模組，
// 在大小寫敏感的 Linux／CI 看不出問題，到 Mac 才出現「does not provide an export」。
// 只比對「去掉副檔名後只差大小寫」的來源檔。
const sources = execFileSync(
  'git',
  ['ls-files', '-z', '--', '*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'],
  {
    encoding: 'utf8',
    cwd: new URL('..', import.meta.url),
  },
)
  .split('\0')
  .filter(Boolean);
const byStem = new Map();
for (const file of sources) {
  const stem = file.replace(/\.(test\.)?[cm]?[jt]sx?$/, (_m, t) => (t ? '.test' : ''));
  const key = stem.toLowerCase();
  byStem.set(key, [...(byStem.get(key) ?? []), file]);
}
for (const files of byStem.values()) {
  const stems = new Set(files.map((f) => f.replace(/\.[cm]?[jt]sx?$/, '')));
  if (stems.size > 1) {
    problems.push(
      `檔名只差大小寫：${files.join('、')}\n  處理：macOS（大小寫不敏感）會把它們當成同一個模組；請改成不同的名字`,
    );
  }
}

if (problems.length > 0) {
  console.error('基準機相容性檢查失敗：\n' + problems.map((p) => `- ${p}`).join('\n'));
  process.exit(1);
}
console.log(
  '基準機相容性檢查通過（lockfile 沒有需要 macOS 12 以上的原生工具、沒有只差大小寫的檔名）',
);
