import { useSyncExternalStore } from 'react';

/** 房主重新整理後「接回原房間」的結果；null＝沒有在還原。 */
export type RestoreStatus = { ok: true } | { ok: false; reason: string } | null;

let current: RestoreStatus = null;
const listeners = new Set<() => void>();

export function setRestoreStatus(next: RestoreStatus): void {
  current = next;
  for (const listener of listeners) listener();
}

export function useRestoreStatus(): RestoreStatus {
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
