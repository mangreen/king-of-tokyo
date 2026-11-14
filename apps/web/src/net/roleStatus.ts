import { useSyncExternalStore } from 'react';
import type { RoleEndpoint, RoleInfo } from '@kot/room';

/** 目前的角色（房主／客人與後備名次）。null＝還沒連線或不是房主模式。 */
export type RoleStatus = RoleInfo | null;

let current: RoleStatus = null;
let endpoint: RoleEndpoint | null = null;
const listeners = new Set<() => void>();

export function setRoleStatus(next: RoleStatus): void {
  current = next;
  for (const listener of listeners) listener();
}

export function useRoleStatus(): RoleStatus {
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

/** 目前的角色切換端點（供畫面呼叫計畫性交接）。 */
export function setRoleEndpoint(next: RoleEndpoint | null): void {
  endpoint = next;
}

/** 把房主交給某位玩家；不是房主或失敗時回傳 false。 */
export function handoverTo(playerId: string): Promise<boolean> {
  return endpoint?.handover(playerId) ?? Promise.resolve(false);
}

/** 人看得懂的角色描述。 */
export function describeRole(status: NonNullable<RoleStatus>): string {
  if (status.role === 'host') return '你是房主';
  if (status.rank === null) return '你是客人（沒有接手資格）';
  return `你是客人，第 ${String(status.rank)} 順位後備房主`;
}

/** 角色變化時要提示的訊息（null＝不需要）。 */
export function roleChangeNotice(
  before: RoleStatus,
  after: NonNullable<RoleStatus>,
): string | null {
  if (before === null || before.role === after.role) return null;
  return after.role === 'host'
    ? '原本的房主已失聯，你已接手成為新的房主，遊戲會繼續進行。'
    : '房主已換人，你現在是客人（你的座位保留，遊戲繼續）。';
}
