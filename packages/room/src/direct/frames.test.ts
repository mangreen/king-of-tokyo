import { describe, expect, it } from 'vitest';
import {
  FRAME_CHARS,
  FrameAssembler,
  FrameEncoder,
  FrameError,
  MAX_MESSAGE_CHARS,
} from './frames.js';

describe('訊框：切段與還原', () => {
  it('短訊息一個訊框', () => {
    const frames = new FrameEncoder().encode('{"a":1}');
    expect(frames).toEqual(['M{"a":1}']);
    expect(new FrameAssembler().push(frames[0] as string)).toBe('{"a":1}');
  });

  it('長訊息（含中文與表情符號）切成多段並完整還原，每段都不超過上限', () => {
    const text = '怪獸😀'.repeat(8_000);
    const encoder = new FrameEncoder();
    const frames = encoder.encode(text);
    expect(frames.length).toBeGreaterThan(3);
    for (const frame of frames) {
      expect(new TextEncoder().encode(frame).length).toBeLessThan(16_384);
    }
    const assembler = new FrameAssembler();
    const outputs = frames.map((frame) => assembler.push(frame));
    expect(outputs.slice(0, -1).every((value) => value === null)).toBe(true);
    expect(outputs.at(-1)).toBe(text);
  });

  it('交錯的兩則長訊息各自還原', () => {
    const encoder = new FrameEncoder();
    const a = 'a'.repeat(FRAME_CHARS * 2 + 1);
    const b = 'b'.repeat(FRAME_CHARS * 2 + 1);
    const fa = encoder.encode(a);
    const fb = encoder.encode(b);
    const assembler = new FrameAssembler();
    const results = [fa[0], fb[0], fa[1], fb[1], fa[2], fb[2]].map((f) =>
      assembler.push(f as string),
    );
    expect(results.filter((value) => value !== null)).toEqual([a, b]);
  });

  it('不可信的訊框：格式錯誤、重複、過長、太多進行中都會丟出錯誤', () => {
    const assembler = () => new FrameAssembler();
    expect(() => assembler().push('X')).toThrow(FrameError);
    expect(() => assembler().push('C1,0:abc')).toThrow(FrameError);
    expect(() => assembler().push('C1,5,3:abc')).toThrow(FrameError);
    expect(() => assembler().push('C1,0,1:abc')).toThrow(FrameError); // 總段數至少 2
    expect(() => assembler().push('C1,0,999:abc')).toThrow(FrameError);
    expect(() => assembler().push('C-1,0,2:abc')).toThrow(FrameError);
    expect(() => assembler().push(`M${'x'.repeat(MAX_MESSAGE_CHARS + 1)}`)).toThrow(FrameError);

    const dup = assembler();
    dup.push('C1,0,2:abc');
    expect(() => dup.push('C1,0,2:abc')).toThrow(FrameError);

    const many = assembler();
    for (let id = 0; id < 8; id += 1) many.push(`C${String(id)},0,2:x`);
    expect(() => many.push('C8,0,2:x')).toThrow(FrameError);

    const big = assembler();
    const part = 'y'.repeat(100_000);
    big.push(`C1,0,256:${part}`);
    big.push(`C1,1,256:${part}`);
    expect(() => big.push(`C1,2,256:${part}`)).toThrow(FrameError);
  });
});
