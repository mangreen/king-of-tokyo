import { describe, expect, it } from 'vitest';
import { shouldHoldEndTurn, visibleShopToasts } from './shopGate.js';

describe('shouldHoldEndTurn', () => {
  it('買牌階段有買得起的牌 → 先擋住結束回合', () => {
    expect(shouldHoldEndTurn('3-1', null, 2)).toBe(true);
  });
  it('按過「離開商店」之後恢復；下一個回合又會重新擋', () => {
    expect(shouldHoldEndTurn('3-1', '3-1', 2)).toBe(false);
    expect(shouldHoldEndTurn('4-1', '3-1', 2)).toBe(true);
  });
  it('買不起、或不在自己的買牌階段時不擋', () => {
    expect(shouldHoldEndTurn('3-1', null, 0)).toBe(false);
    expect(shouldHoldEndTurn(null, null, 3)).toBe(false);
  });
});

describe('visibleShopToasts（商店提示不會比按鈕久）', () => {
  const shop = { key: 's', action: 'shop' as const, text: '商店有 3 張牌買得起' };
  const other = { key: 'o', text: '輪到你了！' };
  const text = (n: number): string => `商店有 ${String(n)} 張牌買得起`;

  it('買得起：保留提示、其他提示不動；數量沒變就原物件（不重設倒數）', () => {
    const list = [other, shop];
    expect(visibleShopToasts(list, '3-1', null, 3, text)).toEqual(list);
    expect(visibleShopToasts(list, '3-1', null, 3, text)[1]).toBe(shop);
  });
  it('買了牌之後張數變少：數字跟著更新', () => {
    const r = visibleShopToasts([shop], '3-1', null, 1, text);
    expect(r[0]?.text).toBe('商店有 1 張牌買得起');
  });
  it('買到沒能量（買不起了）→ 提示收掉，但其他提示還在', () => {
    expect(visibleShopToasts([other, shop], '3-1', null, 0, text)).toEqual([other]);
  });
  it('按過離開商店、或離開買牌階段 → 提示收掉', () => {
    expect(visibleShopToasts([shop], '3-1', '3-1', 3, text)).toEqual([]);
    expect(visibleShopToasts([shop], null, null, 3, text)).toEqual([]);
  });
  it('沒有商店提示時原樣回傳', () => {
    const list = [other];
    expect(visibleShopToasts(list, '3-1', null, 3, text)).toBe(list);
  });
});
