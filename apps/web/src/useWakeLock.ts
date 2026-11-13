import { useEffect, useRef, useState } from 'react';
import { WakeLockController, type WakeLockEnv, type WakeLockStatus } from './net/wakeLock.js';

/** 對局中（active）保持螢幕開啟；回傳目前狀態，不支援或被拒絕時畫面可以提醒使用者。 */
export function useWakeLock(active: boolean): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>('idle');
  const controller = useRef<WakeLockController | null>(null);

  useEffect(() => {
    // navigator／document 在瀏覽器裡就是 WakeLockEnv 需要的形狀；型別上只宣告用到的部分
    const env = { nav: navigator, doc: document } as unknown as WakeLockEnv;
    const created = new WakeLockController(env, setStatus);
    controller.current = created;
    return () => {
      created.dispose();
      controller.current = null;
    };
  }, []);

  useEffect(() => {
    controller.current?.setWanted(active);
  }, [active]);

  return status;
}
