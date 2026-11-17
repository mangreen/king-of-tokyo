import { describe, expect, it } from 'vitest';
import { pickToastRoot } from './Toasts.js';

describe('pickToastRoot（提示掛在哪）', () => {
  const body = { name: 'body' };
  it('一般狀態掛 body', () => {
    expect(pickToastRoot(null, body)).toBe(body);
  });
  it('全螢幕時掛進全螢幕元素（掛在 body 的提示在全螢幕下看不到）', () => {
    const wrap = { name: 'scene-wrap' };
    expect(pickToastRoot(wrap, body)).toBe(wrap);
  });
});
