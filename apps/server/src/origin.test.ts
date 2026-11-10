import { describe, expect, it } from 'vitest';
import { isOriginAllowed } from './origin.js';

const ALLOWED = ['http://localhost:5173'];

describe('isOriginAllowed', () => {
  it('沒有 Origin（非瀏覽器）允許；清單內允許；其他拒絕', () => {
    expect(isOriginAllowed(undefined, 'x.run.app', ALLOWED, false)).toBe(true);
    expect(isOriginAllowed('http://localhost:5173', 'x', ALLOWED, false)).toBe(true);
    expect(isOriginAllowed('https://evil.test', 'x.run.app', ALLOWED, false)).toBe(false);
  });

  it('同來源模式：Origin 的 host 等於請求 Host 才允許', () => {
    expect(isOriginAllowed('https://kot-demo.a.run.app', 'kot-demo.a.run.app', ALLOWED, true)).toBe(
      true,
    );
    expect(isOriginAllowed('https://KOT-demo.a.run.app', 'kot-demo.a.run.app', ALLOWED, true)).toBe(
      true,
    );
    expect(isOriginAllowed('https://evil.test', 'kot-demo.a.run.app', ALLOWED, true)).toBe(false);
    // 子網域、埠不同都不算同來源
    expect(
      isOriginAllowed('https://a.kot-demo.a.run.app', 'kot-demo.a.run.app', ALLOWED, true),
    ).toBe(false);
    expect(isOriginAllowed('http://localhost:9999', 'localhost:8080', ALLOWED, true)).toBe(false);
  });

  it('沒開同來源模式、或沒有 Host、或 Origin 壞掉 → 拒絕', () => {
    expect(isOriginAllowed('https://x.run.app', 'x.run.app', ALLOWED, false)).toBe(false);
    expect(isOriginAllowed('https://x.run.app', undefined, ALLOWED, true)).toBe(false);
    expect(isOriginAllowed('not a url', 'x.run.app', ALLOWED, true)).toBe(false);
    expect(isOriginAllowed('null', 'x.run.app', ALLOWED, true)).toBe(false);
  });
});
