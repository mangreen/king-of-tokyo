/**
 * 彈幕排版（純邏輯）：訊息從場景右側進入、向左飛出。
 * 所有彈幕等速，所以同一條軌道上只要「後一則在前一則尾巴完全進場後才出發」就永遠不會重疊；
 * 軌道都忙時讓訊息稍微延後出發，等太久就丟掉（聊天不是重要資料，不能堆積成一大串）。
 */

/** 預估一段文字的像素寬度：全形字（中日韓、全形符號、emoji）約 1 em，其他約 0.6 em。 */
export function estimateWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    em += code >= 0x2e80 ? 1.05 : 0.6;
  }
  return Math.ceil(em * fontSize);
}

export interface Placement {
  lane: number;
  /** 出發時間（與 now 同一時間基準）。 */
  startAt: number;
}

/** 同一條軌道上，前後兩則之間至少留這麼多像素的空隙。 */
export const LANE_GAP_PX = 32;
/** 最多願意讓一則彈幕等多久才出發（毫秒）；超過就丟棄。 */
export const MAX_WAIT_MS = 4000;

export class LanePlanner {
  /** 每條軌道「尾巴完全進場、下一則可以出發」的時間。 */
  private readonly freeAt: number[];

  constructor(readonly laneCount: number) {
    this.freeAt = Array.from({ length: Math.max(1, laneCount) }, () => 0);
  }

  /**
   * 為寬 width（px）的彈幕選軌道與出發時間；speed 是 px／毫秒。
   * 回傳 null＝等太久，丟棄。
   */
  place(now: number, width: number, speed: number): Placement | null {
    let best = 0;
    for (let i = 1; i < this.freeAt.length; i += 1) {
      if ((this.freeAt[i] ?? 0) < (this.freeAt[best] ?? 0)) best = i;
    }
    const startAt = Math.max(now, this.freeAt[best] ?? 0);
    if (startAt - now > MAX_WAIT_MS) return null;
    this.freeAt[best] = startAt + (width + LANE_GAP_PX) / speed;
    return { lane: best, startAt };
  }
}

export interface DanmakuLayout {
  /** 軌道數。 */
  lanes: number;
  /** 每條軌道的高度（px）。 */
  laneHeight: number;
  /** 彈幕區距離場景上緣（px）。 */
  top: number;
  /** 飛越整個畫面的速度（px／毫秒）。 */
  speed: number;
}

/** 彈幕只佔場景上方一帶，不遮住怪獸與下方的操作。 */
export const DANMAKU_AREA = 0.34;
/** 一則彈幕穿過整個畫面的大約時間（毫秒）。 */
export const CROSS_MS = 9000;

export function layoutFor(
  containerWidth: number,
  containerHeight: number,
  fontSize: number,
  speedFactor = 1,
): DanmakuLayout {
  const laneHeight = Math.ceil(fontSize * 1.5);
  const top = Math.round(Math.min(56, containerHeight * 0.08));
  const area = Math.max(laneHeight, containerHeight * DANMAKU_AREA - top);
  const lanes = Math.max(1, Math.min(8, Math.floor(area / laneHeight)));
  const speed = Math.max(0.03, (containerWidth / CROSS_MS) * speedFactor);
  return { lanes, laneHeight, top, speed };
}

/** 彈幕偏好的範圍（設定面板的拉桿與解析共用）。 */
export const DANMAKU_OPACITY = { min: 0.2, max: 1, step: 0.05, def: 0.75 } as const;
/** 移動速度倍率：1 倍＝約 9 秒飛過整個畫面。 */
export const DANMAKU_SPEED = { min: 0.4, max: 3, step: 0.1, def: 1 } as const;
export const DANMAKU_SIZE = { min: 14, max: 40, step: 1, def: 22 } as const;

export function clampRange(
  value: unknown,
  range: { min: number; max: number; def: number },
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(range.max, Math.max(range.min, value))
    : range.def;
}
