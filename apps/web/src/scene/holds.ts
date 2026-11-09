import type { Cue } from './director.js';

/**
 * 狀態與演出的先後：遊戲狀態一到就是「結算後」的樣子，但畫面要等對應的 cue 播到才更新
 * （受傷時才扣血、淘汰時才倒下、讓位／進東京時才跳）。這裡統計每個座位還有幾個
 * 尚未播出的 cue，渲染器在計數歸零前不套用該項狀態。
 */
export type HoldKind = 'hit' | 'ko' | 'move';

export interface SeatHolds {
  hit: number;
  ko: number;
  move: number;
}

/**
 * 一個 cue 保留哪些狀態。淘汰（ko）同時保留「移動」：被淘汰的東京怪獸在伺服器狀態裡
 * 已離開東京，但畫面上應該就地倒下，而不是先跳回環形座位再倒。
 */
export function holdKindsOf(cue: Cue): { seat: number; kinds: readonly HoldKind[] } | null {
  switch (cue.kind) {
    case 'hit':
      return { seat: cue.seat, kinds: ['hit'] };
    case 'ko':
      return { seat: cue.seat, kinds: ['ko', 'move'] };
    case 'stomp':
    case 'leave':
      return { seat: cue.seat, kinds: ['move'] };
    default:
      return null;
  }
}

export class Holds {
  private readonly map = new Map<number, SeatHolds>();

  private of(seat: number): SeatHolds {
    let h = this.map.get(seat);
    if (!h) {
      h = { hit: 0, ko: 0, move: 0 };
      this.map.set(seat, h);
    }
    return h;
  }

  add(cues: readonly Cue[]): void {
    for (const c of cues) {
      const k = holdKindsOf(c);
      if (k) for (const kind of k.kinds) this.of(k.seat)[kind]++;
    }
  }

  release(cue: Cue): number | null {
    const k = holdKindsOf(cue);
    if (!k) return null;
    const h = this.of(k.seat);
    for (const kind of k.kinds) h[kind] = Math.max(0, h[kind] - 1);
    return k.seat;
  }

  held(seat: number, kind: HoldKind): boolean {
    return (this.map.get(seat)?.[kind] ?? 0) > 0;
  }

  clear(): void {
    this.map.clear();
  }
}
