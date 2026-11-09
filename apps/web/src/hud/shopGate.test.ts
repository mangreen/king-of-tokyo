import { describe, expect, it } from 'vitest';
import { shouldHoldEndTurn } from './shopGate.js';

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
