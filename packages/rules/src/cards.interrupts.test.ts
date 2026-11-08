import { describe, expect, it } from 'vitest';
import { applyAction } from './engine.js';
import { checkInvariants } from './invariants.js';
import { currentActor, legalActions } from './legal.js';
import type { CardDef } from './cards/types.js';
import { card, makeEnv, makeState, mon, must, resolveWith, withDice } from './test-utils.js';
import { cloneState } from './state.js';
import type { GameState, Monster } from './types.js';
import type { Face } from './types.js';
import { redactEvent, redactState } from './view.js';

const A: Face = 'attack';
const E: Face = 'energy';
const H: Face = 'heal';

type Monsters = Record<number, Partial<Monster>>;

function world(
  defs: CardDef[],
  players: number,
  monsters: Monsters,
  faceUp: string[] = [],
  deck: string[] = [],
) {
  const env = makeEnv(...defs);
  return { env, state: makeState({ players, env, faceUp, deck, monsters }) };
}

function inPhase(state: GameState, phase: 'buy' | 'roll'): GameState {
  const s = cloneState(state);
  s.phase = phase;
  return s;
}

const check = (s: GameState): void => expect(checkInvariants(s)).toEqual([]);
const ins = (id: string, cost: number, ...ops: object[]): CardDef =>
  card(id, 'instant', { cost, params: { ops: ops as never } });

/** seat 0 在東京外攻擊東京市的 seat 1。 */
function duel(defs: CardDef[], monsters: Monsters) {
  return world(defs, 3, { ...monsters, 1: { location: 'city', ...monsters[1] } });
}

describe('R-CARD-34/35 反應詢問', () => {
  it('花能量整回合免傷：扣血前被詢問，使用後這次攻擊不受傷', () => {
    const { env, state } = duel([card('w', 'wings')], { 1: { cards: ['w'], energy: 5 } });
    let r = resolveWith(state, [A, A, A, 1, 2, E], env);
    expect(r.state.pending).toMatchObject({ kind: 'react', seat: 1 });
    expect(currentActor(r.state)).toBe(1);
    expect(mon(r.state, 1).hp).toBe(10);
    r = must(r.state, { type: 'reactDecision', seat: 1, cardId: 'w' }, env);
    expect(mon(r.state, 1)).toMatchObject({ hp: 10, energy: 3 });
    expect(r.state.pending).toMatchObject({ kind: 'yield' }); // 仍可決定要不要讓位
    check(r.state);
  });

  it('不使用就照常受傷；能量不足時根本不會被詢問', () => {
    const { env, state } = duel([card('w', 'wings')], { 1: { cards: ['w'], energy: 5 } });
    let r = resolveWith(state, [A, A, A, 1, 2, E], env);
    r = must(r.state, { type: 'reactDecision', seat: 1, cardId: null }, env);
    expect(mon(r.state, 1).hp).toBe(7);
    const poor = duel([card('w', 'wings')], { 1: { cards: ['w'], energy: 1 } });
    expect(resolveWith(poor.state, [A, A, A, 1, 2, E], poor.env).state.pending?.kind).toBe('yield');
  });

  it('免 1 點傷害：每回合一次，可再接著使用其他反應', () => {
    const defs = [card('sj', 'super_jump'), card('w', 'wings')];
    const { env, state } = duel(defs, { 1: { cards: ['sj', 'w'], energy: 5 } });
    let r = resolveWith(state, [A, A, A, 1, 2, E], env);
    r = must(r.state, { type: 'reactDecision', seat: 1, cardId: 'sj' }, env);
    expect(r.state.pending).toMatchObject({ kind: 'react' }); // 還有整回合免傷可用
    expect(applyAction(r.state, { type: 'reactDecision', seat: 1, cardId: 'sj' }, env)).toEqual({
      ok: false,
      error: 'cannot_use',
    });
    r = must(r.state, { type: 'reactDecision', seat: 1, cardId: null }, env);
    expect(mon(r.state, 1)).toMatchObject({ hp: 8, energy: 4 });
  });

  it('R-CARD-35 讓位免傷：直接離開東京、不受傷，攻擊者仍進入東京', () => {
    const { env, state } = duel([card('j', 'jets'), ins('c', 1)], { 1: { cards: ['j'] } });
    let r = resolveWith(state, [A, A, A, 1, 2, E], env);
    expect(r.state.pending).toMatchObject({ kind: 'react', seat: 1 });
    r = must(r.state, { type: 'reactDecision', seat: 1, cardId: 'j' }, env);
    expect(mon(r.state, 1)).toMatchObject({ hp: 10, location: null });
    expect(mon(r.state, 0).location).toBe('city');
    expect(r.state.pending).toBeNull();
    check(r.state);
  });

  it('legalActions 與 defaultAction 在反應詢問時可用', () => {
    const { env, state } = duel([card('w', 'wings')], { 1: { cards: ['w'], energy: 5 } });
    const r = resolveWith(state, [A, A, A, 1, 2, E], env);
    const acts = legalActions(r.state, env);
    expect(acts).toContainEqual({ type: 'reactDecision', seat: 1, cardId: 'w' });
    expect(acts).toContainEqual({ type: 'reactDecision', seat: 1, cardId: null });
  });
});

describe('R-CARD-23 擲骰期能力', () => {
  const rolled = (defs: CardDef[], monsters: Monsters) => {
    const w = world(defs, 3, monsters);
    return { ...w, state: withDice(w.state, [1, 2, 3, H, H, E]) };
  };

  it('任意改骰（用完即棄）：改寫骰面並棄掉這張卡', () => {
    const { env, state } = rolled(
      [card('pt', 'die_change', { params: { cost: 0, to: 'any', discard: true } })],
      { 0: { cards: ['pt'] } },
    );
    const r = must(
      state,
      { type: 'useCard', seat: 0, cardId: 'pt', args: { die: 0, face: A } },
      env,
    );
    expect(r.state.turn.dice[0]).toBe(A);
    expect(mon(r.state, 0).cards).toEqual([]);
    expect(r.state.market?.discard).toEqual(['pt']);
    expect(r.events).toContainEqual({ type: 'die_changed', seat: 0, index: 0, face: A });
  });

  it('花能量改骰；改成固定面；每回合一次', () => {
    const defs = [
      card('st', 'die_change', { params: { cost: 2, to: 'any' } }),
      card('hc', 'die_change', { params: { cost: 0, to: 1, once: true } }),
    ];
    const { env, state } = rolled(defs, { 0: { cards: ['st', 'hc'], energy: 3 } });
    let s = must(
      state,
      { type: 'useCard', seat: 0, cardId: 'st', args: { die: 1, face: E } },
      env,
    ).state;
    expect(mon(s, 0).energy).toBe(1);
    expect(
      applyAction(s, { type: 'useCard', seat: 0, cardId: 'st', args: { die: 1, face: E } }, env),
    ).toEqual({ ok: false, error: 'cannot_use' });
    s = must(s, { type: 'useCard', seat: 0, cardId: 'hc', args: { die: 5 } }, env).state;
    expect(s.turn.dice[5]).toBe(1);
    expect(
      applyAction(s, { type: 'useCard', seat: 0, cardId: 'hc', args: { die: 4 } }, env),
    ).toEqual({ ok: false, error: 'cannot_use' });
  });

  it('錯誤的參數與時機被拒絕', () => {
    const { env, state } = rolled([card('st', 'die_change', { params: { cost: 0, to: 'any' } })], {
      0: { cards: ['st'] },
    });
    const use = (s: GameState, args: object) =>
      applyAction(s, { type: 'useCard', seat: 0, cardId: 'st', args }, env);
    expect(use(state, { die: 9, face: A })).toEqual({ ok: false, error: 'invalid_action' });
    expect(use(state, { die: 0 })).toEqual({ ok: false, error: 'invalid_action' });
    const fresh = world([card('st', 'die_change', { params: { cost: 0, to: 'any' } })], 3, {
      0: { cards: ['st'] },
    });
    expect(
      applyAction(
        fresh.state,
        { type: 'useCard', seat: 0, cardId: 'st', args: { die: 0, face: A } },
        fresh.env,
      ),
    ).toEqual({ ok: false, error: 'wrong_phase' });
    expect(
      applyAction(
        state,
        { type: 'useCard', seat: 1, cardId: 'st', args: { die: 0, face: A } },
        env,
      ),
    ).toMatchObject({ ok: false });
  });

  it('額外重擲：還有能量時，次數用完不自動結算，使用後可再擲', () => {
    const { env, state } = world([card('tp', 'reroll_energy', { params: { cost: 1 } })], 3, {
      0: { cards: ['tp'], energy: 1 },
    });
    let s = must(state, { type: 'roll', seat: 0, keep: [] }, env).state;
    s = must(s, { type: 'roll', seat: 0, keep: [0] }, env).state;
    s = must(s, { type: 'roll', seat: 0, keep: [0] }, env).state;
    expect(s.phase).toBe('roll'); // 還有能力可用，等玩家決定
    expect(applyAction(s, { type: 'roll', seat: 0, keep: [0] }, env)).toEqual({
      ok: false,
      error: 'no_rolls_left',
    });
    s = must(s, { type: 'useCard', seat: 0, cardId: 'tp' }, env).state;
    expect(mon(s, 0).energy).toBe(0);
    s = must(s, { type: 'roll', seat: 0, keep: [0] }, env).state;
    expect(s.phase).not.toBe('roll');
  });

  it('沒有能量時自動結算（與 M1 相同）', () => {
    const { env, state } = world([card('tp', 'reroll_energy')], 3, {
      0: { cards: ['tp'], energy: 0 },
    });
    let s = must(state, { type: 'roll', seat: 0, keep: [] }, env).state;
    s = must(s, { type: 'roll', seat: 0, keep: [0] }, env).state;
    s = must(s, { type: 'roll', seat: 0, keep: [0] }, env).state;
    expect(s.phase).not.toBe('roll');
  });

  it('充能式額外重擲：用完 3 次後棄掉', () => {
    const { env, state } = world([card('sc', 'reroll_charges', { params: { charges: 3 } })], 3, {
      0: { cards: ['sc'], cardData: { sc: { n: 3, ref: null } } },
    });
    let s = withDice(state, [1, 2, 3, H, H, E]);
    for (let i = 0; i < 3; i += 1) {
      s = must(s, { type: 'useCard', seat: 0, cardId: 'sc' }, env).state;
    }
    expect(s.turn.bonusRolls).toBe(3);
    expect(mon(s, 0).cards).toEqual([]);
    check(s);
  });

  it('只重擲 3：次數用完後仍可重擲 3，不增加擲骰次數', () => {
    const { env, state } = world([card('bd', 'reroll_threes')], 3, { 0: { cards: ['bd'] } });
    const s = withDice(state, [3, 3, 1, 2, E, A]);
    s.turn.rollsUsed = 3;
    expect(applyAction(s, { type: 'roll', seat: 0, keep: [0, 1, 2] }, env)).toEqual({
      ok: false,
      error: 'no_rolls_left',
    });
    const r = must(s, { type: 'roll', seat: 0, keep: [2, 3, 4, 5] }, env);
    expect(r.state.turn.rollsUsed).toBe(3);
    expect(r.state.turn.dice.slice(2)).toEqual([1, 2, E, A]);
    expect(r.events.find((e) => e.type === 'dice_rolled')).toMatchObject({ rerolled: [0, 1] });
  });
});

describe('R-CARD-24 隨時能力', () => {
  it('花能量補血與換 VP；滿血或能量不足不能用', () => {
    const defs = [
      card('rh', 'rapid_heal', { params: { cost: 2, heal: 1 } }),
      card('sw', 'energy_to_vp', { params: { cost: 3, vp: 1 } }),
    ];
    const { env, state } = world(defs, 3, {
      0: { cards: ['rh', 'sw'], energy: 5, hp: 5, location: 'city' },
    });
    let s = inPhase(state, 'buy');
    s = must(s, { type: 'useCard', seat: 0, cardId: 'rh' }, env).state;
    expect(mon(s, 0)).toMatchObject({ hp: 6, energy: 3 }); // 在東京內用卡治療可以
    s = must(s, { type: 'useCard', seat: 0, cardId: 'sw' }, env).state;
    expect(mon(s, 0)).toMatchObject({ vp: 1, energy: 0 });
    expect(applyAction(s, { type: 'useCard', seat: 0, cardId: 'rh' }, env)).toEqual({
      ok: false,
      error: 'cannot_use',
    });
  });

  it('被詢問讓位時也能用；沒輪到的人不能插入（OQ-C2）', () => {
    const { env, state } = duel([card('rh', 'rapid_heal', { params: { cost: 2, heal: 1 } })], {
      1: { cards: ['rh'], energy: 4, hp: 5 },
    });
    const r = resolveWith(state, [A, 1, 2, 3, H, H], env);
    expect(r.state.pending).toMatchObject({ kind: 'yield' });
    expect(applyAction(r.state, { type: 'useCard', seat: 1, cardId: 'rh' }, env)).toMatchObject({
      ok: true,
    });
    const other = duel([card('rh', 'rapid_heal', { params: { cost: 2, heal: 1 } })], {
      2: { cards: ['rh'], energy: 4, hp: 5 },
    });
    const r2 = resolveWith(other.state, [A, 1, 2, 3, H, H], other.env);
    expect(applyAction(r2.state, { type: 'useCard', seat: 2, cardId: 'rh' }, other.env)).toEqual({
      ok: false,
      error: 'wrong_phase',
    });
  });
});

describe('R-CARD-50~56 買牌階段能力', () => {
  it('R-CARD-53 出售：每張得到卡面費用（不受減免影響）', () => {
    const defs = [
      card('mm', 'metamorph'),
      card('k', 'reroll_threes', { cost: 5 }),
      card('disc', 'cost_discount'),
    ];
    const { env, state } = world(defs, 3, { 0: { cards: ['mm', 'k', 'disc'] } });
    const r = must(
      inPhase(state, 'buy'),
      { type: 'useCard', seat: 0, cardId: 'mm', args: { cards: ['k'] } },
      env,
    );
    expect(mon(r.state, 0).energy).toBe(5);
    expect(mon(r.state, 0).cards).toEqual(['mm', 'disc']);
    expect(
      applyAction(r.state, { type: 'useCard', seat: 0, cardId: 'mm', args: { cards: ['k'] } }, env),
    ).toEqual({ ok: false, error: 'card_unavailable' });
    expect(
      applyAction(
        inPhase(state, 'roll'),
        { type: 'useCard', seat: 0, cardId: 'mm', args: { cards: ['k'] } },
        env,
      ),
    ).toEqual({ ok: false, error: 'wrong_phase' });
  });

  it('R-CARD-54 複製：買下時視同剛買下被複製的卡；目標離場後失效，開局付 1 能量重新指定', () => {
    const defs = [
      card('eb', 'max_hp', { params: { n: 2 } }),
      card('xd', 'extra_dice'),
      card('mi', 'mimic', { cost: 8 }),
    ];
    const { env, state } = world(
      defs,
      3,
      { 0: { energy: 20 }, 1: { cards: ['eb', 'xd'], maxHp: 12, hp: 12 } },
      ['mi'],
    );
    const bad = applyAction(
      inPhase(state, 'buy'),
      { type: 'buy', seat: 0, cardId: 'mi', target: 'nope' },
      env,
    );
    expect(bad).toEqual({ ok: false, error: 'invalid_action' });
    const none = applyAction(inPhase(state, 'buy'), { type: 'buy', seat: 0, cardId: 'mi' }, env);
    expect(none).toEqual({ ok: false, error: 'invalid_action' });
    let s = must(
      inPhase(state, 'buy'),
      { type: 'buy', seat: 0, cardId: 'mi', target: 'eb' },
      env,
    ).state;
    expect(mon(s, 0)).toMatchObject({ maxHp: 12, hp: 12, energy: 12 });
    expect(mon(s, 0).cardData['mi']?.ref).toBe('eb');
    // 目標離場：指示物收回
    s = must(inPhase(s, 'buy'), { type: 'endTurn', seat: 0 }, env).state; // 換 seat 1
    const gone = cloneState(s);
    gone.phase = 'buy';
    gone.monsters[1]!.cards = [];
    gone.monsters[0]!.cardData['mi']!.ref = null;
    // 重新指定：回到 seat 0 的回合開始時（擲骰前）
    const back = world(defs, 3, {
      0: { cards: ['mi'], energy: 3, cardData: { mi: { n: 0, ref: null } } },
      1: { cards: ['xd'] },
    });
    const sw = must(
      back.state,
      { type: 'useCard', seat: 0, cardId: 'mi', args: { target: 'xd' } },
      back.env,
    );
    expect(mon(sw.state, 0)).toMatchObject({ energy: 2 });
    expect(mon(sw.state, 0).cardData['mi']?.ref).toBe('xd');
    // 已經擲過就不能換
    expect(
      applyAction(
        withDice(back.state, [1, 2, 3, H, H, E]),
        { type: 'useCard', seat: 0, cardId: 'mi', args: { target: 'xd' } },
        back.env,
      ),
    ).toMatchObject({ ok: false });
    check(sw.state);
  });

  it('R-CARD-54 複製來的加骰效果實際生效', () => {
    const defs = [card('xd', 'extra_dice'), card('mi', 'mimic')];
    const { env, state } = world(defs, 3, {
      1: { cards: ['xd'] },
      0: { cards: ['mi'], cardData: { mi: { n: 0, ref: 'xd' } } },
    });
    // seat 0 的下一輪：從 seat 2 結束回合
    const s = inPhase({ ...state, turn: { ...state.turn, seat: 2 } }, 'buy');
    const r = must(s, { type: 'endTurn', seat: 2 }, env);
    expect(r.state.turn).toMatchObject({ seat: 0, diceCount: 7 });
  });

  it('R-CARD-55 電池：買下時放能量，每個回合開始取回 2，取完棄掉', () => {
    const defs = [card('bat', 'batteries', { cost: 2, params: { perTurn: 2 } })];
    const { env, state } = world(defs, 2, { 0: { energy: 10 } }, ['bat']);
    let s = must(
      inPhase(state, 'buy'),
      { type: 'buy', seat: 0, cardId: 'bat', energy: 4 },
      env,
    ).state;
    expect(mon(s, 0)).toMatchObject({ energy: 4 });
    expect(mon(s, 0).cardData['bat']?.n).toBe(4);
    expect(
      applyAction(inPhase(state, 'buy'), { type: 'buy', seat: 0, cardId: 'bat', energy: 9 }, env),
    ).toEqual({ ok: false, error: 'not_enough_energy' });
    s = must(inPhase(s, 'buy'), { type: 'endTurn', seat: 0 }, env).state;
    s = must(inPhase(s, 'buy'), { type: 'endTurn', seat: 1 }, env).state;
    expect(mon(s, 0).energy).toBe(6);
    s = must(inPhase(s, 'buy'), { type: 'endTurn', seat: 0 }, env).state;
    s = must(inPhase(s, 'buy'), { type: 'endTurn', seat: 1 }, env).state;
    expect(mon(s, 0)).toMatchObject({ energy: 8, cards: [] });
    check(s);
  });

  it('R-CARD-51 窺牌買牌：只有使用者看得到，買下後不補牌', () => {
    const defs = [card('lab', 'peek_buy'), ins('d1', 2, { op: 'vp', n: 3 }), ins('d2', 2)];
    const { env, state } = world(defs, 3, { 0: { cards: ['lab'], energy: 5 } }, [], ['d1', 'd2']);
    const b = inPhase(state, 'buy');
    expect(applyAction(b, { type: 'buy', seat: 0, cardId: 'd1', from: 'deck' }, env)).toEqual({
      ok: false,
      error: 'card_unavailable',
    });
    const peeked = must(b, { type: 'useCard', seat: 0, cardId: 'lab' }, env);
    expect(peeked.state.turn.peek).toBe('d1');
    expect(redactState(peeked.state, 1).turn.peek).toBeNull();
    expect(redactState(peeked.state, 0).turn.peek).toBe('d1');
    expect(redactState(peeked.state, 1).market?.deck).toEqual(['', '']);
    expect(redactState(peeked.state, 1).rng).toBe(0);
    const ev = peeked.events[0]!;
    expect(redactEvent(ev, 1)).toMatchObject({ type: 'deck_peeked', cardId: null });
    expect(redactEvent(ev, 0)).toMatchObject({ cardId: 'd1' });
    const bought = must(peeked.state, { type: 'buy', seat: 0, cardId: 'd1', from: 'deck' }, env);
    expect(mon(bought.state, 0)).toMatchObject({ vp: 3, energy: 3 });
    expect(bought.state.market?.deck).toEqual(['d2']);
    expect(bought.state.turn.peek).toBeNull();
  });

  it('R-CARD-50 向他人買牌：費用付給對方，卡與計數轉移', () => {
    const defs = [card('pt', 'buy_from_others'), card('sc', 'reroll_charges', { cost: 4 })];
    const { env, state } = world(defs, 3, {
      0: { cards: ['pt'], energy: 6 },
      1: { cards: ['sc'], cardData: { sc: { n: 2, ref: null } } },
    });
    const r = must(inPhase(state, 'buy'), { type: 'buy', seat: 0, cardId: 'sc', from: 1 }, env);
    expect(mon(r.state, 0)).toMatchObject({ energy: 2, cards: ['pt', 'sc'] });
    expect(mon(r.state, 0).cardData['sc']?.n).toBe(2);
    expect(mon(r.state, 1)).toMatchObject({ energy: 4, cards: [] });
    check(r.state);
    const no = world([card('sc', 'reroll_charges')], 3, { 0: { energy: 6 }, 1: { cards: ['sc'] } });
    expect(
      applyAction(
        inPhase(no.state, 'buy'),
        { type: 'buy', seat: 0, cardId: 'sc', from: 1 },
        no.env,
      ),
    ).toEqual({ ok: false, error: 'cannot_use' });
  });

  it('R-CARD-52 新牌即買：其他持有者依序被詢問，買下後再翻出的新牌也給機會', () => {
    const defs = [
      card('op', 'opportunist'),
      ins('c1', 1),
      ins('x1', 9),
      ins('x2', 9),
      ins('n1', 2, { op: 'vp', n: 2 }),
      ins('n2', 9),
    ];
    const { env, state } = world(
      defs,
      3,
      { 0: { energy: 5 }, 1: { cards: ['op'], energy: 3 } },
      ['c1', 'x1', 'x2'],
      ['n1', 'n2'],
    );
    let r = must(inPhase(state, 'buy'), { type: 'buy', seat: 0, cardId: 'c1' }, env);
    expect(r.state.pending).toEqual({ kind: 'opportunity', queue: [{ seat: 1, cardId: 'n1' }] });
    expect(currentActor(r.state)).toBe(1);
    r = must(r.state, { type: 'opportunityDecision', seat: 1, buy: true }, env);
    expect(mon(r.state, 1)).toMatchObject({ energy: 1, vp: 2 });
    expect(r.state.phase).toBe('buy'); // n2 太貴，沒有機會了
    expect(r.state.turn.seat).toBe(0);
    check(r.state);
  });

  it('新牌即買：放棄或買不起時回到買牌階段', () => {
    const defs = [
      card('op', 'opportunist'),
      ins('c1', 1),
      ins('x1', 9),
      ins('x2', 9),
      ins('n1', 2),
    ];
    const rich = world(
      defs,
      3,
      { 0: { energy: 5 }, 1: { cards: ['op'], energy: 3 } },
      ['c1', 'x1', 'x2'],
      ['n1'],
    );
    let r = must(inPhase(rich.state, 'buy'), { type: 'buy', seat: 0, cardId: 'c1' }, rich.env);
    r = must(r.state, { type: 'opportunityDecision', seat: 1, buy: false }, rich.env);
    expect(r.state.phase).toBe('buy');
    const poor = world(
      defs,
      3,
      { 0: { energy: 5 }, 1: { cards: ['op'], energy: 1 } },
      ['c1', 'x1', 'x2'],
      ['n1'],
    );
    const r2 = must(inPhase(poor.state, 'buy'), { type: 'buy', seat: 0, cardId: 'c1' }, poor.env);
    expect(r2.state.phase).toBe('buy');
  });

  it('R-CARD-56 連三個 1 的額外回合：少一顆骰子，同一位再來一回合', () => {
    const { env, state } = world([card('ft', 'extra_turn_triple', { params: { penalty: 1 } })], 3, {
      0: { cards: ['ft'] },
    });
    let s = resolveWith(state, [1, 1, 1, H, H, E], env).state;
    expect(s.phase).toBe('buy');
    s = must(s, { type: 'useCard', seat: 0, cardId: 'ft' }, env).state;
    const r = must(s, { type: 'endTurn', seat: 0 }, env);
    expect(r.state.turn).toMatchObject({ seat: 0, diceCount: 5 });
    expect(r.state.round).toBe(1);
    const no = resolveWith(state, [1, 1, 2, H, H, E], env).state;
    expect(applyAction(no, { type: 'useCard', seat: 0, cardId: 'ft' }, env)).toEqual({
      ok: false,
      error: 'cannot_use',
    });
  });

  it('R-END-09 額外回合開始前先判定 20 VP：已達標就直接結束', () => {
    const def = ins('fr', 1, { op: 'extraTurn' });
    const { env, state } = world([def], 3, { 0: { vp: 20, energy: 5 } }, ['fr']);
    const bought = must(inPhase(state, 'buy'), { type: 'buy', seat: 0, cardId: 'fr' }, env);
    const r = must(bought.state, { type: 'endTurn', seat: 0 }, env);
    expect(r.state.phase).toBe('over');
    expect(r.state.outcome).toEqual({ winners: [0], reason: 'turnEnd' });
  });
});

describe('R-CARD-60~62 治療面的分配', () => {
  it('在東京外有指示物時詢問分配：移除指示物取代治療', () => {
    const { env, state } = world([], 3, { 0: { tokens: { poison: 2, shrink: 1 }, hp: 5 } });
    let r = resolveWith(state, [H, H, H, 1, 2, E], env);
    expect(r.state.pending).toMatchObject({ kind: 'hearts', seat: 0, hearts: 3 });
    const bad = (a: object) =>
      applyAction(
        r.state,
        { type: 'heartsDecision', seat: 0, self: 0, poison: 0, shrink: 0, others: [], ...a },
        env,
      );
    expect(bad({ self: 4 })).toEqual({ ok: false, error: 'invalid_action' });
    expect(bad({ poison: 3 })).toEqual({ ok: false, error: 'invalid_action' });
    r = must(
      r.state,
      { type: 'heartsDecision', seat: 0, self: 1, poison: 2, shrink: 0, others: [] },
      env,
    );
    expect(mon(r.state, 0)).toMatchObject({ hp: 6, tokens: { poison: 0, shrink: 1 } });
    check(r.state);
  });

  it('R-CARD-61 在東京內不能移除指示物，也不詢問', () => {
    const { env, state } = world([], 3, {
      0: { tokens: { poison: 2, shrink: 0 }, location: 'city' },
    });
    const r = resolveWith(state, [H, H, H, 1, 2, E], env);
    expect(r.state.pending).toBeNull();
    expect(mon(r.state, 0).tokens.poison).toBe(2);
  });

  it('R-CARD-62 替他人治療：被治療者付 2 能量／點（不足付全部），持有者得到', () => {
    const { env, state } = world([card('hr', 'heal_others', { params: { rate: 2 } })], 3, {
      0: { cards: ['hr'], hp: 10 },
      1: { hp: 5, energy: 3 },
      2: { hp: 9, energy: 6 },
    });
    let r = resolveWith(state, [H, H, H, 1, 2, E], env);
    expect(r.state.pending).toMatchObject({ kind: 'hearts' });
    r = must(
      r.state,
      {
        type: 'heartsDecision',
        seat: 0,
        self: 0,
        poison: 0,
        shrink: 0,
        others: [
          { seat: 1, amount: 2 },
          { seat: 2, amount: 1 },
        ],
      },
      env,
    );
    expect(mon(r.state, 1)).toMatchObject({ hp: 7, energy: 0 }); // 要付 4，只有 3
    expect(mon(r.state, 2)).toMatchObject({ hp: 10, energy: 4 });
    expect(mon(r.state, 0).energy).toBe(6); // 收到 3 + 2，再加骰面的 1 能量
    check(r.state);
    expect(
      applyAction(
        resolveWith(state, [H, H, H, 1, 2, E], env).state,
        {
          type: 'heartsDecision',
          seat: 0,
          self: 0,
          poison: 0,
          shrink: 0,
          others: [{ seat: 2, amount: 3 }],
        },
        env,
      ),
    ).toEqual({ ok: false, error: 'invalid_action' });
  });
});

describe('R-CARD-38 讓位時觸發', () => {
  it('讓位換卡：拿走接手者的一張 Keep 卡並把本卡換給他', () => {
    const defs = [card('dna', 'swap_on_yield'), card('k', 'reroll_threes')];
    const { env, state } = duel(defs, { 0: { cards: ['k'] }, 1: { cards: ['dna'] } });
    const r = resolveWith(state, [A, 1, 2, 3, H, H], env);
    expect(
      applyAction(r.state, { type: 'yieldDecision', seat: 1, leave: true, takeCard: 'nope' }, env),
    ).toEqual({ ok: false, error: 'card_unavailable' });
    expect(
      applyAction(r.state, { type: 'yieldDecision', seat: 1, leave: false, takeCard: 'k' }, env),
    ).toEqual({ ok: false, error: 'cannot_use' });
    const y = must(r.state, { type: 'yieldDecision', seat: 1, leave: true, takeCard: 'k' }, env);
    expect(mon(y.state, 1).cards).toEqual(['k']);
    expect(mon(y.state, 0).cards).toEqual(['dna']);
    expect(y.events).toContainEqual({
      type: 'card_swapped',
      seat: 1,
      gave: 'dna',
      took: 'k',
      from: 0,
    });
    check(y.state);
  });
});

describe('R-CARD-30 重擲他人骰子', () => {
  it('結算前詢問持有者；重擲會改寫骰面；擲出治療面時棄掉這張卡', () => {
    const { env, state } = world([card('pp', 'probe')], 3, { 1: { cards: ['pp'] } });
    let discarded = false;
    let kept = false;
    for (let seed = 1; seed <= 40; seed += 1) {
      const s = withDice({ ...state, rng: seed }, [A, A, A, A, A, A]);
      const r = must(s, { type: 'endRolling', seat: 0 }, env);
      expect(r.state.pending).toMatchObject({ kind: 'probe', queue: [1] });
      const after = must(r.state, { type: 'probeDecision', seat: 1, die: 0 }, env);
      const ev = after.events.find((e) => e.type === 'die_rerolled');
      expect(ev).toMatchObject({ by: 1, seat: 0, index: 0 });
      if (ev?.type === 'die_rerolled' && ev.face === 'heal') {
        expect(mon(after.state, 1).cards).toEqual([]);
        discarded = true;
      } else {
        expect(mon(after.state, 1).cards).toEqual(['pp']);
        kept = true;
      }
    }
    expect(discarded && kept).toBe(true);
  });

  it('可以放棄；沒輪到的人不能回應', () => {
    const { env, state } = world([card('pp', 'probe')], 3, { 1: { cards: ['pp'] } });
    const r = must(withDice(state, [1, 2, 3, H, H, E]), { type: 'endRolling', seat: 0 }, env);
    expect(applyAction(r.state, { type: 'probeDecision', seat: 2, die: null }, env)).toEqual({
      ok: false,
      error: 'not_your_turn',
    });
    const pass = must(r.state, { type: 'probeDecision', seat: 1, die: null }, env);
    expect(pass.state.pending).toBeNull();
    expect(pass.state.turn.seat === 0 || pass.state.turn.seat === 1).toBe(true);
  });
});

describe('R-CARD-40~42 復活與搭檔', () => {
  it('復活：棄所有卡、VP 歸零、HP 設為指定值、離開東京；HP 歸零仍觸發吃屍者', () => {
    const defs = [
      card('ic', 'revive_self', { params: { hp: 10 } }),
      card('k', 'reroll_threes'),
      card('ed', 'death_vp', { params: { vp: 3 } }),
    ];
    const { env, state } = duel(defs, {
      0: { cards: ['ed'] },
      1: { cards: ['ic', 'k'], hp: 2, vp: 7 },
    });
    const r = resolveWith(state, [A, A, A, 1, 2, E], env);
    expect(mon(r.state, 1)).toMatchObject({
      alive: true,
      hp: 10,
      vp: 0,
      cards: [],
      location: null,
    });
    expect(r.events).toContainEqual({ type: 'revived', seat: 1, hp: 10, partner: null });
    expect(mon(r.state, 0).vp).toBe(3 + 1); // 吃屍者 + 進入東京
    expect(r.state.market?.discard).toEqual(expect.arrayContaining(['ic', 'k']));
    check(r.state);
  });

  it('搭檔：被擊殺時復活並結為搭檔；第二次被淘汰時無效', () => {
    const { env, state } = duel([card('sk', 'revive_partner', { params: { hp: 10 } })], {
      1: { cards: ['sk'], hp: 2, vp: 6 },
    });
    const r = resolveWith(state, [A, A, A, 1, 2, E], env);
    expect(mon(r.state, 1)).toMatchObject({
      alive: true,
      hp: 10,
      vp: 0,
      sidekickOf: 0,
      sidekickUsed: true,
    });
    expect(mon(r.state, 1).cards).toEqual(['sk']); // 搭檔卡只重置 HP 與 VP，不棄牌
    check(r.state);
    const used = duel([card('sk', 'revive_partner')], {
      1: { cards: ['sk'], hp: 2, sidekickUsed: true, sidekickOf: 0 },
    });
    const second = resolveWith(used.state, [A, A, A, 1, 2, E], used.env);
    expect(mon(second.state, 1).alive).toBe(false); // 第二次淘汰：卡牌無效
  });

  it('自傷或毒（沒有擊殺者）不會觸發搭檔', () => {
    const defs = [card('sk', 'revive_partner'), ins('sd', 1, { op: 'selfDamage', n: 5 })];
    const { env, state } = world(defs, 3, { 0: { cards: ['sk'], hp: 3, energy: 3 } }, ['sd']);
    const r = must(inPhase(state, 'buy'), { type: 'buy', seat: 0, cardId: 'sd' }, env);
    expect(mon(r.state, 0).alive).toBe(false);
  });

  it('R-CARD-42 擊殺者被淘汰時搭檔一併淘汰', () => {
    const { env, state } = world([], 3, {
      0: { tokens: { poison: 9, shrink: 0 }, hp: 3 },
      1: { sidekickOf: 0, sidekickUsed: true },
    });
    const r = must(inPhase(state, 'buy'), { type: 'endTurn', seat: 0 }, env);
    expect(mon(r.state, 0).alive).toBe(false);
    expect(mon(r.state, 1).alive).toBe(false);
    expect(r.events.filter((e) => e.type === 'eliminated')).toHaveLength(2);
    expect(r.state.phase).toBe('over'); // 只剩 seat 2
    expect(r.state.outcome).toEqual({ winners: [2], reason: 'lastStanding' });
  });

  it('R-CARD-42 共同勝利：搭檔與擊殺者任一方勝利兩人都贏', () => {
    const { env, state } = world([], 3, {
      0: { vp: 20 },
      1: { sidekickOf: 0, sidekickUsed: true },
    });
    const r = must(inPhase(state, 'buy'), { type: 'endTurn', seat: 0 }, env);
    expect(r.state.outcome).toEqual({ winners: [0, 1], reason: 'turnEnd' });
    const reverse = world([], 3, {
      1: { sidekickOf: 0, sidekickUsed: true, vp: 20 },
      2: { hp: 10 },
    });
    const s = { ...reverse.state, turn: { ...reverse.state.turn, seat: 1 } };
    const r2 = must(inPhase(s, 'buy'), { type: 'endTurn', seat: 1 }, reverse.env);
    expect(r2.state.outcome?.winners).toEqual([0, 1]);
    check(r2.state);
  });
});
