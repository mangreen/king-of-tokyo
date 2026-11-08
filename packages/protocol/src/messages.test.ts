import { describe, expect, it } from 'vitest';
import {
  ClientHelloSchema,
  NicknameSchema,
  PROTOCOL_VERSION,
  ServerErrorSchema,
  ServerHelloSchema,
} from './messages.js';

describe('NicknameSchema', () => {
  it('接受中文、英文與數字，並去除前後空白', () => {
    expect(NicknameSchema.parse('  哥吉拉Fan_01 ')).toBe('哥吉拉Fan_01');
  });

  it('拒絕空字串與純空白', () => {
    expect(NicknameSchema.safeParse('').success).toBe(false);
    expect(NicknameSchema.safeParse('   ').success).toBe(false);
  });

  it('拒絕超過 20 字', () => {
    expect(NicknameSchema.safeParse('a'.repeat(21)).success).toBe(false);
    expect(NicknameSchema.safeParse('a'.repeat(20)).success).toBe(true);
  });

  it('拒絕 HTML、控制字元與特殊符號', () => {
    expect(NicknameSchema.safeParse('<script>').success).toBe(false);
    expect(NicknameSchema.safeParse('a\nb').success).toBe(false);
    expect(NicknameSchema.safeParse('a\u0000b').success).toBe(false);
    expect(NicknameSchema.safeParse("o'; DROP").success).toBe(false);
  });
});

describe('ClientHelloSchema', () => {
  it('接受合法握手', () => {
    const parsed = ClientHelloSchema.parse({ protocolVersion: 2, nickname: 'Mang' });
    expect(parsed).toEqual({ protocolVersion: 2, nickname: 'Mang' });
  });

  it('sessionToken 必須是 64 個十六進位字元', () => {
    const ok = 'ab'.repeat(32);
    expect(
      ClientHelloSchema.safeParse({ protocolVersion: 2, nickname: 'a', sessionToken: ok }).success,
    ).toBe(true);
    for (const bad of ['', 'abc', 'zz'.repeat(32), 'AB'.repeat(32), `${ok}0`]) {
      expect(
        ClientHelloSchema.safeParse({ protocolVersion: 2, nickname: 'a', sessionToken: bad })
          .success,
      ).toBe(false);
    }
  });

  it('拒絕缺欄位、錯型別與負版本號', () => {
    expect(ClientHelloSchema.safeParse({ nickname: 'Mang' }).success).toBe(false);
    expect(ClientHelloSchema.safeParse({ protocolVersion: '1', nickname: 'Mang' }).success).toBe(
      false,
    );
    expect(ClientHelloSchema.safeParse({ protocolVersion: -1, nickname: 'Mang' }).success).toBe(
      false,
    );
    expect(ClientHelloSchema.safeParse(null).success).toBe(false);
  });
});

describe('ServerHelloSchema', () => {
  const base = {
    protocolVersion: PROTOCOL_VERSION,
    playerId: 'p1',
    sessionToken: 'ab'.repeat(32),
    resumed: false,
    nickname: 'Mang',
    cardSets: [{ id: 'original', name: '原創卡組', cardCount: 72 }],
    defaultCardSetId: 'original',
  };

  it('版本必須等於目前協定版本', () => {
    expect(ServerHelloSchema.safeParse(base).success).toBe(true);
    expect(
      ServerHelloSchema.safeParse({ ...base, protocolVersion: PROTOCOL_VERSION + 1 }).success,
    ).toBe(false);
  });

  it('缺少 token 或 playerId 就拒絕', () => {
    expect(ServerHelloSchema.safeParse({ ...base, sessionToken: undefined }).success).toBe(false);
    expect(ServerHelloSchema.safeParse({ ...base, playerId: '' }).success).toBe(false);
  });
});

describe('ServerErrorSchema', () => {
  it('只接受已定義的錯誤碼', () => {
    expect(ServerErrorSchema.safeParse({ code: 'invalid_message', message: 'x' }).success).toBe(
      true,
    );
    expect(ServerErrorSchema.safeParse({ code: 'boom', message: 'x' }).success).toBe(false);
  });
});
