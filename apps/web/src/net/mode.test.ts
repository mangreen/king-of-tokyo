import { describe, expect, it } from 'vitest';
import { modeUrl, parseMode } from './mode.js';

describe('連線模式', () => {
  it('預設是房主模式；mode 參數與舊的 offline 參數都認得；未知值視為預設', () => {
    expect(parseMode('')).toBe('p2p');
    expect(parseMode('?mode=server')).toBe('server');
    expect(parseMode('?mode=p2p')).toBe('p2p');
    expect(parseMode('?mode=offline')).toBe('offline');
    expect(parseMode('?offline=1')).toBe('offline');
    expect(parseMode('?offline=true')).toBe('offline');
    expect(parseMode('?mode=bogus')).toBe('p2p');
    expect(parseMode('?offline=0')).toBe('p2p');
    expect(parseMode('?mode=p2p&room=ABCDE')).toBe('p2p');
  });

  it('切換模式的網址：預設模式不帶參數，其他保留其他參數並拿掉邀請與舊參數', () => {
    const base = 'https://x.test/play?quality=low&room=ABCDE&offline=1';
    expect(modeUrl(base, 'offline')).toBe('https://x.test/play?quality=low&mode=offline');
    expect(modeUrl(base, 'server')).toBe('https://x.test/play?quality=low&mode=server');
    expect(modeUrl('https://x.test/?mode=offline', 'p2p')).toBe('https://x.test/');
    expect(parseMode(new URL(modeUrl(base, 'offline')).search)).toBe('offline');
  });
});
