import { describe, expect, it } from 'vitest';
import {
  diceNotesFor,
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
    }
  });
  it('在東京：提醒 ❤️ 不能補血（只有文字，不改骰面外觀）', () => {
    const h = tokyoHeartHint({ ...base, dice: [...base.dice], inTokyo: true });
    expect(h.banner).toBe('🗼 你在東京：❤️ 不能補血，不必鎖定 ❤️ 骰面');
    expect(h.keptWarn).toBeNull();
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
  it('持有治癒光束：❤️ 仍可治療別人，提醒文字改成「可治療別人」', () => {
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

describe('diceNotesFor（為什麼這回合骰子數不是基本數）', () => {
  const ctx = (diceCount: number) => ({
    diceCount,
    cardName: (id: string) => `卡-${id}`,
    nameOf: (s: number) => ['我', 'Bob', 'Cat'][s] ?? '?',
    stompCardName: (s: number) => (s === 1 ? '震地步伐' : undefined),
  });
  it('沒有任何增減：沒有說明', () => {
    expect(diceNotesFor({ base: 6, mods: [], total: 6 }, ctx(6))).toEqual([]);
  });
  it('震地步伐：指出牌名、持有者，以及何時結束', () => {
    const notes = diceNotesFor(
      { base: 6, mods: [{ kind: 'stomp', amount: -1, seats: [1] }], total: 5 },
      ctx(5),
    );
    expect(notes.map((n) => n.text)).toEqual([
      '本回合擲 5 顆骰子（基本 6 顆）',
      '震地步伐（Bob）：所有怪獸少擲 1 顆，直到Bob的下一個回合開始',
    ]);
    expect(notes[1]?.icon).toBe('🥴');
  });
  it('縮小、額外回合、加骰、多個震地持有者各一行', () => {
    const notes = diceNotesFor(
      {
        base: 6,
        mods: [
          { kind: 'extra', amount: 1, cardIds: ['xd'] },
          { kind: 'shrink', amount: -2 },
          { kind: 'stomp', amount: -2, seats: [1, 2] },
          { kind: 'extraTurn', amount: -1 },
        ],
        total: 2,
      },
      ctx(2),
    );
    expect(notes.map((n) => n.text)).toEqual([
      '本回合擲 2 顆骰子（基本 6 顆）',
      '卡-xd：多擲 1 顆',
      '縮小 ×2：少擲 2 顆',
      '震地步伐（Bob、Cat）：所有怪獸少擲 2 顆，直到Bob、Cat的下一個回合開始',
      '額外回合：少擲 1 顆',
    ]);
  });
  it('回合中途買了加骰卡（明細總和與實際骰數對不上）：不列出會誤導的加骰項目', () => {
    const notes = diceNotesFor(
      {
        base: 6,
        mods: [
          { kind: 'extra', amount: 1, cardIds: ['xd'] },
          { kind: 'stomp', amount: -1, seats: [1] },
        ],
        total: 6,
      },
      ctx(5),
    );
    expect(notes.map((n) => n.kind)).toEqual(['summary', 'stomp']);
  });
});
