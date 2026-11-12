import { describe, expect, it } from 'vitest';
import { parseDirectConfig, parseIceServers } from './direct.js';

describe('直連設定', () => {
  it('ICE 伺服器：預設是 STUN；空字串代表不使用；只接受 stun/turn 網址', () => {
    expect(parseIceServers(undefined)).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
    expect(parseIceServers('')).toEqual([]);
    expect(parseIceServers('stun:a.example:3478, http://bad ,turn:b.example')).toEqual([
      { urls: 'stun:a.example:3478' },
      { urls: 'turn:b.example' },
    ]);
  });

  it('預設開啟；?direct=0 或 VITE_DIRECT=0 關閉；瀏覽器不支援時關閉；網址參數優先', () => {
    expect(parseDirectConfig('', {}, true).enabled).toBe(true);
    expect(parseDirectConfig('?direct=0', {}, true).enabled).toBe(false);
    expect(parseDirectConfig('?direct=false', {}, true).enabled).toBe(false);
    expect(parseDirectConfig('', { VITE_DIRECT: '0' }, true).enabled).toBe(false);
    expect(parseDirectConfig('?direct=1', { VITE_DIRECT: '0' }, true).enabled).toBe(true);
    expect(parseDirectConfig('', {}, false).enabled).toBe(false);
  });
});
