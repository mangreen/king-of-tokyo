import { RoomCodeSchema } from '@kot/protocol';

/**
 * 重連用的身分暫存。使用 sessionStorage：只在這個分頁有效，關閉分頁就消失，
 * 降低 token 被其他分頁或長期留在磁碟上的風險。儲存空間不可用時（隱私模式等）功能照常，只是無法重連。
 */
const TOKEN_KEY = 'kot.sessionToken';
const NICKNAME_KEY = 'kot.nickname';
const P2P_ROOM_KEY = 'kot.p2pRoom';

/** 房主模式（p2p）正在參與的房間：重新整理後據此決定接回的方式（房主還原／客人重新加入）。 */
export interface P2pRoomMarker {
  role: 'host' | 'guest';
  code: string;
}

/** 不信任儲存的內容：形狀不對就當作沒有。 */
export function parseP2pRoomMarker(raw: string | null): P2pRoomMarker | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null) return null;
    const { role, code } = value as Record<string, unknown>;
    if ((role !== 'host' && role !== 'guest') || typeof code !== 'string') return null;
    const parsed = RoomCodeSchema.safeParse(code);
    return parsed.success ? { role, code: parsed.data } : null;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // 儲存空間不可用：略過
  }
}

export const session = {
  token: () => read(TOKEN_KEY),
  nickname: () => read(NICKNAME_KEY),
  save(nickname: string, token: string): void {
    write(NICKNAME_KEY, nickname);
    write(TOKEN_KEY, token);
  },
  p2pRoom: (): P2pRoomMarker | null => parseP2pRoomMarker(read(P2P_ROOM_KEY)),
  setP2pRoom(marker: P2pRoomMarker | null): void {
    write(P2P_ROOM_KEY, marker === null ? null : JSON.stringify(marker));
  },
  clear(): void {
    write(TOKEN_KEY, null);
    write(NICKNAME_KEY, null);
    write(P2P_ROOM_KEY, null);
  },
};
