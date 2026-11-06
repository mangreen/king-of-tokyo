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
    const parsed = ClientHelloSchema.parse({ protocolVersion: 1, nickname: 'Mang' });
    expect(parsed).toEqual({ protocolVersion: 1, nickname: 'Mang' });
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
  it('版本必須等於目前協定版本', () => {
    expect(
      ServerHelloSchema.safeParse({ protocolVersion: PROTOCOL_VERSION, connectionId: 'abc' })
        .success,
    ).toBe(true);
    expect(
      ServerHelloSchema.safeParse({ protocolVersion: PROTOCOL_VERSION + 1, connectionId: 'abc' })
        .success,
    ).toBe(false);
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
