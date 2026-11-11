/** Token bucket 限流：容量 capacity，每秒補充 refillPerSecond 個。 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  /** 嘗試取用 cost 個（預設 1；中繼用位元組數當成本）；額度不足回傳 false 且不扣。 */
  take(cost = 1): boolean {
    const current = this.now();
    const elapsedSeconds = Math.max(0, current - this.last) / 1000;
    this.last = current;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    if (this.tokens < cost) {
      return false;
    }
    this.tokens -= cost;
    return true;
  }
}
