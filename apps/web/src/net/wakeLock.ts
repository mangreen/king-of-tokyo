/**
 * 螢幕喚醒鎖（M8）：對局中不讓螢幕休眠。房主的螢幕一休眠，瀏覽器就可能凍結分頁，房間跟著停擺，
 * 其他玩家都會卡住。喚醒鎖在分頁被隱藏時會被系統自動釋放，回到前景要重新取得。
 * 不支援或被拒絕時不影響遊戲，只回報狀態讓畫面提醒使用者。
 */
export type WakeLockStatus = 'idle' | 'held' | 'unsupported' | 'denied';

interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export interface WakeLockEnv {
  nav: { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };
  doc: {
    readonly visibilityState: string;
    addEventListener(type: 'visibilitychange', listener: () => void): void;
    removeEventListener(type: 'visibilitychange', listener: () => void): void;
  };
}

export class WakeLockController {
  private sentinel: Sentinel | null = null;
  private wanted = false;
  private requesting = false;
  private status: WakeLockStatus;

  constructor(
    private readonly env: WakeLockEnv,
    private readonly onStatus: (status: WakeLockStatus) => void,
  ) {
    this.status = env.nav.wakeLock ? 'idle' : 'unsupported';
    env.doc.addEventListener('visibilitychange', this.onVisibility);
    onStatus(this.status);
  }

  /** 要不要保持螢幕開啟（對局中為 true）。 */
  setWanted(wanted: boolean): void {
    this.wanted = wanted;
    if (wanted) void this.acquire();
    else this.release();
  }

  dispose(): void {
    this.env.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.wanted = false;
    this.release();
  }

  private readonly onVisibility = (): void => {
    if (this.wanted && this.env.doc.visibilityState === 'visible') void this.acquire();
  };

  private set(status: WakeLockStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.onStatus(status);
  }

  private async acquire(): Promise<void> {
    const api = this.env.nav.wakeLock;
    if (!api || this.sentinel || this.requesting || this.env.doc.visibilityState !== 'visible') {
      return;
    }
    this.requesting = true;
    try {
      const sentinel = await api.request('screen');
      if (!this.wanted) {
        void sentinel.release();
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) {
          this.sentinel = null;
          this.set('idle'); // 被系統釋放（例如分頁被隱藏）：回到前景時會再取得
        }
      });
      this.set('held');
    } catch {
      this.set('denied'); // 省電模式、權限政策等
    } finally {
      this.requesting = false;
    }
  }

  private release(): void {
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel) void sentinel.release();
    if (this.status === 'held') this.set('idle');
  }
}
