import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@kot/rules';
import { describeImpact, impactOf, noticesFor, shopNotice, type NoticeContext } from './notices.js';

const ctx = (over: Partial<NoticeContext> = {}): NoticeContext => ({
  mySeat: 0,
  nameOf: (s) => ['我', 'Bob', 'Cat'][s] ?? `座位 ${String(s)}`,
  cardName: (id) => `卡-${id}`,
  victoryPoints: 20,
  vpNow: () => 0,
  ...over,
});
const texts = (events: GameEvent[], c = ctx()): string[] =>
  noticesFor(events, c).map((n) => n.text);

describe('noticesFor', () => {
  it('輪到自己才提示', () => {
    expect(texts([{ type: 'turn_started', seat: 0, round: 1 }])).toEqual(['輪到你了！']);
    expect(texts([{ type: 'turn_started', seat: 1, round: 1 }])).toEqual([]);
  });

  it('淘汰：自己是 danger，別人是 warn 並指出兇手', () => {
    const me = noticesFor([{ type: 'eliminated', seat: 0, by: 1 }], ctx());
    expect(me[0]?.kind).toBe('danger');
    const other = noticesFor([{ type: 'eliminated', seat: 1, by: 0 }], ctx());
    expect(other[0]).toMatchObject({ kind: 'warn', text: 'Bob 被淘汰（你幹的）' });
  });

  it('骰面攻擊：🎲 誰對東京裡／外的所有怪獸發動幾點攻擊；重擊 warn、自己是目標 danger', () => {
    const smash = (
      attacker: number,
      damage: number,
      targets: number[],
      zone?: 'tokyo' | 'outside' | 'all',
    ): GameEvent => ({ type: 'smash', attacker, damage, targets, ...(zone ? { zone } : {}) });
    expect(noticesFor([smash(1, 3, [2], 'tokyo')], ctx())[0]).toMatchObject({
      kind: 'info',
      icon: '🎲',
      text: 'Bob對東京裡的所有怪獸發動了 3 點攻擊💥',
    });
    expect(noticesFor([smash(0, 2, [1, 2], 'outside')], ctx())[0]).toMatchObject({
      text: '你對東京外的所有怪獸發動了 2 點攻擊💥',
    });
    expect(noticesFor([smash(1, 2, [0, 2], 'all')], ctx())[0]?.text).toBe(
      'Bob對所有其他怪獸發動了 2 點攻擊💥，你是目標！',
    );
    expect(noticesFor([smash(1, 5, [2], 'tokyo')], ctx())[0]).toMatchObject({
      kind: 'warn',
      text: 'Bob對東京裡的所有怪獸發動了 5 點重擊💥',
    });
    expect(noticesFor([smash(1, 5, [0], 'tokyo')], ctx())[0]).toMatchObject({
      kind: 'danger',
      text: 'Bob對東京裡的所有怪獸發動了 5 點重擊💥，你是目標！',
    });
    // 舊紀錄沒有 zone：改列出目標名字
    expect(noticesFor([smash(1, 2, [0, 2])], ctx())[0]?.text).toBe(
      'Bob對你、Cat發動了 2 點攻擊💥，你是目標！',
    );
  });

  it('骰子的補血、得分、能量：🎲 誰得到多少（不分敵我）', () => {
    const t = noticesFor(
      [
        { type: 'vp_gained', seat: 1, amount: 3, reason: 'dice' },
        { type: 'energy_gained', seat: 1, amount: 2, source: 'dice' },
        { type: 'healed', seat: 0, amount: 2, source: 'dice' },
        { type: 'heal_ignored', seat: 2, faces: 2 },
      ],
      ctx(),
    );
    expect(t.map((n) => [n.icon, n.text])).toEqual([
      ['🎲', 'Bob得到 3 ⭐'],
      ['🎲', 'Bob得到 2 ⚡'],
      ['🎲', '你補了 2 ♥️'],
      ['🎲', 'Cat擲出 2 個 ♥️，但在東京裡不能補血'],
    ]);
  });

  it('卡牌造成的得分／能量／補血不當成骰子：沒有 🎲，只出現在 🃏 卡牌提示裡', () => {
    const n = noticesFor(
      [
        { type: 'card_used', seat: 1, cardId: 'x' },
        { type: 'vp_gained', seat: 1, amount: 4, reason: 'card' },
        { type: 'energy_gained', seat: 1, amount: 1, source: 'card' },
        { type: 'healed', seat: 1, amount: 2, source: 'card' },
      ],
      ctx(),
    );
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ icon: '🃏' });
    expect(n[0]?.text).toContain('⭐ +4');
    expect(n[0]?.text).toContain('⚡ +1');
    expect(n[0]?.text).toContain('HP +2');
  });

  it('被動卡發動在骰子結算中：骰子的能量算 🎲、不算進卡牌的影響', () => {
    const n = noticesFor(
      [
        { type: 'card_triggered', seat: 1, cardId: 'bonus' },
        { type: 'energy_gained', seat: 1, amount: 3, source: 'dice' },
      ],
      ctx({ cardText: () => '每次得到能量多 +1' }),
    );
    expect(n.map((x) => [x.icon, x.text])).toEqual([
      ['🃏', 'Bob的【卡-bonus】發動了：每次得到能量多 +1'],
      ['🎲', 'Bob得到 3 ⚡'],
    ]);
  });

  it('只有自己血量見底（≤3 且還活著）才警告', () => {
    const hurt = (seat: number, hp: number): GameEvent => ({
      type: 'damage_taken',
      seat,
      amount: 2,
      hp,
      source: 1,
    });
    expect(texts([hurt(0, 3)])).toEqual(['你的 HP 只剩 3！']);
    expect(texts([hurt(0, 4)])).toEqual([]);
    expect(texts([hurt(0, 0)])).toEqual([]);
    expect(texts([hurt(1, 1)])).toEqual([]);
  });

  it('VP：跨過「差 5 分」與「達標」門檻時各提示一次', () => {
    const gain = (amount: number): GameEvent => ({
      type: 'vp_gained',
      seat: 1,
      amount,
      reason: 'dice',
    });
    expect(texts([gain(2)], ctx({ vpNow: () => 14 }))).toEqual(['Bob得到 2 ⭐']);
    expect(texts([gain(2)], ctx({ vpNow: () => 16 }))).toEqual([
      'Bob得到 2 ⭐',
      'Bob離勝利只差 4 VP',
    ]);
    expect(texts([gain(1)], ctx({ vpNow: () => 17 }))).toEqual(['Bob得到 1 ⭐']);
    expect(texts([gain(3)], ctx({ vpNow: () => 21 }))).toEqual([
      'Bob得到 3 ⭐',
      'Bob 達到 20 VP！',
    ]);
    const mine = noticesFor(
      [{ type: 'vp_gained', seat: 0, amount: 2, reason: 'card' }],
      ctx({ vpNow: () => 20 }),
    );
    expect(mine[0]).toMatchObject({ kind: 'good', icon: '🏁' });
    // 骰子得分：先是 🎲 得分提示，再接門檻提示
    expect(noticesFor([gain(3)], ctx({ vpNow: () => 21 })).map((n) => n.icon)).toEqual([
      '🎲',
      '🏁',
    ]);
  });

  it('買牌、進入東京、自己中毒、額外回合、東京灣關閉都會提示', () => {
    const t = texts([
      { type: 'entered_tokyo', seat: 0, location: 'city' },
      { type: 'counter_gained', seat: 0, counter: 'poison', total: 1 },
      { type: 'counter_gained', seat: 1, counter: 'poison', total: 1 },
      { type: 'extra_turn_granted', seat: 1 },
      { type: 'bay_closed', seat: 2, movedTo: null },
      { type: 'card_bought', seat: 1, cardId: 'x', cost: 3, from: null },
    ]);
    expect(t).toEqual([
      '你進入東京市',
      '你中毒了',
      'Bob將再進行一個回合',
      '東京灣關閉了',
      'Bob購買了【卡-x】',
    ]);
  });

  it('買牌向別人買時標明對象；單純擲骰、非骰面來源的補血／能量不打擾', () => {
    expect(
      noticesFor([{ type: 'card_bought', seat: 1, cardId: 'x', cost: 3, from: 2 }], ctx())[0],
    ).toMatchObject({ icon: '🃏', text: 'Bob購買了【卡-x】（向Cat）' });
    expect(
      texts([
        { type: 'dice_rolled', seat: 0, rollNumber: 1, dice: [1, 2, 3], rerolled: [] },
        { type: 'healed', seat: 0, amount: 1 },
        { type: 'energy_gained', seat: 0, amount: 2 },
        { type: 'energy_gained', seat: 0, amount: 2, source: 'transfer' },
      ]),
    ).toEqual([]);
  });
});

describe('買下立刻生效的牌：購買提示之外再跳效果提示', () => {
  const bought = (cardId = 'meteor'): GameEvent => ({
    type: 'card_bought',
    seat: 0,
    cardId,
    cost: 3,
    from: null,
  });

  it('一次性牌（例如流星雨）：先是購買，再是對所有人的實際效果', () => {
    const ns = noticesFor(
      [
        { type: 'energy_spent', seat: 0, amount: 3 },
        bought(),
        { type: 'vp_gained', seat: 0, amount: 2, reason: 'card' },
        { type: 'card_discarded', seat: null, cardId: 'meteor', reason: 'instant' },
        { type: 'damage_taken', seat: 0, amount: 2, hp: 8, source: 0, cause: 'card' },
        { type: 'damage_taken', seat: 1, amount: 2, hp: 8, source: 0, cause: 'card' },
      ],
      ctx(),
    );
    expect(ns.map((n) => n.text)).toEqual([
      '你購買了【卡-meteor】',
      '【卡-meteor】生效：你 HP -2、⭐ +2；Bob HP -2',
    ]);
    expect(ns.every((n) => n.icon === '🃏')).toBe(true);
  });

  it('一次性牌沒有可量化的影響：用卡面文字說明；持續牌沒有立即效果就不多跳', () => {
    const c = ctx({
      cardText: (id) => `${id} 的卡面文字`,
      cardKind: (id) => (id === 'meteor' ? 'discard' : 'keep'),
    });
    expect(texts([bought()], c)).toEqual([
      '你購買了【卡-meteor】',
      '【卡-meteor】生效：meteor 的卡面文字',
    ]);
    expect(texts([bought('armor')], c)).toEqual(['你購買了【卡-armor】']);
  });

  it('持續牌買下就有效果（最大 HP＋2）：也會說明', () => {
    expect(
      texts([
        bought('arm'),
        { type: 'max_hp_changed', seat: 0, maxHp: 12 },
        { type: 'healed', seat: 0, amount: 2 },
      ]),
    ).toEqual(['你購買了【卡-arm】', '【卡-arm】生效：你的最大 HP 變成 12；你 HP +2']);
  });

  it('買下就進東京：只有牌的效果提示，不再重複「進入東京」', () => {
    expect(texts([bought(), { type: 'entered_tokyo', seat: 0, location: 'city' }])).toEqual([
      '你購買了【卡-meteor】',
      '【卡-meteor】生效：你進入東京市',
    ]);
  });

  it('下一次買牌是邊界：兩張牌的效果不會混在一起', () => {
    expect(
      texts([
        bought('a'),
        { type: 'vp_gained', seat: 0, amount: 1, reason: 'card' },
        bought('b'),
        { type: 'vp_gained', seat: 0, amount: 3, reason: 'card' },
      ]),
    ).toEqual([
      '你購買了【卡-a】',
      '【卡-a】生效：你 ⭐ +1',
      '你購買了【卡-b】',
      '【卡-b】生效：你 ⭐ +3',
    ]);
  });
});

describe('只在事件日誌出現的卡牌事件（稽核補上的提示）', () => {
  it('先知偷看牌庫頂：用牌提示＋🔮 讓使用者讀到那張牌（費用、卡面文字），並且停留久一點', () => {
    const c = ctx({
      cardText: (id) => `${id} 的卡面文字`,
      cardCost: () => 3,
    });
    const ns = noticesFor(
      [
        { type: 'card_used', seat: 0, cardId: 'lab' },
        { type: 'deck_peeked', seat: 0, cardId: 'grid' },
      ],
      c,
    );
    expect(ns.map((n) => n.text)).toEqual([
      '你使用了【卡-lab】：你偷看了牌庫頂的一張牌',
      '你偷看到牌庫頂：【卡-grid】⚡3 — grid 的卡面文字',
    ]);
    expect(ns[1]).toMatchObject({ icon: '🔮', hold: true });
    expect(ns[0]?.hold).toBeUndefined();
  });

  it('別人偷看（看不到內容）：只有用牌提示，不會洩漏也不會多跳', () => {
    const ns = noticesFor(
      [
        { type: 'card_used', seat: 1, cardId: 'lab' },
        { type: 'deck_peeked', seat: 1, cardId: null },
      ],
      ctx(),
    );
    expect(ns.map((n) => n.text)).toEqual(['Bob使用了【卡-lab】：Bob偷看了牌庫頂的一張牌']);
  });

  it('改骰：卡牌提示說明改了哪一顆；讓位換卡說明換了哪兩張', () => {
    expect(
      texts([
        { type: 'card_used', seat: 0, cardId: 'twist' },
        { type: 'die_changed', seat: 0, index: 5, face: 3 },
      ]),
    ).toEqual(['你使用了【卡-twist】：你把第 6 顆骰子改成 3']);
    expect(
      texts([
        { type: 'card_triggered', seat: 1, cardId: 'dna' },
        { type: 'card_swapped', seat: 1, gave: 'dna', took: 'k', from: 2 },
      ]),
    ).toEqual(['Bob的【卡-dna】發動了：Bob用【卡-dna】換走Cat的【卡-k】']);
  });

  it('解除指示物、清掉商店、卡用完被棄掉都有提示；其他棄牌原因不打擾', () => {
    expect(texts([{ type: 'counter_removed', seat: 0, counter: 'poison', total: 0 }])).toEqual([
      '你用 ❤️ 解除了☠ 中毒指示物',
    ]);
    expect(texts([{ type: 'counter_removed', seat: 1, counter: 'shrink', total: 1 }])).toEqual([
      'Bob用 ❤️ 解除了🤏 縮小指示物（還剩 1 個）',
    ]);
    expect(texts([{ type: 'market_swept', seat: 1, discarded: ['a'] }])).toEqual([
      'Bob花 2 能量清掉了商店',
    ]);
    expect(texts([{ type: 'card_discarded', seat: 1, cardId: 'cells', reason: 'spent' }])).toEqual([
      'Bob的【卡-cells】用完了，已棄掉',
    ]);
    expect(
      texts([
        { type: 'card_discarded', seat: 1, cardId: 'x', reason: 'eliminated' },
        { type: 'card_discarded', seat: null, cardId: 'x', reason: 'instant' },
      ]),
    ).toEqual([]);
  });
});

describe('shopNotice', () => {
  it('買得起才提示，且帶有前往商店的動作', () => {
    expect(shopNotice(0)).toBeNull();
    expect(shopNotice(2)).toMatchObject({ text: '商店有 2 張牌買得起', action: 'shop' });
  });
});

describe('卡牌使用提示', () => {
  const used = (seat: number): GameEvent => ({ type: 'card_used', seat, cardId: 'quake' });
  const hit = (seat: number, amount: number): GameEvent => ({
    type: 'damage_taken',
    seat,
    amount,
    hp: 5,
    source: 1,
    cause: 'card',
  });

  it('別人用牌波及自己：寫出誰、哪張牌、對所有人的影響，且是 danger', () => {
    const n = noticesFor([used(1), hit(0, 3), hit(2, 3)], ctx());
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      kind: 'danger',
      icon: '🃏',
      text: 'Bob使用了【卡-quake】：你 HP -3；Cat HP -3',
    });
  });

  it('別人用牌沒波及自己：仍寫出誰、哪張牌、影響了誰（不是 danger）', () => {
    const n = noticesFor([used(1), hit(2, 3)], ctx());
    expect(n[0]).toMatchObject({ kind: 'info', text: 'Bob使用了【卡-quake】：Cat HP -3' });
  });

  it('煙霧彈：沒有任何人受傷也提示誰用了牌、多了擲骰機會', () => {
    const smoke: GameEvent[] = [
      { type: 'card_used', seat: 1, cardId: 'smoke' },
      { type: 'rolls_added', seat: 1, cardId: 'smoke', amount: 1, left: 2 },
    ];
    expect(noticesFor(smoke, ctx())[0]).toMatchObject({
      kind: 'info',
      text: 'Bob使用了【卡-smoke】：Bob本回合多 1 次擲骰機會（卡上剩 2 次）',
    });
    expect(texts(smoke.map((e) => ('seat' in e ? { ...e, seat: 0 } : e)))[0]).toBe(
      '你使用了【卡-smoke】：你本回合多 1 次擲骰機會（卡上剩 2 次）',
    );
  });

  it('改骰、額外回合等非數字效果也會寫出來，且不重複跳提示', () => {
    const n = noticesFor(
      [
        { type: 'card_used', seat: 2, cardId: 'x' },
        { type: 'die_changed', seat: 2, index: 0, face: 'attack' },
        { type: 'extra_turn_granted', seat: 2 },
      ],
      ctx(),
    );
    expect(n).toHaveLength(1);
    expect(n[0]?.text).toBe(
      'Cat使用了【卡-x】：Cat把第 1 顆骰子改成 💥；Cat回合結束後會再進行一個回合',
    );
  });

  it('被動卡發動：寫出誰的哪張牌發動、造成什麼；沒有可量化的影響就寫卡面文字', () => {
    const passive: GameEvent[] = [
      { type: 'card_triggered', seat: 1, cardId: 'p' },
      { type: 'vp_gained', seat: 1, amount: 2, reason: 'card' as never },
    ];
    expect(noticesFor(passive, ctx())[0]?.text).toBe('Bob的【卡-p】發動了：Bob ⭐ +2');
    const bare = noticesFor(
      [{ type: 'card_triggered', seat: 1, cardId: 'p' }],
      ctx({ cardText: () => '你攻擊時多造成 1 點傷害。' }),
    );
    expect(bare[0]?.text).toBe('Bob的【卡-p】發動了：你攻擊時多造成 1 點傷害。');
  });

  it('自己用牌：列出自己的收穫', () => {
    const n = noticesFor(
      [
        used(0),
        { type: 'healed', seat: 0, amount: 2 },
        { type: 'vp_gained', seat: 0, amount: 1, reason: 'card' as never },
        { type: 'energy_spent', seat: 0, amount: 1 },
        { type: 'healed', seat: 1, amount: 9 },
      ],
      ctx(),
    );
    expect(n[0]).toMatchObject({
      kind: 'good',
      text: '你使用了【卡-quake】：你 HP +2、⭐ +1、⚡ -1；Bob HP +9',
    });
  });

  it('自己用牌且只有好處：good；沒有任何變化：只寫用了什麼', () => {
    expect(
      noticesFor([used(0), { type: 'energy_gained', seat: 0, amount: 9 }], ctx())[0]?.kind,
    ).toBe('good');
    expect(noticesFor([used(0)], ctx())[0]?.text).toBe('你使用了【卡-quake】');
    expect(noticesFor([used(0)], ctx({ cardText: () => '說明' }))[0]?.text).toBe(
      '你使用了【卡-quake】：說明',
    );
  });

  it('影響只算到下一張牌／回合邊界／骰面攻擊之前', () => {
    const events: GameEvent[] = [
      used(1),
      hit(0, 1),
      { type: 'smash', attacker: 1, damage: 2, targets: [0] },
      hit(0, 2),
    ];
    expect(impactOf(events, 0, 0)).toMatchObject({ hp: -1 });
    expect(impactOf([used(1), used(2), hit(0, 5)], 0, 0).hp).toBe(0);
    expect(impactOf(events, 0, null)).toEqual({ hp: 0, vp: 0, energy: 0, eliminated: false });
  });

  it('被這張牌淘汰也會寫出來', () => {
    const n = noticesFor([used(1), hit(0, 9), { type: 'eliminated', seat: 0, by: 1 }], ctx());
    expect(n.map((x) => x.text)).toContain('Bob使用了【卡-quake】：你 HP -9、被淘汰');
    expect(describeImpact({ hp: 0, vp: 0, energy: 0, eliminated: false })).toBe('');
  });
});

describe('震地步伐的觸發提示', () => {
  it('說出持有者、效果持續到何時', () => {
    const t = texts([
      { type: 'card_triggered', seat: 1, cardId: 'quake' },
      { type: 'dice_penalty', seats: [1] },
    ]);
    expect(t.join('|')).toContain('所有怪獸少擲 1 顆骰子，直到Bob的下一個回合開始');
  });
});
