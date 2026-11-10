import { describe, expect, it } from 'vitest';
import { inviteUrl, parseInvite, withoutInvite } from './invite.js';

describe('邀請連結', () => {
  it('解析房號：大小寫不拘、前後空白可容忍', () => {
    expect(parseInvite('?room=ABCDE')).toBe('ABCDE');
    expect(parseInvite('?room=abcde')).toBe('ABCDE');
    expect(parseInvite('?x=1&room=%20k7m2p%20')).toBe('K7M2P');
  });

  it('沒有、太短、太長、含不存在的字元（如 0 O 1 I）都視為沒有邀請', () => {
    expect(parseInvite('')).toBeNull();
    expect(parseInvite('?room=')).toBeNull();
    expect(parseInvite('?room=ABCD')).toBeNull();
    expect(parseInvite('?room=ABCDEF')).toBeNull();
    expect(parseInvite('?room=AB0DE')).toBeNull();
    expect(parseInvite('?room=<script>')).toBeNull();
  });

  it('組出的連結保留網址與路徑、換掉其他參數與 hash，且能被解析回來', () => {
    const link = inviteUrl('https://kot-demo.a.run.app/some/path?room=OLD12&utm=x#top', 'K7M2P');
    expect(link).toBe('https://kot-demo.a.run.app/some/path?room=K7M2P');
    expect(parseInvite(new URL(link).search)).toBe('K7M2P');
    expect(inviteUrl('http://localhost:5173/', 'ABCDE')).toBe('http://localhost:5173/?room=ABCDE');
  });

  it('加入後拿掉邀請參數，其他參數保留', () => {
    expect(withoutInvite('https://a.test/?room=ABCDE&lang=zh#x')).toBe('https://a.test/?lang=zh#x');
    expect(withoutInvite('https://a.test/?room=ABCDE')).toBe('https://a.test/');
  });
});
