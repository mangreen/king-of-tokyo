import { describe, expect, it } from 'vitest';
import {
  diceRules,
  diceSummary,
  endRules,
  tokyoHeartHint,
  tokyoRules,
  type RuleConfig,
} from './rulesText.js';

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

describe('tokyoHeartHint（在東京擲到 ❤️）', () => {
  const base = {
    dice: ['heal', 1, 'heal', 'attack', 2, 3] as const,
    kept: new Set<number>(),
    healsOthers: false,
    who: '你',
  };
  it('不在東京（或位置未知）：沒有任何提示', () => {
    for (const inTokyo of [false, null]) {
      const h = tokyoHeartHint({ ...base, dice: [...base.dice], inTokyo });
      expect(h).toMatchObject({ banner: null, keptWarn: null });
      expect(h.deadHearts.size).toBe(0);
    }
  });
  it('在東京：提醒 ❤️ 不能補血，所有 ❤️ 骰子標成無效', () => {
    const h = tokyoHeartHint({ ...base, dice: [...base.dice], inTokyo: true });
    expect(h.banner).toBe('🗼 你在東京：❤️ 不能補血，不必鎖定 ❤️ 骰面');
    expect(h.keptWarn).toBeNull();
    expect([...h.deadHearts]).toEqual([0, 2]);
  });
  it('鎖定了 ❤️ 骰面：出現警告並指出顆數；只鎖定其他骰面則沒有警告', () => {
    const warn = tokyoHeartHint({
      ...base,
      dice: [...base.dice],
      inTokyo: true,
      kept: new Set([0, 2, 4]),
    });
    expect(warn.keptWarn).toBe('已保留 2 顆 ❤️：在東京補不了血，建議放開重擲');
    const fine = tokyoHeartHint({
      ...base,
      dice: [...base.dice],
      inTokyo: true,
      kept: new Set([4]),
    });
    expect(fine.keptWarn).toBeNull();
  });
  it('持有治癒光束：❤️ 仍可治療別人，所以只提醒、不標成無效', () => {
    const h = tokyoHeartHint({
      ...base,
      dice: [...base.dice],
      inTokyo: true,
      healsOthers: true,
      kept: new Set([0]),
      who: 'Bob',
    });
    expect(h.banner).toContain('Bob在東京');
    expect(h.banner).toContain('治癒光束');
    expect(h.banner).toContain('東京內的也可以');
    expect(h.keptWarn).toContain('不能治療自己');
    expect(h.deadHearts.size).toBe(0);
  });
});

describe('diceSummary：治癒光束不受東京限制', () => {
  const dice = ['heal', 'heal', 1, 2, 3, 'attack'] as const;
  it('持有者在東京內：自己不能治療，但可以治療別的怪獸（含東京內的）', () => {
    const out = diceSummary([...dice], true, 1);
    expect(out).toContain(
      '2 個 ❤️ → 在東京內不能治療自己；可用治癒光束治療別的怪獸（東京內的也可以）',
    );
    expect(out.join('')).not.toContain('治療無效');
  });
  it('持有者在東京外：自己回復，或分給別的怪獸', () => {
    expect(diceSummary([...dice], false, 2)).toContain(
      '2 個 ❤️ → 回復 2 HP（上限內），或用治癒光束分給別的怪獸（東京內的也可以）',
    );
  });
  it('沒有可治療的對象（或沒有這張牌）：維持原本說法', () => {
    expect(diceSummary([...dice], true, 0)).toContain('2 個 ❤️ → 在東京內，治療無效');
    expect(diceSummary([...dice], false)).toContain('2 個 ❤️ → 回復 2 HP（上限內）');
  });
});
