import type { GameEvent } from '@kot/rules';

export interface FeedBatch {
  version: number;
  events: readonly GameEvent[];
}

/**
 * 從 feed 取出「還沒播過」的批次（version 大於已播的最大值），並回傳新的已播版本。
 * 場景剛掛載（例如重連、重新整理）時用 `latestVersion` 當起點，就不會把歷史重播一遍。
 */
export function takeNew(
  feed: readonly FeedBatch[],
  lastPlayed: number,
): { batches: FeedBatch[]; lastPlayed: number } {
  // 版本倒退（房主從存檔還原、少了最後幾步）：已播的紀錄比 feed 還新，以 feed 為準，不重播舊事件
  const newest = latestVersion(feed);
  if (feed.length > 0 && newest < lastPlayed) return { batches: [], lastPlayed: newest };
  const batches = feed.filter((b) => b.version > lastPlayed);
  const last = batches.reduce((m, b) => Math.max(m, b.version), lastPlayed);
  return { batches, lastPlayed: last };
}

export function latestVersion(feed: readonly FeedBatch[]): number {
  return feed.reduce((m, b) => Math.max(m, b.version), -1);
}
