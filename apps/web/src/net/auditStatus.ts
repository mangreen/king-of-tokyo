import { useSyncExternalStore } from 'react';
import type { AuditCheckId, AuditReport } from '@kot/room';

/** 最近一局的稽核結果；null＝還沒有（對局中、或這局不需要稽核）。 */
let current: AuditReport | null = null;
const listeners = new Set<() => void>();

export function setAuditReport(next: AuditReport | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export function useAuditReport(): AuditReport | null {
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

const CHECK_NAMES: Record<AuditCheckId, string> = {
  cards: '卡牌組一致',
  commit: '房主的承諾',
  included: '我的亂數有被算進種子',
  seed: '種子由大家共同產生',
  replay: '動作日誌重放合規',
  observed: '我看過的畫面與規則一致',
};

export type AuditTone = 'ok' | 'warn' | 'bad';

export interface AuditView {
  tone: AuditTone;
  title: string;
  lines: string[];
}

/** 把稽核報告整理成人看得懂的文字。 */
export function describeAudit(report: AuditReport): AuditView {
  const failed = report.checks.filter((c) => c.status === 'fail');
  if (failed.length > 0) {
    return {
      tone: 'bad',
      title: '稽核未通過：房主給你的資料與規則對不上',
      lines: failed.map((c) => `${CHECK_NAMES[c.id]}${c.detail ? `：${c.detail}` : ''}`),
    };
  }
  const seedSkipped = report.checks.some((c) => c.id === 'seed' && c.status === 'skip');
  const lines = [
    `重放整場 ${String(report.actionCount)} 個動作，你看過的 ${String(report.compared)} 個畫面全部與規則一致。`,
  ];
  if (seedSkipped) {
    lines.push('房主沒有和大家共同產生種子，骰子與牌序是房主單方面決定的（無法檢查是否被挑選）。');
    return { tone: 'warn', title: '稽核通過，但種子來源無法驗證', lines };
  }
  lines.push(
    `種子由房主與玩家共同產生（第 ${String(report.attempt ?? 1)} 次），房主無法單方面挑選。`,
  );
  const notMine = report.checks.find((c) => c.id === 'included')?.status === 'skip';
  if (notMine) lines.push('你這局沒有參與種子產生（重新整理或中途加入），只檢查了房主自己的承諾。');
  if (report.missing.length > 0) {
    lines.push(`有 ${String(report.missing.length)} 位玩家沒有參與種子產生（逾時或版本較舊）。`);
  }
  return { tone: 'ok', title: '稽核通過', lines };
}

/** 房主模式的信任說明（畫面上常駐，可展開）。 */
export const TRUST_SUMMARY = '關於公平與信任';
export const TRUST_POINTS: readonly string[] = [
  '房主模式沒有中立的伺服器裁判：規則在房主的瀏覽器裡執行。',
  '開局時，種子由房主與所有玩家共同產生（先承諾、再揭露），房主無法單方面挑選骰子與牌序。',
  '每位玩家的瀏覽器都持有重放整局所需的資料，所以有技術的玩家可以偷看牌庫順序——這一點無法阻止，這個模式的信任等級是「朋友之間」。',
  '局後每位玩家的瀏覽器會重放整場，核對房主在對局中給你的每個畫面；房主若改了骰子、血量或日誌，會留下證據。',
  '需要嚴格防作弊（陌生人對戰）請使用伺服器模式。',
];
