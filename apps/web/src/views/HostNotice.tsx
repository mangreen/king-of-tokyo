import { useState, type ReactNode } from 'react';
import { describeAudit, useAuditReport } from '../net/auditStatus.js';

const KEY = 'kot.hostNoticeOpen';

/** 讀取上次的展開狀態；沒有、讀不到（無痕、停用儲存）一律預設收合。 */
export function readOpen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(KEY, open ? '1' : '0');
  } catch {
    // 儲存不可用：只是不記住而已
  }
}

interface Props {
  /** 'host'／'guest'；還沒連上為 null。 */
  role: 'host' | 'guest' | null;
  /** 房間階段；稽核結果只在對局結束後才有意義。 */
  phase: string | null;
  children: ReactNode;
}

/**
 * 房主模式的說明、連線狀態、信任說明與稽核結果：預設收合，只留一行摘要。
 * 摘要也帶著稽核結論（✅／⚠️／❌），所以稽核失敗不會因為收合而看不到。
 */
export function HostNotice({ role, phase, children }: Props) {
  const [open, setOpen] = useState(readOpen);
  const report = useAuditReport();
  const audit = report && phase === 'over' ? describeAudit(report) : null;
  const badge =
    audit === null
      ? ''
      : audit.tone === 'ok'
        ? '　✅ 稽核通過'
        : audit.tone === 'warn'
          ? '　⚠️ 稽核通過（種子來源無法驗證）'
          : '　❌ 稽核未通過';

  return (
    <details
      className="notice host-notice"
      data-testid="p2p-banner"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        writeOpen(next);
      }}
    >
      <summary data-testid="p2p-summary">
        房主模式
        {role === null ? '' : role === 'host' ? '　你是房主' : '　你是客人'}
        {badge}
        <span className="host-notice-hint">{open ? '（點此收合）' : '（點此展開說明與狀態）'}</span>
      </summary>
      <div role="status">{children}</div>
    </details>
  );
}
