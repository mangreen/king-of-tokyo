import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256Words, stringToBytes } from './sha256.js';

const hex = (words: number[]): string => words.map((w) => w.toString(16).padStart(8, '0')).join('');
const bytesOf = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

describe('SHA-256（與 NIST 與 Node crypto 的結果比對）', () => {
  it('空字串與 "abc"', () => {
    expect(hex(sha256Words([]))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(hex(sha256Words(bytesOf('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('填充的邊界長度（55、56、64 位元組）', () => {
    expect(hex(sha256Words(Array<number>(55).fill(97)))).toBe(
      '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318',
    );
    expect(hex(sha256Words(Array<number>(56).fill(97)))).toBe(
      'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a',
    );
    expect(hex(sha256Words(Array<number>(64).fill(97)))).toBe(
      'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    );
  });

  it('多區塊（1000 位元組）', () => {
    const bytes = Array.from({ length: 1000 }, (_, i) => (i * 7 + 3) & 255);
    expect(hex(sha256Words(bytes))).toBe(
      '1e9bc38cbf860b9ec31918b065f9b52476c549a782e0e7990bed8ce3868d2371',
    );
  });

  it('stringToBytes 對不同字串給出不同位元組', () => {
    expect(stringToBytes('ab')).not.toEqual(stringToBytes('ba'));
    expect(stringToBytes('é')).toEqual([0xe9, 0]);
  });
});

describe('sha256Hex（UTF-8 標準 SHA-256）', () => {
  // 期望值由 Python hashlib 與 Node crypto 交叉產生；規則套件不引入 node 型別，所以寫成常數
  const vectors: [string, string][] = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    ['東京之王', '257b5f22b8f33262f46b031e542fdecbf97ace5a0f9d15edbfc4e89e0fb4142b'],
    ['a😀b', '6fba5b2ea783ded096fc2444d540ffbdf49168df30993b155b7efb683313f110'],
  ];
  it('與標準向量一致：空字串、ASCII、跨區塊、中文、表情符號', () => {
    for (const [text, expected] of vectors) expect(sha256Hex(text)).toBe(expected);
  });

  it('長字串（多區塊、多位元組字元）', () => {
    expect(sha256Hex('混合 mixed 😀 text '.repeat(500))).toBe(
      'f475500c34e9f31a553e0e3113e39f425e2ff6b94cda5641db0509ad57de202b',
    );
  });
});
