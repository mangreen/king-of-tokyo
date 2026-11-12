import { describe, expect, it } from 'vitest';
import { describePath } from './pathStatus.js';

describe('連線方式說明', () => {
  it('客人', () => {
    expect(describePath({ role: 'guest', path: 'direct' })).toContain('直連');
    expect(describePath({ role: 'guest', path: 'relay' })).toContain('轉送');
  });
  it('房主：人數與停泊', () => {
    expect(describePath({ role: 'host', direct: 2, relay: 1, parked: false })).toBe(
      '連線方式：2 位玩家直連、1 位經伺服器轉送',
    );
    expect(describePath({ role: 'host', direct: 2, relay: 0, parked: true })).toContain('暫停');
    expect(describePath({ role: 'host', direct: 0, relay: 0, parked: false })).toContain('沒有');
  });
});
