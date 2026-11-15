import { describe, expect, it } from 'vitest';
import { buildServiceWorker } from './buildSw.js';

describe('buildServiceWorker', () => {
  const src = buildServiceWorker('abc123', ['/assets/a.js', '/assets/b.css', '/assets/a.js']);

  it('內容是合法的 JavaScript，列出去重並排序後的檔案', () => {
    expect(() => new Function(src)).not.toThrow();
    const m = /const ASSETS = (\[.*\]);/.exec(src);
    expect(JSON.parse(m?.[1] ?? '[]')).toEqual([
      '/',
      '/assets/a.js',
      '/assets/b.css',
      '/index.html',
    ]);
    expect(src).toContain('const VERSION = "abc123"');
  });

  it('即時連線不經過 Service Worker；頁面導覽網路優先', () => {
    expect(src).toContain("'/socket.io'");
    expect(src).toContain("'/relay'");
    expect(src).toMatch(/req\.mode === 'navigate'[\s\S]*fetch\(req\)\.catch/);
  });

  it('更新版本時清掉舊版存檔', () => {
    expect(src).toContain("k.startsWith('kot-') && k !== CACHE");
  });
});
