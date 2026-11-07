import { useEffect, useState } from 'react';

/** 倒數顯示（秒）。截止時間以收到訊息時的本機時間換算，避免伺服器與本機時鐘的誤差。 */
export function Countdown({ deadlineAt }: { deadlineAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadlineAt === null) return undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, [deadlineAt]);
  if (deadlineAt === null) return null;
  const seconds = Math.max(0, Math.ceil((deadlineAt - now) / 1000));
  return (
    <span className={seconds <= 10 ? 'countdown urgent' : 'countdown'} aria-label="剩餘時間">
      ⏱ {seconds}s
    </span>
  );
}
