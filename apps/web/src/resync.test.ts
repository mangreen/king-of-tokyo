import { describe, expect, it } from 'vitest';
import { createResyncGate, hasGap, isStalled, STALL_GRACE_MS } from './resync.js';

describe('重送判斷', () => {
  it('版本跳號才算漏訊息；同版本（重送）、下一版、倒退、還不知道版本都不算', () => {
    expect(hasGap(5, 7)).toBe(true);
    expect(hasGap(5, 6)).toBe(false);
    expect(hasGap(5, 5)).toBe(false);
    expect(hasGap(5, 3)).toBe(false);
    expect(hasGap(null, 99)).toBe(false);
  });

  it('決策時間過了還沒動靜（超過寬限）才算卡住；沒有計時不會卡住', () => {
    expect(isStalled(null, 1e12)).toBe(false);
    expect(isStalled(1000, 1000 + STALL_GRACE_MS)).toBe(false);
    expect(isStalled(1000, 1001 + STALL_GRACE_MS)).toBe(true);
  });

  it('頻率閘門：間隔內只放行第一次', () => {
    let t = 0;
    const gate = createResyncGate(() => t, 3000);
    expect(gate.tryPass()).toBe(true);
    t = 2999;
    expect(gate.tryPass()).toBe(false);
    t = 3000;
    expect(gate.tryPass()).toBe(true);
  });
});
