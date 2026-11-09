import { describe, expect, it } from 'vitest';
import { placePopover } from './placement.js';

const view = { width: 800, height: 600 };
const pop = { width: 240, height: 120 };

describe('placePopover', () => {
  it('放得下就放在觸發元素下方並水平置中', () => {
    const p = placePopover({ left: 300, top: 100, width: 80, height: 24 }, pop, view);
    expect(p.side).toBe('below');
    expect(p.top).toBe(100 + 24 + 8);
    expect(p.left).toBe(300 + 40 - 120);
  });

  it('下方放不下、上方放得下時翻到上方', () => {
    const p = placePopover({ left: 300, top: 560, width: 80, height: 24 }, pop, view);
    expect(p.side).toBe('above');
    expect(p.top).toBe(560 - 8 - 120);
  });

  it('靠近左右邊緣時夾進視窗（留邊距）', () => {
    const l = placePopover({ left: 0, top: 100, width: 40, height: 24 }, pop, view);
    expect(l.left).toBe(8);
    const r = placePopover({ left: 780, top: 100, width: 20, height: 24 }, pop, view);
    expect(r.left).toBe(800 - 240 - 8);
  });

  it('視窗比彈出框還小時不會超出上緣', () => {
    const p = placePopover(
      { left: 10, top: 20, width: 30, height: 20 },
      { width: 300, height: 400 },
      { width: 320, height: 300 },
    );
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.left).toBeGreaterThanOrEqual(8);
  });
});
