import { describe, expect, it } from 'vitest';
import { parseMode } from './mode.js';

describe('連線模式', () => {
  it('預設連伺服器；mode 參數與舊的 offline 參數都認得；未知值視為預設', () => {
    expect(parseMode('')).toBe('server');
    expect(parseMode('?mode=p2p')).toBe('p2p');
    expect(parseMode('?mode=offline')).toBe('offline');
    expect(parseMode('?offline=1')).toBe('offline');
    expect(parseMode('?offline=true')).toBe('offline');
    expect(parseMode('?mode=bogus')).toBe('server');
    expect(parseMode('?offline=0')).toBe('server');
    expect(parseMode('?mode=p2p&room=ABCDE')).toBe('p2p');
  });
});
