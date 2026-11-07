/**
 * 重連用的身分暫存。使用 sessionStorage：只在這個分頁有效，關閉分頁就消失，
 * 降低 token 被其他分頁或長期留在磁碟上的風險。儲存空間不可用時（隱私模式等）功能照常，只是無法重連。
 */
const TOKEN_KEY = 'kot.sessionToken';
const NICKNAME_KEY = 'kot.nickname';

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
  clear(): void {
    write(TOKEN_KEY, null);
    write(NICKNAME_KEY, null);
  },
};
