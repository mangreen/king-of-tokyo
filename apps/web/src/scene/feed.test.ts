import { describe, expect, it } from 'vitest';
import { latestVersion, takeNew, type FeedBatch } from './feed.js';

const b = (version: number): FeedBatch => ({ version, events: [] });

describe('feed', () => {
  it('只取沒播過的批次，並更新已播版本', () => {
    const feed = [b(1), b(2), b(3)];
    expect(takeNew(feed, 1)).toEqual({ batches: [b(2), b(3)], lastPlayed: 3 });
    expect(takeNew(feed, 3)).toEqual({ batches: [], lastPlayed: 3 });
    expect(takeNew([], 5)).toEqual({ batches: [], lastPlayed: 5 });
  });

  it('剛掛載：以最新版本為起點就不重播歷史', () => {
    const feed = [b(4), b(5)];
    const start = latestVersion(feed);
    expect(takeNew(feed, start).batches).toEqual([]);
    expect(takeNew([...feed, b(6)], start).batches).toEqual([b(6)]);
    expect(latestVersion([])).toBe(-1);
  });
});
