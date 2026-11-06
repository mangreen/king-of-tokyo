/**
 * 可重現的亂數產生器（mulberry32）。
 *
 * 設計重點：狀態是一個 uint32 數字，函式為純函式（回傳新狀態）。
 * 這樣 RNG 狀態可以放進 GameState、序列化、重放（replay）。
 * 伺服器以 crypto 產生初始 seed；本模組不依賴任何 I/O。
 *
 * 注意：mulberry32 僅適合遊戲骰子，不可用於任何安全用途（token、房號等）。
 */

/** uint32 狀態，需為 0 ~ 2^32-1 的整數。 */
export type RngState = number;

const UINT32_RANGE = 0x1_0000_0000; // 2^32

function assertUint32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) {
    throw new RangeError(`${name} 必須是 0 ~ 2^32-1 的整數，收到 ${String(value)}`);
  }
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
export function nextInt(
  state: RngState,
  maxExclusive: number,
): [value: number, nextState: RngState] {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new RangeError(`maxExclusive 必須是 1 ~ 2^32 的整數，收到 ${String(maxExclusive)}`);
  }
  // 小於 limit 的值才均勻對應到 [0, maxExclusive)
  const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
  let current = state;
  for (;;) {
    const [raw, next] = nextUint32(current);
    current = next;
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
