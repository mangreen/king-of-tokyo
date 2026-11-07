import { describe, expect, it } from 'vitest';
import { ACK_ERROR_CODES } from '@kot/protocol';
import { ACK_MESSAGES, ackMessage, hasAllAckMessages } from './messages.js';

describe('ackMessage', () => {
  it('每個伺服器錯誤碼都有給玩家看的訊息，且沒有多餘的項目', () => {
    expect(hasAllAckMessages()).toBe(true);
    expect(Object.keys(ACK_MESSAGES).sort()).toEqual([...ACK_ERROR_CODES].sort());
  });

  it('訊息不洩漏內部名稱', () => {
    for (const code of ACK_ERROR_CODES) {
      expect(ackMessage(code)).not.toMatch(/zod|stack|node_modules|undefined/i);
    }
  });
});
