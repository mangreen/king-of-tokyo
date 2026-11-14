import { useEffect } from 'react';
import type { RoomPhase } from '@kot/protocol';
import {
  describeAudit,
  setAuditReport,
  TRUST_POINTS,
  TRUST_SUMMARY,
  useAuditReport,
} from '../net/auditStatus.js';

interface Props {
  phase: RoomPhase | null;
  /** 房主自己不稽核自己：局後只提示客人會各自稽核。 */
  isHost: boolean;
}

/** 房主模式的信任說明，以及局後的稽核結果。 */
export function AuditPanel({ phase, isHost }: Props) {
  const report = useAuditReport();
  // 離開「對局結束」就清掉結果，避免下一局結束時先閃出上一局的
  useEffect(() => {
    if (phase !== 'over') setAuditReport(null);
  }, [phase]);

  const view = report && phase === 'over' ? describeAudit(report) : null;
  return (
    <div className="audit" data-testid="audit-panel">
      <details data-testid="trust-note">
        <summary>{TRUST_SUMMARY}</summary>
        <ul>
          {TRUST_POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </details>
      {phase === 'over' && isHost && (
        <div data-testid="audit-host-note">
          對局結束。每位客人的瀏覽器會各自重放整場並核對你給的畫面（結果只有他們自己看得到）。
        </div>
      )}
      {phase === 'over' && !isHost && view === null && (
        <div data-testid="audit-pending" className="muted">
          稽核中：正在重放整場對局…
        </div>
      )}
      {view !== null && (
        <div className={`audit-result audit-${view.tone}`} role="status" data-testid="audit-result">
          <strong>
            {view.tone === 'ok' ? '✅ ' : view.tone === 'warn' ? '⚠️ ' : '❌ '}
            {view.title}
          </strong>
          <ul>
            {view.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
