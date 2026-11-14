import { describe, expect, it } from 'vitest';
import type { AuditCheck, AuditReport } from '@kot/room';
import { describeAudit, TRUST_POINTS } from './auditStatus.js';

const pass = (id: AuditCheck['id']): AuditCheck => ({ id, status: 'pass' });

function report(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    ok: true,
    checks: ['cards', 'commit', 'included', 'seed', 'replay', 'observed'].map((id) =>
      pass(id as AuditCheck['id']),
    ),
    compared: 42,
    attempt: 1,
    missing: [],
    actionCount: 80,
    ...overrides,
  };
}

describe('describeAudit', () => {
  it('全部通過：說明重放了幾個動作、比對了幾個畫面、種子是共同產生的', () => {
    const view = describeAudit(report());
    expect(view.tone).toBe('ok');
    expect(view.lines.join('\n')).toContain('80 個動作');
    expect(view.lines.join('\n')).toContain('42 個畫面');
    expect(view.lines.join('\n')).toContain('共同產生');
  });

  it('有失敗：標為未通過並列出失敗項目與原因', () => {
    const view = describeAudit(
      report({
        ok: false,
        checks: [
          pass('cards'),
          { id: 'observed', status: 'fail', detail: '第 12 版畫面與規則重放的結果不同' },
        ],
      }),
    );
    expect(view.tone).toBe('bad');
    expect(view.lines).toEqual(['我看過的畫面與規則一致：第 12 版畫面與規則重放的結果不同']);
  });

  it('房主沒有做種子儀式：通過但提醒種子來源無法驗證', () => {
    const view = describeAudit(
      report({
        checks: [
          pass('cards'),
          { id: 'commit', status: 'skip' },
          { id: 'included', status: 'skip' },
          { id: 'seed', status: 'skip' },
          pass('replay'),
          pass('observed'),
        ],
        attempt: null,
      }),
    );
    expect(view.tone).toBe('warn');
    expect(view.lines.join('\n')).toContain('單方面決定');
  });

  it('我沒參與、有人缺席：照實說明', () => {
    const view = describeAudit(
      report({
        checks: [
          pass('cards'),
          pass('commit'),
          { id: 'included', status: 'skip' },
          pass('seed'),
          pass('replay'),
          pass('observed'),
        ],
        missing: ['a', 'b'],
      }),
    );
    expect(view.tone).toBe('ok');
    expect(view.lines.join('\n')).toContain('你這局沒有參與');
    expect(view.lines.join('\n')).toContain('2 位玩家沒有參與');
  });
});

describe('信任說明', () => {
  it('老實說明偷看無法阻止、信任等級是朋友之間', () => {
    const text = TRUST_POINTS.join('\n');
    expect(text).toContain('無法阻止');
    expect(text).toContain('朋友之間');
    expect(text).toContain('伺服器模式');
  });
});
