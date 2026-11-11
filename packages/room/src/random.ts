/**
 * 亂數與雜湊的可攜實作：只用 Web Crypto 的 getRandomValues（Node 22 與所有瀏覽器都有，
 * 而且不像 crypto.subtle／randomUUID 需要安全連線），不碰 node:crypto。
 */
import { sha256Hex } from '@kot/rules';

/** 只宣告用到的部分，避免為了型別而引入 DOM 或 node 型別。 */
const webCrypto = (
  globalThis as unknown as { crypto: { getRandomValues<T extends Uint8Array>(array: T): T } }
).crypto;

const fill = (bytes: Uint8Array): Uint8Array => webCrypto.getRandomValues(bytes);

/** [0, maxExclusive) 的整數（CSPRNG，以拒絕取樣避免模數偏差）。 */
export function cryptoRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x1_0000_0000) {
    throw new RangeError('maxExclusive 必須是 1 到 2^32 之間的整數');
  }
  const buffer = new Uint32Array(1);
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % maxExclusive);
  for (;;) {
    fill(new Uint8Array(buffer.buffer));
    const value = buffer[0] as number;
    if (value < limit) return value % maxExclusive;
  }
}

/** n 個 CSPRNG 位元組的十六進位字串（長度 2n）。 */
export function randomHex(bytes: number): string {
  const out = fill(new Uint8Array(bytes));
  let hex = '';
  for (const byte of out) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * 對局的亂數 seed：16 個 CSPRNG 位元組（128 位元）。**seed 是機密**：知道它就能預測所有骰子與牌序，
 * 所以只留在房間（伺服器或房主）的記憶體與重放資料裡，不送給任何客戶端、不寫進日誌。
 */
export function randomSeed(): string {
  return randomHex(16);
}

/** 重連 token 的雜湊（只存雜湊，記憶體外洩時不會直接洩漏可用的 token）。 */
export function hashToken(token: string): string {
  return sha256Hex(token);
}
