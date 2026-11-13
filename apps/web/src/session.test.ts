import { describe, expect, it } from 'vitest';
import { parseP2pRoomMarker } from './session.js';

describe('房主模式的房間標記', () => {
  it('接受合法的房主／客人標記', () => {
    expect(parseP2pRoomMarker('{"role":"host","code":"ABCDE"}')).toEqual({
      role: 'host',
      code: 'ABCDE',
    });
    expect(parseP2pRoomMarker('{"role":"guest","code":"23456"}')?.role).toBe('guest');
  });

  it('不信任儲存內容：壞資料、缺欄位、不合法房號一律當作沒有', () => {
    for (const raw of [
      null,
      '',
      'not json',
      '[]',
      'null',
      '{"role":"admin","code":"ABCDE"}',
      '{"role":"host"}',
      '{"role":"host","code":"ab"}',
      '{"role":"host","code":"IIIII"}', // 房號字母表不含 I／O／0／1
      '{"role":"host","code":12345}',
    ]) {
      expect(parseP2pRoomMarker(raw)).toBeNull();
    }
  });
});
