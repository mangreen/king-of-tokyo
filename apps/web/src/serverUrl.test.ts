import { describe, expect, it } from 'vitest';
import { DEV_SERVER_URL, resolveServerUrl } from './serverUrl.js';

describe('resolveServerUrl', () => {
  it('沒設定 → 本機開發預設；空字串 → 同網址；其他照設定', () => {
    expect(resolveServerUrl(undefined, 'https://demo.run.app')).toBe(DEV_SERVER_URL);
    expect(resolveServerUrl('', 'https://demo.run.app')).toBe('https://demo.run.app');
    expect(resolveServerUrl('  ', 'https://demo.run.app')).toBe('https://demo.run.app');
    expect(resolveServerUrl('https://api.example.test', 'https://demo.run.app')).toBe(
      'https://api.example.test',
    );
  });
});
