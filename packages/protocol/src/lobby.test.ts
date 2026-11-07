import { describe, expect, it } from 'vitest';
import {
  ACK_ERROR_CODES,
  GameActionSchema,
  ROOM_CODE_ALPHABET,
  RoomCodeSchema,
  RoomJoinSchema,
  RoomReadySchema,
} from './lobby.js';

describe('RoomCodeSchema', () => {
  it('接受 5 碼並轉成大寫、去除空白', () => {
    expect(RoomCodeSchema.parse(' abc23 ')).toBe('ABC23');
  });

  it.each(['', 'ABCD', 'ABCDEF', 'ABCI2', 'ABCO2', 'ABC01', 'ABC-2', '<b>23'])(
    '拒絕 %j',
    (code) => {
      expect(RoomCodeSchema.safeParse(code).success).toBe(false);
    },
  );

  it('字元集不含易混淆的字元，且每個字元都被接受', () => {
    for (const bad of 'IO01') expect(ROOM_CODE_ALPHABET).not.toContain(bad);
    for (const ch of ROOM_CODE_ALPHABET) {
      expect(RoomCodeSchema.safeParse(ch.repeat(5)).success).toBe(true);
    }
  });
});

describe('GameActionSchema', () => {
  it('接受三種意圖', () => {
    expect(GameActionSchema.safeParse({ type: 'roll', keep: [0, 2] }).success).toBe(true);
    expect(GameActionSchema.safeParse({ type: 'endRolling' }).success).toBe(true);
    expect(GameActionSchema.safeParse({ type: 'yieldDecision', leave: false }).success).toBe(true);
  });

  it('拒絕未知類型、錯型別、過長或不合理的索引', () => {
    const bad: unknown[] = [
      null,
      {},
      { type: 'cheat' },
      { type: 'roll' },
      { type: 'roll', keep: 'abc' },
      { type: 'roll', keep: [-1] },
      { type: 'roll', keep: [1.5] },
      { type: 'roll', keep: [99] },
      { type: 'roll', keep: Array.from({ length: 13 }, () => 0) },
      { type: 'yieldDecision', leave: 'yes' },
      { type: 'yieldDecision' },
    ];
    for (const payload of bad) {
      expect(GameActionSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('不接受客戶端自帶座位（座位由伺服器決定）：多餘欄位被丟棄', () => {
    const parsed = GameActionSchema.parse({ type: 'endRolling', seat: 3 });
    expect(parsed).toEqual({ type: 'endRolling' });
  });
});

describe('其他訊息', () => {
  it('room:join 需要合法房號', () => {
    expect(RoomJoinSchema.safeParse({ code: 'abcde' }).success).toBe(true);
    expect(RoomJoinSchema.safeParse({ code: 'x' }).success).toBe(false);
    expect(RoomJoinSchema.safeParse({}).success).toBe(false);
  });

  it('room:ready 需要布林值', () => {
    expect(RoomReadySchema.safeParse({ ready: true }).success).toBe(true);
    expect(RoomReadySchema.safeParse({ ready: 1 }).success).toBe(false);
  });

  it('ack 錯誤碼包含規則引擎的所有錯誤碼', () => {
    for (const code of [
      'game_over',
      'not_your_turn',
      'wrong_phase',
      'invalid_keep',
      'invalid_action',
      'no_rolls_left',
      'roll_first',
    ]) {
      expect(ACK_ERROR_CODES).toContain(code);
    }
  });
});
