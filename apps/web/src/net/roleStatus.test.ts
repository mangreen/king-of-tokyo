import { describe, expect, it } from 'vitest';
import { describeRole, roleChangeNotice } from './roleStatus.js';

const guest = { role: 'guest', standby: 'watching', rank: 1, epoch: 0 } as const;
const host = { role: 'host', standby: 'done', rank: null, epoch: 1 } as const;

describe('角色顯示', () => {
  it('說明目前角色與後備名次', () => {
    expect(describeRole(host)).toBe('你是房主');
    expect(describeRole(guest)).toContain('第 1 順位');
    expect(describeRole({ ...guest, rank: null })).toContain('沒有接手資格');
  });

  it('角色真的改變才提示；第一次得知角色不提示', () => {
    expect(roleChangeNotice(null, host)).toBeNull();
    expect(roleChangeNotice(guest, guest)).toBeNull();
    expect(roleChangeNotice(guest, { ...guest, rank: 2 })).toBeNull();
    expect(roleChangeNotice(guest, host)).toContain('接手');
    expect(roleChangeNotice(host, guest)).toContain('換人');
  });
});
