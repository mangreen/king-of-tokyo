/**
 * 畫質分級與自動降級（純邏輯）。依 ADR-0003 的效能預算：
 * 2014 MBP 13" 要穩定 ≥30 FPS；掉到預算以下就自動降一級，只降不升（避免來回震盪）。
 */

export type QualityTier = 'high' | 'medium' | 'low';
export type QualitySetting = QualityTier | 'auto';

export interface QualitySettings {
  /** devicePixelRatio 上限。 */
  dprCap: number;
  antialias: boolean;
  /** 真實陰影貼圖邊長；0 = 改用假陰影（地面圓形斑點）。 */
  shadowMapSize: number;
  /** 同時存在的碎片數上限。 */
  debris: number;
  /** 同時存在的煙塵粒子上限。 */
  dust: number;
  /** 建築密度 0–1（取固定子集，所有人看到的城市一致）。 */
  buildingDensity: number;
  /** 怪獸圓形球面/圓柱的分段數。 */
  segments: number;
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  high: {
    dprCap: 1.5,
    antialias: true,
    shadowMapSize: 1024,
    debris: 60,
    dust: 300,
    buildingDensity: 1,
    segments: 16,
  },
  medium: {
    dprCap: 1.25,
    antialias: false,
    shadowMapSize: 512,
    debris: 40,
    dust: 200,
    buildingDensity: 0.85,
    segments: 12,
  },
  low: {
    dprCap: 1,
    antialias: false,
    shadowMapSize: 0,
    debris: 20,
    dust: 100,
    buildingDensity: 0.65,
    segments: 8,
  },
};

const ORDER: QualityTier[] = ['high', 'medium', 'low'];

export function lowerTier(tier: QualityTier): QualityTier | null {
  return ORDER[ORDER.indexOf(tier) + 1] ?? null;
}

export function parseQualitySetting(value: unknown): QualitySetting {
  return value === 'high' || value === 'medium' || value === 'low' || value === 'auto'
    ? value
    : 'auto';
}

/** 「自動」時的起始等級：先用高畫質，跑起來太慢再降。 */
export function startTier(setting: QualitySetting): QualityTier {
  return setting === 'auto' ? 'high' : setting;
}

export interface AutoDegradeOptions {
  /** 低於這個 FPS 就視為跟不上。 */
  minFps?: number;
  /** 暖機忽略的幀數（著色器編譯、紋理上傳會卡）。 */
  warmupFrames?: number;
  /** 取樣視窗的幀數。 */
  windowFrames?: number;
}

/**
 * 餵入每一幀的耗時（ms），一個視窗的平均超過預算就建議降一級。
 * 超過 250ms 的幀（切分頁、休眠）視為雜訊，不計入。
 */
export class AutoDegrade {
  private readonly budgetMs: number;
  private readonly warmup: number;
  private readonly window: number;
  private seen = 0;
  private sum = 0;
  private count = 0;

  constructor(options: AutoDegradeOptions = {}) {
    this.budgetMs = 1000 / (options.minFps ?? 26);
    this.warmup = options.warmupFrames ?? 60;
    this.window = options.windowFrames ?? 90;
  }

  /** 回傳 true 表示該降一級了（呼叫端降級後會自動重新暖機）。 */
  push(frameMs: number): boolean {
    if (frameMs > 250 || frameMs <= 0) return false;
    this.seen++;
    if (this.seen <= this.warmup) return false;
    this.sum += frameMs;
    this.count++;
    if (this.count < this.window) return false;
    const slow = this.sum / this.count > this.budgetMs;
    this.sum = 0;
    this.count = 0;
    if (slow) this.reset();
    return slow;
  }

  reset(): void {
    this.seen = 0;
    this.sum = 0;
    this.count = 0;
  }
}
