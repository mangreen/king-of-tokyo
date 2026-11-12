/**
 * 直連通道的訊框：RTCDataChannel 單則訊息各瀏覽器上限不同（保守取 16 KB），
 * 所以較長的訊息切成多段，對方收齊再還原。通道本身是可靠且有序的。
 *
 * 訊框是字串：`M` + 完整訊息，或 `C` + id,序號,總段數 + `:` + 片段。
 * 對方不可信：還原時限制總長度、同時進行的訊息數與段數。
 */

/** 每段最多幾個字元（UTF-16 單位）；最壞情況每單位 3 位元組，仍小於 16 KB。 */
export const FRAME_CHARS = 5_000;
/** 一則完整訊息最多幾個字元。卡牌目錄約 10 KB，遠小於此。 */
export const MAX_MESSAGE_CHARS = 262_144;
const MAX_IN_FLIGHT = 8;
const MAX_PARTS = 256;

export class FrameError extends Error {}

export class FrameEncoder {
  private nextId = 0;

  encode(text: string, frameChars = FRAME_CHARS): string[] {
    if (text.length <= frameChars) return [`M${text}`];
    const total = Math.ceil(text.length / frameChars);
    const id = this.nextId;
    this.nextId = (this.nextId + 1) % 1_000_000;
    const frames: string[] = [];
    for (let index = 0; index < total; index += 1) {
      const part = text.slice(index * frameChars, (index + 1) * frameChars);
      frames.push(`C${String(id)},${String(index)},${String(total)}:${part}`);
    }
    return frames;
  }
}

interface Partial {
  total: number;
  parts: (string | undefined)[];
  got: number;
  chars: number;
}

export class FrameAssembler {
  private readonly partial = new Map<number, Partial>();

  /** 收到一個訊框：湊齊一則完整訊息就回傳，否則回傳 null。格式不對或超出限制時丟出 FrameError。 */
  push(frame: string): string | null {
    if (frame.startsWith('M')) {
      if (frame.length - 1 > MAX_MESSAGE_CHARS) throw new FrameError('訊息過長');
      return frame.slice(1);
    }
    if (!frame.startsWith('C')) throw new FrameError('未知訊框');
    const colon = frame.indexOf(':');
    if (colon < 0 || colon > 40) throw new FrameError('訊框標頭錯誤');
    const header = frame.slice(1, colon).split(',');
    if (header.length !== 3) throw new FrameError('訊框標頭錯誤');
    const [id, index, total] = header.map((value) =>
      /^\d{1,7}$/.test(value) ? Number(value) : -1,
    );
    if (id === undefined || index === undefined || total === undefined)
      throw new FrameError('訊框標頭錯誤');
    if (id < 0 || index < 0 || total < 2 || total > MAX_PARTS || index >= total) {
      throw new FrameError('訊框標頭錯誤');
    }
    const part = frame.slice(colon + 1);
    let entry = this.partial.get(id);
    if (!entry) {
      if (this.partial.size >= MAX_IN_FLIGHT) throw new FrameError('同時進行的分段訊息太多');
      entry = {
        total,
        parts: new Array<string | undefined>(total).fill(undefined),
        got: 0,
        chars: 0,
      };
      this.partial.set(id, entry);
    }
    if (entry.total !== total || entry.parts[index] !== undefined)
      throw new FrameError('訊框重複或不一致');
    entry.parts[index] = part;
    entry.got += 1;
    entry.chars += part.length;
    if (entry.chars > MAX_MESSAGE_CHARS) throw new FrameError('訊息過長');
    if (entry.got < entry.total) return null;
    this.partial.delete(id);
    return entry.parts.join('');
  }
}
