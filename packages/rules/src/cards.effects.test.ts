import { describe, expect, it } from 'vitest';
import { applyAction } from './engine.js';
import { checkInvariants } from './invariants.js';
import type { CardDef } from './cards/types.js';
import { card, makeEnv, makeState, mon, must, resolveWith, yieldQueue } from './test-utils.js';
import { cloneState } from './state.js';
import type { GameState } from './types.js';
import type { Face, Monster } from './types.js';

const A: Face = 'attack';
const E: Face = 'energy';
const H: Face = 'heal';

function ins(cost: number, ...ops: object[]): CardDef {
  return card(`ins${String(cost)}${JSON.stringify(ops).length}`, 'instant', {
    cost,
    params: { ops: ops as never },
  });
}

type Monsters = Record<number, Partial<Monster>>;

/** 用一組卡建立狀態；cards 的 id 即是 effectId（除非另外指定）。 */
function world(defs: CardDef[], players: number, monsters: Monsters, faceUp: string[] = []) {
  const env = makeEnv(...defs);
  const state = makeState({ players, env, faceUp, deck: [], monsters });
  return { env, state };
}

function buyPhase(state: GameState): GameState {
  const s = cloneState(state);
  s.phase = 'buy';
  return s;
}

function check(state: GameState): void {
  expect(checkInvariants(state)).toEqual([]);
}

// ── Discard 卡 ───────────────────────────────────────────

describe('R-CARD-15 Discard 卡的即時效果（instant）', () => {
  const buy = (def: CardDef, players: number, monsters: Monsters) => {
    const { env, state } = world([def], players, monsters, [def.id]);
    return must(buyPhase(state), { type: 'buy', seat: 0, cardId: def.id }, env);
  };

  it('vp／energy 得到資源', () => {
    const r = buy(ins(3, { op: 'vp', n: 4 }, { op: 'energy', n: 9 }), 3, { 0: { energy: 10 } });
    expect(mon(r.state, 0)).toMatchObject({ vp: 4, energy: 16 });
  });

  it('heal：在東京內也能用卡治療，且不超過上限', () => {
    const r = buy(ins(3, { op: 'heal', n: 5 }), 3, { 0: { energy: 5, hp: 7, location: 'city' } });
    expect(mon(r.state, 0).hp).toBe(10);
  });

  it('selfDamage 可以淘汰自己；沒有來源，也不是攻擊', () => {
    const r = buy(ins(3, { op: 'selfDamage', n: 4 }), 3, { 0: { energy: 5, hp: 3 } });
    expect(mon(r.state, 0).alive).toBe(false);
    expect(r.events).toContainEqual({ type: 'eliminated', seat: 0, by: null });
    expect(r.state.turn.seat).toBe(1); // 買家死了，直接換下一位
    check(r.state);
  });

  it('damageOthers／damageAll', () => {
    const others = buy(ins(3, { op: 'damageOthers', n: 2 }), 3, { 0: { energy: 5 } });
    expect([0, 1, 2].map((s) => mon(others.state, s).hp)).toEqual([10, 8, 8]);
    const all = buy(ins(3, { op: 'damageAll', n: 3 }), 3, { 0: { energy: 5 } });
    expect([0, 1, 2].map((s) => mon(all.state, s).hp)).toEqual([7, 7, 7]);
    expect(all.events).toContainEqual({
      type: 'damage_taken',
      seat: 1,
      amount: 3,
      hp: 7,
      source: 0,
      cause: 'card',
    });
  });

  it('卡牌傷害不是攻擊：東京內的怪獸不被詢問讓位，被淘汰也沒人接手東京', () => {
    const r = buy(ins(3, { op: 'damageOthers', n: 5 }), 3, {
      0: { energy: 5 },
      1: { location: 'city', hp: 4 },
    });
    expect(mon(r.state, 1).alive).toBe(false);
    expect(r.state.monsters.some((m) => m.location === 'city')).toBe(false);
    expect(r.state.pending).toBeNull();
  });

  it('othersLoseVp 與 othersLoseEnergyPer', () => {
    const r = buy(ins(3, { op: 'othersLoseVp', n: 5 }, { op: 'othersLoseEnergyPer', per: 2 }), 3, {
      0: { energy: 9, vp: 1 },
      1: { vp: 7, energy: 5 },
      2: { vp: 3, energy: 1 },
    });
    expect(mon(r.state, 1)).toMatchObject({ vp: 2, energy: 3 });
    expect(mon(r.state, 2)).toMatchObject({ vp: 0, energy: 1 });
    expect(mon(r.state, 0).vp).toBe(1);
  });

  it('takeTokyo：原佔領者被迫離開，買家進入東京市並 +1 VP；已在東京則無事', () => {
    const r = buy(ins(3, { op: 'takeTokyo' }, { op: 'vp', n: 2 }), 3, {
      0: { energy: 5 },
      1: { location: 'city' },
    });
    expect(mon(r.state, 0)).toMatchObject({ location: 'city', vp: 3 });
    expect(mon(r.state, 1).location).toBeNull();
    const again = buy(ins(3, { op: 'takeTokyo' }), 3, { 0: { energy: 5, location: 'bay' } });
    expect(mon(again.state, 0).location).toBe('bay');
  });

  it('extraTurn：回合結束後同一位再開一回合（不推進一輪，R-END-09）', () => {
    const r = buy(ins(3, { op: 'extraTurn' }), 3, { 0: { energy: 5 } });
    const end = must(r.state, { type: 'endTurn', seat: 0 }, makeEnv(ins(3, { op: 'extraTurn' })));
    expect(end.state.turn.seat).toBe(0);
    expect(end.state.round).toBe(1);
    expect(end.events.filter((e) => e.type === 'turn_started')).toHaveLength(1);
    expect(end.events.some((e) => e.type === 'round_ended')).toBe(false);
  });

  it('perCard：每張持有的 Keep 卡 +VP 並受傷', () => {
    const def = ins(2, { op: 'perCard', vp: 1, damage: 1 });
    const keep = [card('k1', 'reroll_threes'), card('k2', 'reroll_threes')];
    const env = makeEnv(def, ...keep);
    const state = makeState({
      players: 3,
      env,
      faceUp: [def.id],
      monsters: { 0: { energy: 5, cards: ['k1', 'k2'] } },
    });
    const r = must(buyPhase(state), { type: 'buy', seat: 0, cardId: def.id }, env);
    expect(mon(r.state, 0)).toMatchObject({ vp: 2, hp: 8 });
  });
});

// ── 靜態修正 ─────────────────────────────────────────────

describe('R-CARD-21 骰子與擲骰次數', () => {
  it('加骰卡：下一回合多擲一顆', () => {
    const { env, state } = world([card('xd', 'extra_dice')], 3, { 1: { cards: ['xd'] } });
    const r = must(buyPhase(state), { type: 'endTurn', seat: 0 }, env);
    expect(r.state.turn).toMatchObject({ seat: 1, diceCount: 7 });
    const rolled = must(r.state, { type: 'roll', seat: 1, keep: [] }, env);
    expect(rolled.state.turn.dice).toHaveLength(7);
  });

  it('Shrink 指示物每個少擲一顆，最少 1 顆', () => {
    const { env, state } = world([], 3, {
      1: { tokens: { poison: 0, shrink: 2 } },
      2: { tokens: { poison: 0, shrink: 9 } },
    });
    const r = must(buyPhase(state), { type: 'endTurn', seat: 0 }, env);
    expect(r.state.turn.diceCount).toBe(4);
    const r2 = must(buyPhase(r.state), { type: 'endTurn', seat: 1 }, env);
    expect(r2.state.turn.diceCount).toBe(1);
  });

  it('加擲卡：第 3 次擲完不會自動結算，可以擲第 4 次，之後自動結算', () => {
    const { env, state } = world([card('gb', 'extra_rolls')], 3, { 0: { cards: ['gb'] } });
    let s = state;
    s = must(s, { type: 'roll', seat: 0, keep: [] }, env).state;
    s = must(s, { type: 'roll', seat: 0, keep: [0] }, env).state;
    s = must(s, { type: 'roll', seat: 0, keep: [0] }, env).state;
    expect(s.phase).toBe('roll');
    expect(s.turn.rollsUsed).toBe(3);
    s = must(s, { type: 'roll', seat: 0, keep: [0] }, env).state;
    expect(s.phase).not.toBe('roll'); // 自動結算（進入買牌階段或讓位詢問）
  });

  it('沒有加擲卡時第 4 次擲被拒絕（M1 行為不變）', () => {
    const { env, state } = world([], 3, {});
    const s = {
      ...state,
      turn: { ...state.turn, rollsUsed: 3, dice: [1, 2, 3, 1, 2, 3] as Face[] },
    };
    expect(applyAction(s, { type: 'roll', seat: 0, keep: [0] }, env)).toEqual({
      ok: false,
      error: 'no_rolls_left',
    });
  });
});

describe('R-CARD-14 費用與其他修正', () => {
  it('費用減免，最低 0', () => {
    const defs = [
      card('disc', 'cost_discount', { params: { n: 1 } }),
      card('c4', 'instant', { cost: 4, params: { ops: [] } }),
      card('c1', 'instant', { cost: 1, params: { ops: [] } }),
    ];
    const { env, state } = world(defs, 3, { 0: { cards: ['disc'], energy: 3 } }, ['c4', 'c1']);
    let r = must(buyPhase(state), { type: 'buy', seat: 0, cardId: 'c4' }, env);
    expect(mon(r.state, 0).energy).toBe(0);
    r = must(buyPhase(state), { type: 'buy', seat: 0, cardId: 'c1' }, env);
    expect(mon(r.state, 0).energy).toBe(3);
  });

  it('額外能量：只對骰面與卡牌得到的能量生效（OQ-C8）', () => {
    const { env, state } = world([card('fc', 'energy_bonus')], 3, { 0: { cards: ['fc'] } });
    const r = resolveWith(state, [E, E, 1, 2, H, H], env);
    expect(mon(r.state, 0).energy).toBe(3);
  });

  it('額外治療：每次治療多 1；在東京內骰面治療仍無效', () => {
    const { env, state } = world([card('rg', 'heal_bonus')], 3, { 0: { cards: ['rg'], hp: 4 } });
    const r = resolveWith(state, [H, H, 1, 2, 3, 3], env);
    expect(mon(r.state, 0).hp).toBe(7);
    const inTokyo = world([card('rg', 'heal_bonus')], 3, {
      0: { cards: ['rg'], hp: 4, location: 'city' },
    });
    const r2 = resolveWith(inTokyo.state, [H, H, 1, 2, 3, 3], inTokyo.env);
    expect(mon(r2.state, 0).hp).toBe(4);
  });

  it('最大 HP：買下時上限 +n 並回復 n；失去時 HP 夾到新上限（OQ-C7）', () => {
    const defs = [card('eb', 'max_hp', { params: { n: 2 } }), card('mm', 'metamorph')];
    const { env, state } = world(defs, 3, { 0: { energy: 10 } }, ['eb']);
    let s = must(buyPhase(state), { type: 'buy', seat: 0, cardId: 'eb' }, env).state;
    expect(mon(s, 0)).toMatchObject({ maxHp: 12, hp: 12 });
    s = {
      ...s,
      monsters: s.monsters.map((m) =>
        m.seat === 0
          ? {
              ...m,
              cards: [...m.cards, 'mm'],
              cardData: { ...m.cardData, mm: { n: 0, ref: null } },
            }
          : m,
      ),
    };
    s = must(s, { type: 'useCard', seat: 0, cardId: 'mm', args: { cards: ['eb'] } }, env).state;
    expect(mon(s, 0)).toMatchObject({ maxHp: 10, hp: 10 });
    check(s);
  });
});

// ── 攻擊修正 ─────────────────────────────────────────────

/** seat 0 在東京外攻擊，seat 1 在東京市，其餘在東京外。 */
function duel(defs: CardDef[], monsters: Monsters = {}, players = 3) {
  return world(defs, players, { ...monsters, 1: { location: 'city', ...monsters[1] } });
}

const hpOf = (s: GameState, seat: number): number => mon(s, seat).hp;

describe('R-CARD-31 加傷', () => {
  it('每次攻擊 +n：只在有攻擊時生效', () => {
    const { env, state } = duel([card('st', 'attack_bonus', { params: { n: 1 } })], {
      0: { cards: ['st'] },
    });
    expect(hpOf(resolveWith(state, [A, 1, 2, 3, H, H], env).state, 1)).toBe(8);
    const none = resolveWith(state, [1, 2, 3, H, H, H], env);
    expect(hpOf(none.state, 1)).toBe(10);
    expect(none.events.some((e) => e.type === 'smash')).toBe(false);
  });

  it('「每回合固定加傷」沒有攻擊面時不是攻擊：照常受傷，但不能讓位、沒有攻擊事件（OQ-C6）', () => {
    const { env, state } = duel(
      [card('acid', 'attack_bonus', { params: { n: 1, always: true } })],
      { 0: { cards: ['acid'] } },
    );
    const r = resolveWith(state, [1, 2, 3, H, H, H], env);
    expect(hpOf(r.state, 1)).toBe(9);
    expect(yieldQueue(r.state)).toEqual([]);
    expect(r.events.some((e) => e.type === 'smash' || e.type === 'yield_requested')).toBe(false);
  });

  it('有攻擊面時，固定加傷併入這次攻擊，仍可讓位（OQ-C6）', () => {
    const { env, state } = duel(
      [card('acid', 'attack_bonus', { params: { n: 1, always: true } })],
      { 0: { cards: ['acid'] } },
    );
    const r = resolveWith(state, [A, 2, 3, H, H, H], env);
    expect(hpOf(r.state, 1)).toBe(8);
    expect(yieldQueue(r.state)).toEqual([1]);
  });

  it('湊成指定三顆時加傷；湊成時加 VP', () => {
    const q = card('q', 'triple_bonus', { params: { face: 2, damage: 2 } });
    const g = card('g', 'triple_bonus', { params: { face: 1, vp: 2 } });
    const { env, state } = duel([q, g], { 0: { cards: ['q', 'g'] } });
    const r = resolveWith(state, [2, 2, 2, H, H, 3], env);
    expect(hpOf(r.state, 1)).toBe(8);
    expect(mon(r.state, 0).vp).toBe(2); // 三個 2 = 2 VP（進入東京要等讓位決定之後）
    const r2 = resolveWith(state, [1, 1, 1, H, H, 3], env);
    expect(mon(r2.state, 0).vp).toBe(1 + 2 + 0);
  });

  it('對東京加傷與讓位傷害', () => {
    const t = card('bu', 'tokyo_target_bonus', { params: { n: 1, yieldDamage: 1 } });
    const { env, state } = duel([t], { 0: { cards: ['bu'] }, 1: { cards: ['bu'] } });
    const r = resolveWith(state, [A, 1, 2, 3, H, H], env);
    expect(hpOf(r.state, 1)).toBe(8);
    const y = must(r.state, { type: 'yieldDecision', seat: 1, leave: true }, env);
    expect(y.events).toContainEqual({
      type: 'damage_taken',
      seat: 0,
      amount: 1,
      hp: 9,
      source: 1,
      cause: 'yield',
    });
  });

  it('在東京內攻擊的加成：回合開始 +VP、攻擊 +傷害', () => {
    const u = card('ub', 'tokyo_attacker');
    const { env, state } = world([u], 3, { 0: { cards: ['ub'], location: 'city' } });
    const r = resolveWith(state, [A, 1, 2, 3, H, H], env);
    expect(hpOf(r.state, 1)).toBe(8);
    const start = must(
      buyPhase({ ...state, turn: { ...state.turn, seat: 2 } }),
      { type: 'endTurn', seat: 2 },
      env,
    );
    expect(start.state.turn.seat).toBe(0);
    expect(mon(start.state, 0).vp).toBe(3); // 在東京 +2，卡牌 +1
  });

  it('鄰座額外傷害（鄰座加傷類）：目標加傷，非目標的鄰座也受傷，且不是攻擊', () => {
    const f = card('fb', 'neighbor_damage');
    const { env, state } = duel([f], { 0: { cards: ['fb'] } }, 4);
    const r = resolveWith(state, [A, 1, 2, 3, H, H], env);
    expect(hpOf(r.state, 1)).toBe(8); // 目標且是鄰座：1 + 1
    expect(hpOf(r.state, 3)).toBe(9); // 非目標的鄰座
    expect(hpOf(r.state, 2)).toBe(10);
    expect(r.events).toContainEqual({
      type: 'damage_taken',
      seat: 3,
      amount: 1,
      hp: 9,
      source: 0,
      cause: 'extra',
    });
  });

  it('Nova 類：傷害所有其他怪獸', () => {
    const { env, state } = duel([card('nv', 'nova')], { 0: { cards: ['nv'] } });
    const r = resolveWith(state, [A, A, 1, 2, H, H], env);
    expect([1, 2].map((s) => hpOf(r.state, s))).toEqual([8, 8]);
  });

  it('攻擊時得 VP（Alpha 類）：有目標才算', () => {
    const { env, state } = duel([card('al', 'attack_vp', { params: { vp: 1 } })], {
      0: { cards: ['al'] },
    });
    const r = resolveWith(state, [A, 1, 2, 3, H, H], env);
    expect(mon(r.state, 0).vp).toBe(1);
    const nobody = world([card('al', 'attack_vp', { params: { vp: 1 } })], 3, {
      0: { cards: ['al'] },
    });
    const r2 = resolveWith(nobody.state, [A, 1, 2, 3, H, H], nobody.env);
    expect(mon(r2.state, 0).vp).toBe(1); // 沒有目標：只有進入東京的 1 VP
  });

  it('強制讓位（Intimidating Roar 類）：被傷到的東京怪獸直接讓位，攻擊者進入東京', () => {
    const { env, state } = duel([card('ro', 'forced_yield')], { 0: { cards: ['ro'] } });
    const r = resolveWith(state, [A, 1, 2, 3, H, H], env);
    expect(r.state.pending).toBeNull();
    expect(r.events).toContainEqual({ type: 'yielded', seat: 1, location: 'city' });
    expect(mon(r.state, 0).location).toBe('city');
  });

  it('加害後：吸血與指示物', () => {
    const defs = [
      card('ca', 'lifesteal'),
      card('ps', 'counter_attack', { params: { counter: 'poison' } }),
      card('sr', 'counter_attack', { params: { counter: 'shrink' } }),
    ];
    const { env, state } = duel(defs, { 0: { cards: ['ca', 'ps', 'sr'], hp: 5 } });
    const r = resolveWith(state, [A, 1, 2, 3, E, E], env);
    expect(hpOf(r.state, 0)).toBe(6);
    expect(mon(r.state, 1).tokens).toEqual({ poison: 1, shrink: 1 });
  });

  it('反射傷害：攻擊者受 1 點，且不會無限反射', () => {
    const rf = card('rh', 'reflect');
    const { env, state } = duel([rf], { 0: { cards: ['rh'] }, 1: { cards: ['rh'] } });
    const r = resolveWith(state, [A, 1, 2, 3, E, E], env);
    expect(hpOf(r.state, 0)).toBe(9);
    expect(r.events.filter((e) => e.type === 'damage_taken')).toHaveLength(2);
    expect(r.events).toContainEqual({
      type: 'damage_taken',
      seat: 0,
      amount: 1,
      hp: 9,
      source: 1,
      cause: 'reflect',
    });
  });
});

describe('R-CARD-33 減傷', () => {
  it('忽略 1 點傷害：剛好 1 點才忽略', () => {
    const { env, state } = duel([card('ar', 'armor')], { 1: { cards: ['ar'], location: 'city' } });
    const one = resolveWith(state, [A, 1, 2, 3, E, E], env);
    expect(hpOf(one.state, 1)).toBe(10);
    expect(one.events).toContainEqual({
      type: 'damage_prevented',
      seat: 1,
      amount: 1,
      cardId: 'ar',
    });
    expect(hpOf(resolveWith(state, [A, A, 1, 2, E, E], env).state, 1)).toBe(8);
  });

  it('迷彩：每點傷害擲一顆骰子，出現治療面免除；總和一定守恆', () => {
    const { env, state } = duel([card('cm', 'camouflage')], {
      1: { cards: ['cm'], location: 'city' },
    });
    let prevented = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const s = { ...state, rng: seed };
      const r = resolveWith(s, [A, A, A, A, 1, 2], env);
      const taken = 10 - hpOf(r.state, 1);
      const saved = r.events
        .filter((e) => e.type === 'damage_prevented')
        .reduce((n, e) => n + (e.type === 'damage_prevented' ? e.amount : 0), 0);
      expect(taken + saved).toBe(4);
      prevented += saved;
    }
    expect(prevented).toBeGreaterThan(0);
  });

  it('受傷 ≥ 門檻得能量；HP 歸零觸發吃屍者', () => {
    const w = card('wm', 'lose_hp_energy', { params: { min: 2, energy: 1 } });
    const d = card('ed', 'death_vp', { params: { vp: 3 } });
    const { env, state } = duel([w, d], {
      1: { cards: ['wm'], location: 'city', hp: 5 },
      2: { cards: ['ed'], hp: 1 },
    });
    const r = resolveWith(state, [A, A, 1, 2, E, E], env);
    expect(mon(r.state, 1).energy).toBe(1);
    const killed = resolveWith(
      { ...state, monsters: state.monsters.map((m) => (m.seat === 1 ? { ...m, hp: 2 } : m)) },
      [A, A, 1, 2, E, E],
      env,
    );
    expect(mon(killed.state, 1).alive).toBe(false);
    expect(mon(killed.state, 2).vp).toBe(3);
  });
});

// ── 回合結束效果 ─────────────────────────────────────────

describe('R-CARD-20 回合結束效果', () => {
  const endOf = (defs: CardDef[], monsters: Monsters, mutate?: (s: GameState) => void) => {
    const { env, state } = world(defs, 3, monsters);
    const s = buyPhase(state);
    mutate?.(s);
    return must(s, { type: 'endTurn', seat: 0 }, env);
  };

  it('能量囤積：每 6 能量 +1 VP；太陽能：沒能量時 +1', () => {
    const r = endOf([card('eh', 'end_energy_vp', { params: { per: 6, vp: 1 } })], {
      0: { cards: ['eh'], energy: 13 },
    });
    expect(mon(r.state, 0).vp).toBe(2);
    const sp = endOf([card('sp', 'end_empty_energy', { params: { n: 1 } })], {
      0: { cards: ['sp'] },
    });
    expect(mon(sp.state, 0).energy).toBe(1);
    const has = endOf([card('sp', 'end_empty_energy', { params: { n: 1 } })], {
      0: { cards: ['sp'], energy: 2 },
    });
    expect(mon(has.state, 0).energy).toBe(2);
  });

  it('扶弱：VP 最少者回合結束得 1 VP（任何人的回合結束都算，OQ-C 並列算最少）', () => {
    const r = endOf([card('ud', 'end_underdog', { params: { vp: 1 } })], {
      0: { vp: 5 },
      1: { cards: ['ud'], vp: 2 },
      2: { vp: 4 },
    });
    expect(mon(r.state, 1).vp).toBe(3);
    const notLowest = endOf([card('ud', 'end_underdog', { params: { vp: 1 } })], {
      0: { vp: 5 },
      1: { cards: ['ud'], vp: 4 },
      2: { vp: 2 },
    });
    expect(mon(notLowest.state, 1).vp).toBe(4);
  });

  it('草食：沒傷害任何人才得 VP；重擊：本回合總傷害達門檻得 VP', () => {
    const h = card('hb', 'end_peaceful_vp', { params: { vp: 1 } });
    expect(mon(endOf([h], { 0: { cards: ['hb'] } }).state, 0).vp).toBe(1);
    expect(
      mon(
        endOf([h], { 0: { cards: ['hb'] } }, (s) => {
          s.turn.damagedAnyone = true;
        }).state,
        0,
      ).vp,
    ).toBe(0);
    const t = card('tt', 'big_hit_vp', { params: { min: 3, vp: 2 } });
    expect(
      mon(
        endOf([t], { 0: { cards: ['tt'] } }, (s) => {
          s.turn.dealt = 3;
        }).state,
        0,
      ).vp,
    ).toBe(2);
    expect(
      mon(
        endOf([t], { 0: { cards: ['tt'] } }, (s) => {
          s.turn.dealt = 2;
        }).state,
        0,
      ).vp,
    ).toBe(0);
  });

  it('買牌得 VP', () => {
    const news = card('nt', 'vp_on_buy', { params: { vp: 1 } });
    const c = ins(1, { op: 'energy', n: 0 });
    const { env, state } = world([news, c], 3, { 0: { cards: ['nt'], energy: 5 } }, [c.id]);
    const r = must(buyPhase(state), { type: 'buy', seat: 0, cardId: c.id }, env);
    expect(mon(r.state, 0).vp).toBe(1);
  });

  it('雷霆踏步類：本回合 VP ≥ 門檻，所有人少擲一顆，直到持有者下一回合開始', () => {
    const st = card('ts', 'stomp', { params: { min: 4 } });
    const { env, state } = world([st], 3, { 0: { cards: ['ts'] } });
    let s = buyPhase(state);
    s.turn.vpGained = 4;
    s = must(s, { type: 'endTurn', seat: 0 }, env).state;
    expect(s.stomp).toEqual([0]);
    expect(s.turn.diceCount).toBe(5); // 輪到 seat 1
    s = must(buyPhase(s), { type: 'endTurn', seat: 1 }, env).state;
    s = must(buyPhase(s), { type: 'endTurn', seat: 2 }, env).state;
    expect(s.turn.seat).toBe(0);
    expect(s.stomp).toEqual([]);
    expect(s.turn.diceCount).toBe(6);
  });

  it('R-CARD-39 毒傷：回合結束時受到指示物數量的傷害，不是攻擊；致死沒有擊殺者', () => {
    const { env, state } = world([], 3, { 0: { tokens: { poison: 2, shrink: 0 } } });
    const r = must(buyPhase(state), { type: 'endTurn', seat: 0 }, env);
    expect(mon(r.state, 0).hp).toBe(8);
    expect(r.events).toContainEqual({
      type: 'damage_taken',
      seat: 0,
      amount: 2,
      hp: 8,
      source: null,
      cause: 'poison',
    });
    const dead = world([], 3, { 0: { tokens: { poison: 3, shrink: 0 }, hp: 3 } });
    const r2 = must(buyPhase(dead.state), { type: 'endTurn', seat: 0 }, dead.env);
    expect(mon(r2.state, 0).alive).toBe(false);
    expect(r2.events).toContainEqual({ type: 'eliminated', seat: 0, by: null });
    expect(r2.state.turn.seat).toBe(1);
    check(r2.state);
  });

  it('R-END-02 回合結束效果造成的 VP 也計入 20 VP 判定', () => {
    const r = endOf([card('eh', 'end_energy_vp', { params: { per: 6, vp: 1 } })], {
      0: { cards: ['eh'], energy: 12, vp: 18 },
    });
    expect(r.state.phase).toBe('over');
    expect(r.state.outcome?.winners).toEqual([0]);
  });
});
