import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@kot/protocol';

/** 產生房號。randomInt(max) 必須回傳 [0, max) 的整數，正式環境使用 crypto.randomInt。 */
export function generateRoomCode(randomInt: (maxExclusive: number) => number): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET.charAt(randomInt(ROOM_CODE_ALPHABET.length));
  }
  return code;
}
