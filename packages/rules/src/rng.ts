/**
 * 可重現的亂數產生器（mulberry32）。
 *
 * 設計重點：狀態是一個 uint32 數字，函式為純函式（回傳新狀態）。
 * 這樣 RNG 狀態可以放進 GameState、序列化、重放（replay）。
 * 伺服器以 crypto 產生初始 seed；本模組不依賴任何 I/O。
 *
 * 注意：mulberry32 僅適合測試與模擬，不可用於任何安全用途（token、房號等）。
 *
 * 正式對局使用 KeyedRng：以 128 位元密鑰與計數器經 SHA-256 產生亂數。32 位元的 mulberry32
 * 狀態可以從公開的骰面反推（暴力搜尋 2^32 約 40 秒），一旦知道狀態就能預測之後所有的骰子與洗牌；
 * 密鑰式亂數則無法從輸出反推密鑰。狀態仍是純資料，所以「設定 + seed + 動作日誌」仍可完整重放。
 */
import { sha256Words, stringToBytes } from './sha256.js';

/** uint32 狀態，需為 0 ~ 2^32-1 的整數。 */
export type RngState = number;

const UINT32_RANGE = 0x1_0000_0000; // 2^32

function assertUint32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) {
    throw new RangeError(`${name} 必須是 0 ~ 2^32-1 的整數，收到 ${String(value)}`);
  }
}

/** 密鑰式亂數的狀態：128 位元密鑰（四個 uint32）與已取用的次數。 */
export interface KeyedRng {
  key: readonly [number, number, number, number];
  n: number;
}

/** 遊戲使用的亂數狀態：測試用的 uint32 mulberry32，或正式對局用的 KeyedRng。 */
export type GameRng = RngState | KeyedRng;

/** 重放與建立對局用的 seed：數字（測試、模擬；不安全）或高熵字串（正式對局）。 */
export type Seed = number | string;

function keyedUint32(state: KeyedRng): [value: number, next: KeyedRng] {
  const block = Math.floor(state.n / 8);
  const words = sha256Words([
    ...state.key.flatMap((w) => [w >>> 24, (w >>> 16) & 0xff, (w >>> 8) & 0xff, w & 0xff]),
    ...[block >>> 0, Math.floor(block / UINT32_RANGE) >>> 0].flatMap((w) => [
      w >>> 24,
      (w >>> 16) & 0xff,
      (w >>> 8) & 0xff,
      w & 0xff,
    ]),
  ]);
  return [words[state.n % 8] as number, { key: state.key, n: state.n + 1 }];
}

/** 取得下一個 uint32，並回傳新狀態。 */
export function nextUint32(state: RngState): [value: number, nextState: RngState] {
  assertUint32(state, 'state');
  const nextState = (state + 0x6d2b79f5) >>> 0;
  let t = nextState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = (t ^ (t >>> 14)) >>> 0;
  return [value, nextState];
}

/**
 * 取得 [0, maxExclusive) 的均勻整數（以拒絕取樣避免取模偏差）。
 * maxExclusive 必須是 1 ~ 2^32 的整數。
 */
export function nextInt(state: RngState, maxExclusive: number): [number, RngState];
export function nextInt(state: KeyedRng, maxExclusive: number): [number, KeyedRng];
export function nextInt(state: GameRng, maxExclusive: number): [number, GameRng];
export function nextInt(state: GameRng, maxExclusive: number): [number, GameRng] {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new RangeError(`maxExclusive 必須是 1 ~ 2^32 的整數，收到 ${String(maxExclusive)}`);
  }
  // 小於 limit 的值才均勻對應到 [0, maxExclusive)
  const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
  let current: GameRng = state;
  for (;;) {
    let raw: number;
    if (typeof current === 'number') {
      const drawn = nextUint32(current);
      raw = drawn[0];
      current = drawn[1];
    } else {
      const drawn = keyedUint32(current);
      raw = drawn[0];
      current = drawn[1];
    }
    if (raw < limit) {
      return [raw % maxExclusive, current];
    }
  }
}

/** 將任意整數 seed 正規化為合法的 RngState。 */
export function seedToState(seed: number): RngState {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError(`seed 必須是安全整數，收到 ${String(seed)}`);
  }
  // 以 2^32 為模，負數也映射到合法範圍
  return ((seed % UINT32_RANGE) + UINT32_RANGE) % UINT32_RANGE;
}

/**
 * 由 seed 建立遊戲亂數。數字 seed 用 mulberry32（可重現，但不安全）；
 * 字串 seed 用密鑰式亂數：字串經 SHA-256 取 128 位元當密鑰，因此字串本身需要足夠的熵
 * （伺服器用 16 個隨機位元組的十六進位字串）。
 */
export function seedToRng(seed: Seed): GameRng {
  if (typeof seed === 'number') return seedToState(seed);
  if (seed.length < 16) {
    throw new RangeError('字串 seed 至少需要 16 個字元');
  }
  const words = sha256Words(stringToBytes(`kot-rng:${seed}`));
  return { key: [words[0], words[1], words[2], words[3]] as KeyedRng['key'], n: 0 };
}
