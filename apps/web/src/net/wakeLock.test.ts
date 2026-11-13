import { describe, expect, it } from 'vitest';
import { WakeLockController, type WakeLockEnv, type WakeLockStatus } from './wakeLock.js';

function setup(options: { supported?: boolean; deny?: boolean } = {}) {
  let visibility = 'visible';
  const visListeners = new Set<() => void>();
  const requests: Array<{ released: boolean; onRelease: () => void }> = [];
  const env: WakeLockEnv = {
    nav:
      options.supported === false
        ? {}
        : {
            wakeLock: {
              request: () => {
                if (options.deny) return Promise.reject(new Error('NotAllowedError'));
                const entry = { released: false, onRelease: (): void => undefined };
                requests.push(entry);
                return Promise.resolve({
                  release: () => {
                    entry.released = true;
                    return Promise.resolve();
                  },
                  addEventListener: (_type: 'release', listener: () => void) => {
                    entry.onRelease = listener;
                  },
                });
              },
            },
          },
    doc: {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (_t, l) => visListeners.add(l),
      removeEventListener: (_t, l) => visListeners.delete(l),
    },
  };
  const statuses: WakeLockStatus[] = [];
  const controller = new WakeLockController(env, (s) => statuses.push(s));
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    controller,
    statuses,
    requests,
    flush,
    setVisibility(v: string) {
      visibility = v;
      for (const l of visListeners) l();
    },
    listeners: visListeners,
  };
}

describe('螢幕喚醒鎖', () => {
  it('不支援的瀏覽器：回報 unsupported，不丟例外', async () => {
    const t = setup({ supported: false });
    t.controller.setWanted(true);
    await t.flush();
    expect(t.statuses).toEqual(['unsupported']);
  });

  it('對局中取得、結束後釋放', async () => {
    const t = setup();
    t.controller.setWanted(true);
    await t.flush();
    expect(t.statuses.at(-1)).toBe('held');
    t.controller.setWanted(false);
    expect(t.requests[0]?.released).toBe(true);
    expect(t.statuses.at(-1)).toBe('idle');
  });

  it('被系統釋放（分頁隱藏）後，回到前景會重新取得', async () => {
    const t = setup();
    t.controller.setWanted(true);
    await t.flush();
    t.setVisibility('hidden');
    t.requests[0]?.onRelease(); // 系統自動釋放
    expect(t.statuses.at(-1)).toBe('idle');
    t.setVisibility('visible');
    await t.flush();
    expect(t.requests).toHaveLength(2);
    expect(t.statuses.at(-1)).toBe('held');
  });

  it('隱藏中不會去要；被拒絕回報 denied', async () => {
    const hidden = setup();
    hidden.setVisibility('hidden');
    hidden.controller.setWanted(true);
    await hidden.flush();
    expect(hidden.requests).toHaveLength(0);
    const denied = setup({ deny: true });
    denied.controller.setWanted(true);
    await denied.flush();
    expect(denied.statuses.at(-1)).toBe('denied');
  });

  it('要鎖的途中就不需要了：取得後立刻釋放；dispose 會移除監聽', async () => {
    const t = setup();
    t.controller.setWanted(true);
    t.controller.setWanted(false);
    await t.flush();
    expect(t.requests[0]?.released).toBe(true);
    t.controller.dispose();
    expect(t.listeners.size).toBe(0);
  });
});
