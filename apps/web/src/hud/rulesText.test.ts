import { describe, expect, it } from 'vitest';
import { diceRules, diceSummary, endRules, tokyoRules, type RuleConfig } from './rulesText.js';

const cfg: RuleConfig = {
  victoryPoints: 20,
  startingHp: 10,
  maxRolls: 3,
  diceCount: 6,
  playerCount: 4,
};

describe('diceSummary', () => {
  it('三顆同點數得該點數 VP，多一顆再 +1（R-DICE-04）', () => {
    expect(diceSummary([2, 2, 2, 1, 3, 'attack'], null)).toContain('3 顆 2 → +2 VP');
    expect(diceSummary([3, 3, 3, 3, 3, 1], null)).toContain('5 顆 3 → +5 VP');
    expect(diceSummary([1, 1, 2, 2, 3, 3], null)).toEqual(['這組骰子沒有可結算的收益']);
  });

  it('能量每個 +1；治療在東京內無效；攻擊方向依位置而不同', () => {
    const dice = ['energy', 'energy', 'heal', 'attack', 'attack', 1] as const;
    const out = diceSummary([...dice], null);
    expect(out).toContain('2 個 ⚡ → +2 能量');
    expect(out).toContain('1 個 ❤️ → 回復 1 HP（上限內）');
    expect(out).toContain('2 個 💥 → 對東京內的怪獸造成 2 傷害');
    const inCity = diceSummary([...dice], true);
    expect(inCity).toContain('1 個 ❤️ → 在東京內，治療無效');
    expect(inCity).toContain('2 個 💥 → 對東京外的每位怪獸造成 2 傷害');
  });

  it('還沒擲骰時沒有內容', () => {
    expect(diceSummary([], null)).toEqual([]);
  });
});

describe('規則文字取自本局設定', () => {
  const text = (s: { title: string; lines: string[] }[]): string =>
    s.map((x) => x.lines.join('\n')).join('\n');

  it('勝利條件寫出本局的 VP 門檻與編號', () => {
    const t = text(endRules({ ...cfg, victoryPoints: 15 }));
    expect(t).toContain('VP ≥ 15');
    expect(t).toContain('R-END-07');
    expect(t).not.toContain('20');
  });

  it('骰子規則寫出骰子數、重擲次數與血量上限', () => {
    const t = text(diceRules({ ...cfg, diceCount: 8, maxRolls: 2, startingHp: 12 }));
    expect(t).toContain('8 顆骰子');
    expect(t).toContain('最多擲 2 次');
    expect(t).toContain('上限 12');
  });

  it('東京灣只在 5–6 人時說明', () => {
    expect(text(tokyoRules(cfg))).not.toContain('東京灣停用');
    expect(text(tokyoRules({ ...cfg, playerCount: 6 }))).toContain('東京灣停用');
  });
});
