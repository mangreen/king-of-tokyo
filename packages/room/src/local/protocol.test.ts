import { describe, expect, it } from 'vitest';
import { parseToHost, parseWireToClient, parseWireToHost } from './protocol.js';

describe('信封驗證', () => {
  it('沒有 payload 的事件（client:active）也是合法的', () => {
    expect(parseToHost({ t: 'event', event: 'client:active' })).toEqual({
      t: 'event',
      event: 'client:active',
      payload: undefined,
    });
    expect(parseWireToClient({ t: 'emit', event: 'x' })).not.toBeNull();
  });

  it('不合法的：多餘欄位、事件名過長、未知型別、不是物件', () => {
    expect(parseToHost({ t: 'event', event: 'a', extra: 1 })).toBeNull();
    expect(parseToHost({ t: 'event', event: 'x'.repeat(65) })).toBeNull();
    expect(parseWireToHost({ t: 'nope' })).toBeNull();
    expect(parseWireToHost('garbage')).toBeNull();
    expect(parseWireToClient(null)).toBeNull();
  });

  it('直連控制訊息：協商資料與切換標記；大小受限', () => {
    expect(parseWireToHost({ t: 'switch' })).toEqual({ t: 'switch' });
    expect(
      parseWireToHost({ t: 'rtc', d: { k: 'desc', type: 'offer', sdp: 'v=0' } }),
    ).not.toBeNull();
    expect(
      parseWireToHost({ t: 'rtc', d: { k: 'ice', candidate: 'c', mid: null, index: 0 } }),
    ).not.toBeNull();
    expect(
      parseWireToHost({ t: 'rtc', d: { k: 'desc', type: 'offer', sdp: 'x'.repeat(20_001) } }),
    ).toBeNull();
    expect(
      parseWireToHost({ t: 'rtc', d: { k: 'ice', candidate: 'c', mid: null, index: 999 } }),
    ).toBeNull();
    expect(parseWireToHost({ t: 'rtc', d: { k: 'desc', type: 'bogus', sdp: '' } })).toBeNull();
  });
});
