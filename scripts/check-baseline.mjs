// 基準機相容性守門：確認 lockfile 沒有引入基準機（macOS 11 Big Sur）跑不動的原生工具。
//
// 背景：esbuild 從 0.27.0 起，macOS 二進位檔的最低系統版本由 11 升到 12
// （使用了 macOS 12 才有的 SecTrustCopyCertificateChain），在 Big Sur 上
// `pnpm install` 的 postinstall 會以 dyld "Symbol not found" 失敗。
// 見 AGENTS.md「環境約束」。
//
// 這裡只檢查已知會出問題的套件；新增限制時請在 RULES 加一筆並註明原因。
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

if (problems.length > 0) {
  console.error('基準機相容性檢查失敗：\n' + problems.map((p) => `- ${p}`).join('\n'));
  process.exit(1);
}
console.log('基準機相容性檢查通過（lockfile 沒有需要 macOS 12 以上的原生工具）');
