// 建置試玩 image 時，為網頁的文字類資源預先產生 .br 與 .gz，
// 讓伺服器（@fastify/static preCompressed）直接送壓縮檔：省流量，也不吃 CPU。
// 用法：node scripts/precompress.mjs <網頁目錄>
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const TEXT = new Set(['.js', '.css', '.html', '.json', '.svg', '.txt', '.map', '.webmanifest']);
const MIN_BYTES = 512;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const root = process.argv[2];
if (!root) {
  console.error('用法：node scripts/precompress.mjs <網頁目錄>');
  process.exit(2);
}

let files = 0;
let before = 0;
let after = 0;
for (const path of walk(root)) {
  if (!TEXT.has(extname(path)) || /\.(br|gz)$/.test(path)) continue;
  const data = readFileSync(path);
  if (data.length < MIN_BYTES) continue;
  const br = brotliCompressSync(data, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  });
  writeFileSync(`${path}.br`, br);
  writeFileSync(`${path}.gz`, gzipSync(data, { level: 9 }));
  files += 1;
  before += data.length;
  after += br.length;
}
console.log(
  `預先壓縮 ${String(files)} 個檔案：${String(before)} → ${String(after)} bytes（brotli）`,
);
