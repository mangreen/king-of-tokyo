import { useSyncExternalStore } from 'react';
import type { GuestPath, HostPathInfo } from '@kot/room';

/** 畫面要顯示的連線方式：客人（直連／中繼）或房主（各有幾位、是否停泊）。 */
export type PathStatus =
  { role: 'guest'; path: GuestPath } | ({ role: 'host' } & HostPathInfo) | null;

let current: PathStatus = null;
const listeners = new Set<() => void>();

export function setPathStatus(next: PathStatus): void {
  current = next;
  for (const listener of listeners) listener();
}

export function usePathStatus(): PathStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
}

/** 人看得懂的描述。 */
export function describePath(status: NonNullable<PathStatus>): string {
  if (status.role === 'guest') {
    return status.path === 'direct'
      ? '連線方式：與房主直連（不經過伺服器）'
      : '連線方式：經伺服器轉送（直連尚未建立或已中斷）';
  }
  const parts: string[] = [];
  if (status.direct > 0) parts.push(`${String(status.direct)} 位玩家直連`);
  if (status.relay > 0) parts.push(`${String(status.relay)} 位經伺服器轉送`);
  if (parts.length === 0) return '連線方式：目前沒有其他玩家';
  return `連線方式：${parts.join('、')}${status.parked ? '；伺服器連線已暫停（不佔用伺服器）' : ''}`;
}
