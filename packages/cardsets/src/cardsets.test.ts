import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  checkInvariants,
  createGame,
  defaultConfig,
  EFFECTS,
  greedyBot,
  randomBot,
  seedToState,
} from '@kot/rules';
import type { Action, CardDef, RulesEnv } from '@kot/rules';
import {
  cleanAbility,
  defaultCardSetId,
  hashCardSet,
  importOfficialCsv,
  loadCardSets,
  nameKey,
  normalizeName,
  parseCardSet,
  parseCsv,
} from './index.js';
import type { CardSet, EffectMapping } from './index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'card-sets');
const hasLocal = existsSync(join(root, 'local', 'set.json'));

function envOf(set: CardSet): RulesEnv {
  return { cards: Object.fromEntries(set.cards.map((c) => [c.id, c])) };
}

/** 用隨機與貪心機器人把整場遊戲打完，確認每一步的不變條件。 */
function simulate(set: CardSet, games: number): { bought: Set<string>; finished: number } {
  const env = envOf(set);
  const bought = new Set<string>();
  let finished = 0;
  for (let seed = 1; seed <= games; seed += 1) {
    const players = 2 + (seed % 5);
    let { state } = createGame(defaultConfig(players), seed, env);
    let rng = seedToState(seed * 31);
    for (let step = 0; step < 8000 && state.phase !== 'over'; step += 1) {
      let action: Action;
      if (seed % 2 === 0) {
        action = greedyBot(state, env);
      } else {
        const [a, next] = randomBot(state, rng, env);
        action = a;
        rng = next;
      }
      const r = applyAction(state, action, env);
      if (!r.ok)
        throw new Error(`${set.id} seed ${String(seed)}：${JSON.stringify(action)} → ${r.error}`);
      state = r.state;
      if (action.type === 'buy') bought.add(action.cardId);
      const problems = checkInvariants(state);
      if (problems.length > 0)
        throw new Error(`${set.id} seed ${String(seed)}：${problems.join('；')}`);
    }
    if (state.phase === 'over') finished += 1;
  }
  return { bought, finished };
}

describe('原創卡組', () => {
  const sets = loadCardSets(root);
  const original = sets.get('original');

  it('載入並通過驗證', () => {
    expect(original).toBeDefined();
    expect(original?.set.cards.length).toBeGreaterThanOrEqual(60);
    expect(original?.source).toBe('original');
  });

  it('涵蓋引擎的每一種效果，且每張卡的種類與效果相符', () => {
    const used = new Set(original?.set.cards.map((c) => c.effectId));
    expect([...Object.keys(EFFECTS)].filter((id) => !used.has(id))).toEqual([]);
  });

  it('費用在合理範圍，沒有重複的名稱', () => {
    const cards = original?.set.cards ?? [];
    expect(cards.every((c) => c.cost >= 2 && c.cost <= 8)).toBe(true);
    expect(new Set(cards.map((c) => c.name)).size).toBe(cards.length);
  });

  it('機器人可以用它打完整場遊戲（2～6 人），不變條件全程成立', () => {
    const { bought, finished } = simulate(original?.set as CardSet, 20);
    expect(finished).toBe(20);
    expect(bought.size).toBeGreaterThan(15);
  }, 120_000);

  it('預設卡組：沒有自備卡表時用原創', () => {
    const only = new Map([...sets].filter(([, v]) => v.source === 'original'));
    expect(defaultCardSetId(only)).toBe('original');
  });
});

describe('內容雜湊', () => {
  const set = loadCardSets(root).get('original')?.set as CardSet;

  it('同樣內容雜湊相同，與欄位順序無關', () => {
    const reverseKeys = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(reverseKeys);
      if (v !== null && typeof v === 'object') {
        return Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .reverse()
            .map(([k, x]) => [k, reverseKeys(x)]),
        );
      }
      return v;
    };
    const reordered = reverseKeys(set) as CardSet;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(set));
    expect(hashCardSet(reordered)).toBe(hashCardSet(set));
  });

  it('任何一張卡的內容改變，雜湊就不同', () => {
    const changed: CardSet = {
      ...set,
      cards: set.cards.map((c, i) => (i === 0 ? { ...c, cost: c.cost + 1 } : c)),
    };
    expect(hashCardSet(changed)).not.toBe(hashCardSet(set));
    expect(hashCardSet(set)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('卡牌組驗證', () => {
  const base = (cards: Partial<CardDef>[]): unknown => ({
    id: 'test',
    name: 't',
    version: 1,
    cards: cards.map((c, i) => ({
      id: `c${String(i)}`,
      name: `n${String(i)}`,
      cost: 3,
      kind: 'keep',
      text: '',
      effectId: 'extra_dice',
      params: {},
      ...c,
    })),
  });
  const six = (extra: Partial<CardDef>[]) =>
    [...extra, ...Array.from({ length: 6 }, () => ({}))].slice(0, Math.max(6, extra.length));

  it('通過的最小卡組', () => {
    expect(() => parseCardSet(base(six([])))).not.toThrow();
  });

  it('未知的 effectId 會失敗，而不是被略過', () => {
    expect(() => parseCardSet(base(six([{ effectId: 'no_such_effect' }])))).toThrow(
      /未知的 effectId/,
    );
  });

  it('種類與效果不符、缺少必要參數、id 重複都會失敗', () => {
    expect(() => parseCardSet(base(six([{ kind: 'discard' }])))).toThrow(/需要 keep/);
    expect(() => parseCardSet(base(six([{ effectId: 'instant', kind: 'discard' }])))).toThrow(
      /缺少參數/,
    );
    expect(() => parseCardSet(base(six([{ id: 'dup' }, { id: 'dup' }])))).toThrow(/重複/);
  });

  it('形狀錯誤（費用、id 字元、卡太少）會失敗', () => {
    expect(() => parseCardSet(base(six([{ cost: -1 }])))).toThrow();
    expect(() => parseCardSet(base(six([{ id: 'bad id!' }])))).toThrow();
    expect(() => parseCardSet(base([{}, {}]))).toThrow(/太少/);
    expect(() => parseCardSet({ id: 'x', name: 'x', version: 1, cards: [] })).toThrow();
  });
});

describe('CSV 匯入', () => {
  it('parseCsv：引號、雙引號跳脫、欄位內換行、CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n"line1\nline2",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['line1\nline2', 'z'],
    ]);
  });

  it('cleanAbility：移除多餘引號、補括號與句點、換成符號', () => {
    expect(cleanAbility('"+ 3[Star]"').text).toBe('+ 3★');
    expect(cleanAbility('Pay 2[Energy] (or less').text).toBe('Pay 2⚡ (or less)');
    expect(cleanAbility('Deal 1 damage').text).toBe('Deal 1 damage.');
    expect(cleanAbility('Deal damage.').fixes).toEqual([]);
  });

  it('卡名正規化與雜湊 key', () => {
    expect(normalizeName("It's A (x2) Test-Card!")).toBe('itsatestcard');
    expect(nameKey('Foo Bar (x2)')).toBe(nameKey('foo-bar'));
  });

  // 測試用的假卡表（名稱與官方無關）
  const fakeMap: Record<string, EffectMapping> = {
    [nameKey('Alpha Widget')]: { effectId: 'instant', params: { ops: [{ op: 'vp', n: 3 }] } },
    [nameKey('Beta Gadget')]: { effectId: 'extra_dice', params: { n: 1 } },
    [nameKey('Gamma Gizmo')]: { effectId: 'wings', params: { cost: 2 } },
    [nameKey('Delta One')]: { effectId: 'armor', params: {} },
    [nameKey('Delta Two')]: { effectId: 'nova', params: {} },
    [nameKey('Delta Three')]: { effectId: 'forced_yield', params: {} },
  };
  const csv = [
    'Name,Cost,Type,Ability',
    'Alpha Widget,5,Discard,"""+ 3[Star]"""',
    'Beta Gadget (x2),7,Keep,You get 1 extra die',
    '',
    'Gamma Gizmo,6,Keep,"Spend 2[Energy] (to negate"',
    'Delta One,3,Keep,a',
    'Delta Two,3,Keep,b',
    'Delta Three,3,Keep,c',
  ].join('\n');

  it('展開 (xN) 為多張、修補文字、跳過空行', () => {
    const { set, fixes } = importOfficialCsv(csv, fakeMap);
    expect(set.cards.map((c) => c.id).slice(0, 4)).toEqual([
      'alpha-widget',
      'beta-gadget-1',
      'beta-gadget-2',
      'gamma-gizmo',
    ]);
    expect(set.cards[0]).toMatchObject({
      name: 'Alpha Widget',
      cost: 5,
      kind: 'discard',
      text: '+ 3★',
    });
    expect(set.cards[1]).toMatchObject({
      name: 'Beta Gadget',
      effectId: 'extra_dice',
      text: 'You get 1 extra die.',
    });
    expect(set.cards[3]?.text).toBe('Spend 2⚡ (to negate)');
    expect(fixes.length).toBeGreaterThan(0);
  });

  it('對不到效果的卡讓匯入失敗並列出卡名', () => {
    expect(() => importOfficialCsv(`${csv}\nDelta Doohickey,3,Keep,x`, fakeMap)).toThrow(
      /Delta Doohickey/,
    );
  });

  it('欄位或型別錯誤會失敗', () => {
    expect(() => importOfficialCsv('Foo,Bar\n1,2', fakeMap)).toThrow(/欄位/);
    expect(() =>
      importOfficialCsv('Name,Cost,Type,Ability\nAlpha Widget,x,Keep,y', fakeMap),
    ).toThrow(/格式/);
  });
});

describe.skipIf(!hasLocal)('使用者自備的卡表（card-sets/local，不提交；不存在時跳過）', () => {
  const loaded = loadCardSets(root).get('local');

  it('77 張、全部有效果，且是預設卡組', () => {
    expect(loaded?.set.cards).toHaveLength(77);
    expect(defaultCardSetId(loadCardSets(root))).toBe('local');
  });

  it('機器人可以用它打完整場遊戲', () => {
    const { finished } = simulate(loaded?.set as CardSet, 20);
    expect(finished).toBe(20);
  }, 120_000);
});
