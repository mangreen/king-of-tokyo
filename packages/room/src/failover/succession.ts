/**
 * 後備房主的順序與接手金鑰（房主端）。
 *
 * - 每位真人客人一把接手金鑰（128 位元隨機），只在送給本人的複本訊息裡出現；伺服器只收到金鑰的雜湊，
 *   所以伺服器（與其他客人）都無法冒充後備。金鑰跟著玩家、不隨順序改變，順序變動時後備手上的金鑰不會失效。
 * - 順序：直連的排前面（連線穩定、延遲低），其次依加入先後。所有人用同一張表，不需要投票（§4.3）。
 */
import { hashToken } from '../random.js';

export interface Candidate {
  playerId: string;
  /** 與房主之間走直連。 */
  direct: boolean;
  /** 加入的先後（小的先）。 */
  serial: number;
}

/** 排出後備順序：直連優先，其次先加入的優先。 */
export function rankCandidates(candidates: readonly Candidate[]): string[] {
  return [...candidates]
    .sort((a, b) => Number(b.direct) - Number(a.direct) || a.serial - b.serial)
    .map((c) => c.playerId);
}

export class SuccessionPlanner {
  private readonly keys = new Map<string, string>();

  constructor(
    private readonly randomHex: (bytes: number) => string,
    initialKeys: Readonly<Record<string, string>> = {},
  ) {
    for (const [id, key] of Object.entries(initialKeys)) this.keys.set(id, key);
  }

  /** 載入先前存下的金鑰（重新整理後接回）。 */
  load(keys: Readonly<Record<string, string>>): void {
    for (const [id, key] of Object.entries(keys)) this.keys.set(id, key);
  }

  /** 某位玩家的接手金鑰（第一次要時才產生）。 */
  keyOf(playerId: string): string {
    let key = this.keys.get(playerId);
    if (key === undefined) {
      key = this.randomHex(16);
      this.keys.set(playerId, key);
    }
    return key;
  }

  /** 要向伺服器登記的順序：依 order 排列的金鑰雜湊。 */
  hashes(order: readonly string[]): string[] {
    return order.map((id) => hashToken(this.keyOf(id)));
  }

  exportKeys(): Record<string, string> {
    return Object.fromEntries(this.keys);
  }
}
