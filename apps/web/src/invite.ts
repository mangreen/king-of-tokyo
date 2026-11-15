import { RoomCodeSchema } from '@kot/protocol';

/** 邀請連結：`https://網址/?room=ABCDE`。用查詢參數，所以任何靜態託管（含 SPA 回退）都能用。 */
export const INVITE_PARAM = 'room';

/** 從網址的 search 部分取出房號；沒有或格式不對（長度、字元）回傳 null。大小寫不拘。 */
export function parseInvite(search: string): string | null {
  const raw = new URLSearchParams(search).get(INVITE_PARAM);
  if (raw === null) return null;
  const parsed = RoomCodeSchema.safeParse(raw.trim());
  return parsed.success ? parsed.data : null;
}

/**
 * 依目前頁面網址組出邀請連結（保留網址與路徑，丟掉其他參數與 hash）。
 * 預設是房主模式，所以不必帶 mode；伺服器權威模式（mode=server）要保留，
 * 否則客人會走房主模式、去找一個不存在的房主。
 */
export function inviteUrl(pageHref: string, code: string): string {
  const url = new URL(pageHref);
  const mode = url.searchParams.get('mode');
  url.search = '';
  url.hash = '';
  if (mode === 'server') url.searchParams.set('mode', 'server');
  url.searchParams.set(INVITE_PARAM, code);
  return url.toString();
}

/** 加入後把網址上的邀請參數拿掉，避免重新整理或複製網址時又觸發一次加入。 */
export function withoutInvite(pageHref: string): string {
  const url = new URL(pageHref);
  url.searchParams.delete(INVITE_PARAM);
  return url.toString();
}
