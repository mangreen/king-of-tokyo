/**
 * 真實卡組（card-sets/original）逐張檢查：每一張卡都要做到卡面寫的事。
 * 通用效果的細節在其他 cards.*.test.ts 以合成卡測；這裡用「真正的卡面參數」走一遍主要效果，
 * 並確認被動卡發動時會留下 card_triggered 事件（3D 特效與提示靠它）。
 */
import { describe, expect, it } from 'vitest';
import original from '../../../card-sets/original/set.json';
import { applyAction } from './engine.js';
import type { CardDef } from './cards/types.js';
import { legalActions } from './index.js';
import { makeEnv, makeState, mon, must, resolveWith, withDice } from './test-utils.js';
import { cloneState } from './state.js';
import type { Face, GameEvent, GameState, Monster } from './types.js';

interface SetFile {
  cards: CardDef[];
}
const RAW = original as unknown as SetFile;
// 卡牌 id 帶 "o-" 前綴；測試裡用不帶前綴的短名稱
const SET: SetFile = { cards: RAW.cards.map((c) => ({ ...c, id: c.id.replace(/^o-/, '') })) };
const env = makeEnv(...SET.cards);
const def = (id: string): CardDef => {
  const d = SET.cards.find((c) => c.id === id);
  if (!d) throw new Error(`沒有這張卡：${id}`);
  return d;
};

const A: Face = 'attack';
const E: Face = 'energy';
const H: Face = 'heal';

type Monsters = Record<number, Partial<Monster>>;

function world(players: number, monsters: Monsters, faceUp: string[] = [], deck: string[] = []) {
  return makeState({ players, env, faceUp, deck, monsters });
}

function phase(state: GameState, p: 'buy' | 'roll'): GameState {
  const s = cloneState(state);
  s.phase = p;
  return s;
}

/** 座位 0 在買牌階段買下 id。座位 0 預設有 20 能量。 */
function buy(id: string, monsters: Monsters = {}, players = 3) {
  const state = world(players, { ...monsters, 0: { energy: 20, ...monsters[0] } }, [id]);
  return must(phase(state, 'buy'), { type: 'buy', seat: 0, cardId: id }, env);
}

/** 座位 0 持有 mine，座位 1 在東京市；以 dice 結算座位 0 的回合。 */
function attackWith(mine: string[], dice: Face[], extra: Monsters = {}, players = 3) {
  const state = world(players, {
    ...extra,
    0: { cards: mine, ...extra[0] },
    1: { location: 'city', ...extra[1] },
  });
  return { initial: state, ...resolveWith(state, dice, env) };
}

const triggered = (events: readonly GameEvent[], cardId: string, seat?: number): boolean =>
  events.some(
    (e) =>
      e.type === 'card_triggered' && e.cardId === cardId && (seat === undefined || e.seat === seat),
  );

const hp = (s: GameState, seat: number): number => mon(s, seat).hp;

/** 座位 0 的回合結束（買牌階段 endTurn）。 */
function endOfTurn(monsters: Monsters, mutate?: (s: GameState) => void, players = 3) {
  const state = phase(world(players, monsters), 'buy');
  mutate?.(state);
  return must(state, { type: 'endTurn', seat: 0 }, env);
}

const scenarios: Record<string, () => void> = {
  // ── Discard：買下就生效 ──
  'high-rise': () => expect(mon(buy('high-rise').state, 0).vp).toBe(4),
  kiosk: () => expect(mon(buy('kiosk').state, 0).vp).toBe(1),
  subway: () => expect(mon(buy('subway').state, 0).vp).toBe(2),
  'power-surge': () => {
    expect(mon(buy('power-surge', { 0: { energy: 10 } }).state, 0).energy).toBe(10 - 7 + 8);
  },
  'first-aid': () => {
    expect(hp(buy('first-aid', { 0: { hp: 5 } }).state, 0)).toBe(8);
  },
  fusion: () => {
    const r = buy('fusion', { 0: { hp: 5 } }).state;
    expect([mon(r, 0).vp, hp(r, 0)]).toEqual([2, 8]);
  },
  'armor-column': () => {
    const r = buy('armor-column').state;
    expect([mon(r, 0).vp, hp(r, 0)]).toEqual([3, 8]);
  },
  bombers: () => {
    const r = buy('bombers').state;
    expect([mon(r, 0).vp, hp(r, 0)]).toEqual([4, 7]);
  },
  rumor: () => {
    const r = buy('rumor', { 1: { vp: 6 }, 2: { vp: 3 } }).state;
    expect([mon(r, 0).vp, mon(r, 1).vp, mon(r, 2).vp]).toEqual([0, 2, 0]);
  },
  'acid-rain': () => {
    const r = buy('acid-rain').state;
    expect([hp(r, 0), hp(r, 1), hp(r, 2)]).toEqual([10, 8, 8]);
  },
  refinery: () => {
    const r = buy('refinery').state;
    expect([mon(r, 0).vp, hp(r, 0), hp(r, 1), hp(r, 2)]).toEqual([2, 10, 7, 7]);
  },
  meteors: () => {
    const r = buy('meteors').state;
    expect([hp(r, 0), hp(r, 1), hp(r, 2)]).toEqual([7, 7, 7]);
  },
  airdrop: () => {
    const r = buy('airdrop', { 1: { location: 'city' } }).state;
    expect(mon(r, 0).location).toBe('city');
    expect(mon(r, 1).location).toBeNull();
    expect(mon(r, 0).vp).toBe(2 + 1); // 卡 +2，進入東京 +1
    // 已經在東京就不再奪取
    const here = buy('airdrop', { 0: { location: 'bay' } }, 5).state;
    expect(mon(here, 0).location).toBe('bay');
  },
  blackout: () => {
    const r = buy('blackout', { 1: { energy: 7 }, 2: { energy: 2 } }).state;
    expect([mon(r, 0).vp, mon(r, 1).energy, mon(r, 2).energy]).toEqual([2, 5, 2]);
  },
  encore: () => {
    const r = buy('encore');
    expect(r.events.some((e) => e.type === 'extra_turn_granted')).toBe(true);
    expect(r.state.turn.extraTurn).not.toBeNull();
  },
  conscription: () => {
    const r = buy('conscription', { 0: { cards: ['third-head', 'overclock'] } }).state;
    expect([mon(r, 0).vp, hp(r, 0)]).toEqual([2, 8]);
  },

  // ── 加成類（買牌或下個回合開始時看得出來）──
  'third-head': () => {
    const r = must(
      phase(world(3, { 0: { cards: [] }, 1: { cards: ['third-head'] } }), 'buy'),
      { type: 'endTurn', seat: 0 },
      env,
    );
    expect(r.state.turn.seat).toBe(1);
    expect(r.state.turn.diceCount).toBe(7);
  },
  overclock: () => {
    const s = withDice(world(3, { 0: { cards: ['overclock'] } }), [1, 1, 2, 2, 3, H]);
    s.turn.rollsUsed = s.config.maxRolls;
    expect(legalActions(s, env).some((a) => a.type === 'roll')).toBe(true); // 第 4 次
    s.turn.rollsUsed = s.config.maxRolls + 1;
    expect(legalActions(s, env).some((a) => a.type === 'roll')).toBe(false);
  },
  haggler: () => {
    const r = buy('subway', { 0: { cards: ['haggler'], energy: 10 } });
    expect(mon(r.state, 0).energy).toBe(10 - (def('subway').cost - 1));
    expect(triggered(r.events, 'haggler', 0)).toBe(true);
  },
  resonance: () => {
    const r = buy('power-surge', { 0: { cards: ['resonance'], energy: 10 } });
    expect(mon(r.state, 0).energy).toBe(10 - 7 + 8 + 1);
    expect(triggered(r.events, 'resonance', 0)).toBe(true);
  },
  regrowth: () => {
    const r = buy('first-aid', { 0: { cards: ['regrowth'], hp: 5 } });
    expect(hp(r.state, 0)).toBe(9);
    expect(triggered(r.events, 'regrowth', 0)).toBe(true);
  },
  colossus: () => {
    const r = buy('colossus', { 0: { hp: 8 } }).state;
    expect([mon(r, 0).maxHp, hp(r, 0)]).toEqual([12, 10]);
  },

  // ── 擲骰期 ──
  'lucky-three': () => {
    const s = (cards: string[]) =>
      withDice(world(3, { 0: { cards }, 1: { location: 'city' } }), [3, 1, 2, 3, A, H]);
    const used = { ...s(['lucky-three']) };
    used.turn.rollsUsed = used.config.maxRolls;
    const none = s([]);
    none.turn.rollsUsed = none.config.maxRolls;
    expect(legalActions(used, env).some((a) => a.type === 'roll')).toBe(true);
    expect(legalActions(none, env).some((a) => a.type === 'roll')).toBe(false);
  },
  'twist-of-fate': () => {
    const s = withDice(world(3, { 0: { cards: ['twist-of-fate'] } }), [1, 1, 2, 2, 3, H]);
    const r = must(
      s,
      { type: 'useCard', seat: 0, cardId: 'twist-of-fate', args: { die: 0, face: A } },
      env,
    );
    expect(r.state.turn.dice[0]).toBe(A);
    expect(mon(r.state, 0).cards).toEqual([]); // 用完棄掉
  },
  'flex-limb': () => {
    const s = withDice(world(3, { 0: { cards: ['flex-limb'], energy: 5 } }), [1, 1, 2, 2, 3, H]);
    const r = must(
      s,
      { type: 'useCard', seat: 0, cardId: 'flex-limb', args: { die: 5, face: E } },
      env,
    );
    expect(r.state.turn.dice[5]).toBe(E);
    expect(mon(r.state, 0)).toMatchObject({ energy: 3, cards: ['flex-limb'] });
  },
  shepherd: () => {
    const s = withDice(world(3, { 0: { cards: ['shepherd'] } }), [2, 2, 3, 3, A, H]);
    const r = must(s, { type: 'useCard', seat: 0, cardId: 'shepherd', args: { die: 4 } }, env);
    expect(r.state.turn.dice[4]).toBe(1);
    // 每回合一次
    expect(
      applyAction(r.state, { type: 'useCard', seat: 0, cardId: 'shepherd', args: { die: 5 } }, env)
        .ok,
    ).toBe(false);
  },
  'mind-link': () => {
    const s = withDice(world(3, { 0: { cards: ['mind-link'], energy: 3 } }), [1, 1, 2, 2, 3, H]);
    s.turn.rollsUsed = s.config.maxRolls;
    expect(legalActions(s, env).some((a) => a.type === 'roll')).toBe(false);
    const r = must(s, { type: 'useCard', seat: 0, cardId: 'mind-link' }, env);
    expect(mon(r.state, 0).energy).toBe(2);
    expect(r.events.some((e) => e.type === 'rolls_added' && e.cardId === 'mind-link')).toBe(true);
    expect(legalActions(r.state, env).some((a) => a.type === 'roll')).toBe(true);
  },
  'smoke-bomb': () => {
    let s = withDice(world(3, { 0: { cards: ['smoke-bomb'] } }), [1, 1, 2, 2, 3, H]);
    mon(s, 0).cardData['smoke-bomb'] = { n: 3, ref: null }; // 買下時的充能
    s.turn.rollsUsed = s.config.maxRolls;
    expect(legalActions(s, env).some((a) => a.type === 'roll')).toBe(false);
    for (let i = 1; i <= 3; i += 1) {
      const r = must(s, { type: 'useCard', seat: 0, cardId: 'smoke-bomb' }, env);
      s = r.state;
      expect(s.turn.bonusRolls).toBe(i);
      expect(r.events).toContainEqual({
        type: 'rolls_added',
        seat: 0,
        cardId: 'smoke-bomb',
        amount: 1,
        left: 3 - i,
      });
      expect(r.events.some((e) => e.type === 'card_used' && e.cardId === 'smoke-bomb')).toBe(true);
      // 每多一次充能，就真的多一次擲骰機會
      expect(legalActions(s, env).some((a) => a.type === 'roll')).toBe(true);
    }
    expect(mon(s, 0).cards).toEqual([]); // 3 次用完棄掉
    expect(s.turn.bonusRolls).toBe(3); // 已經換到的次數仍然有效
    expect(legalActions(s, env).some((a) => a.type === 'roll')).toBe(true);
  },
  'mind-reader': () => {
    const s = withDice(world(3, { 1: { cards: ['mind-reader'] } }), [A, A, A, A, A, A]);
    const r = must(s, { type: 'endRolling', seat: 0 }, env);
    expect(r.state.pending).toMatchObject({ kind: 'probe', queue: [1] });
    const after = must(r.state, { type: 'probeDecision', seat: 1, die: 0 }, env);
    expect(after.events.some((e) => e.type === 'die_rerolled' && e.by === 1)).toBe(true);
  },

  // ── 結算期 ──
  'thorn-trio': () => {
    const r = attackWith(['thorn-trio'], [3, 3, 3, E, E, E]);
    expect(hp(r.state, 1)).toBe(8);
    expect(triggered(r.events, 'thorn-trio', 0)).toBe(true);
    const no = attackWith(['thorn-trio'], [3, 3, 2, E, E, E]);
    expect(hp(no.state, 1)).toBe(10);
  },
  feast: () => {
    const r = attackWith(['feast'], [1, 1, 1, E, E, E]);
    expect(mon(r.state, 0).vp).toBe(1 + 2);
    expect(triggered(r.events, 'feast', 0)).toBe(true);
    expect(mon(attackWith(['feast'], [1, 1, 2, E, E, E]).state, 0).vp).toBe(0);
  },
  'full-set': () => {
    const r = attackWith(['full-set'], [1, 2, 3, H, A, E]);
    expect(mon(r.state, 0).vp).toBe(8);
    expect(triggered(r.events, 'full-set', 0)).toBe(true);
    expect(mon(attackWith(['full-set'], [1, 2, 3, H, A, A]).state, 0).vp).toBe(0);
  },
  run: () => {
    const r = attackWith(['run'], [1, 2, 3, E, E, E]);
    expect(mon(r.state, 0).vp).toBe(2);
    expect(triggered(r.events, 'run', 0)).toBe(true);
  },
  ringleader: () => {
    const r = attackWith(['ringleader'], [A, 2, 2, E, E, E]);
    expect(mon(r.state, 0).vp).toBe(1);
    expect(triggered(r.events, 'ringleader', 0)).toBe(true);
    // 沒打到人不算
    const miss = resolveWith(
      world(3, { 0: { cards: ['ringleader'] } }), // 沒人在東京：沒打到人
      [A, 2, 2, E, E, E],
      env,
    );
    expect(triggered(miss.events, 'ringleader')).toBe(false);
  },
  'razor-claw': () => {
    const r = attackWith(['razor-claw'], [A, A, 2, E, E, E]);
    expect(hp(r.state, 1)).toBe(7);
    expect(triggered(r.events, 'razor-claw', 0)).toBe(true);
    expect(hp(attackWith(['razor-claw'], [2, 2, 2, E, E, E]).state, 1)).toBe(10); // 沒擲出 💥 就沒有攻擊
  },
  berserk: () => {
    const r = attackWith(['berserk'], [1, 2, 3, E, E, E]);
    expect(hp(r.state, 1)).toBe(9);
    expect(triggered(r.events, 'berserk', 0)).toBe(true);
  },
  tunnel: () => {
    const mine = attackWith(['tunnel'], [A, 2, 2, E, E, E]);
    expect(hp(mine.state, 1)).toBe(8); // 打東京內：1 + 1
    // 讓位時對接手者造成 1 點傷害
    const held = attackWith([], [A, 2, 2, E, E, E], { 1: { location: 'city', cards: ['tunnel'] } });
    const y = must(held.state, { type: 'yieldDecision', seat: 1, leave: true }, env);
    expect(hp(y.state, 0)).toBe(9);
    expect(triggered(y.events, 'tunnel', 1)).toBe(true);
  },
  'city-lord': () => {
    const state = world(3, { 0: { cards: ['city-lord'], location: 'city' } });
    const r = resolveWith(state, [A, 2, 2, E, E, E], env);
    expect(hp(r.state, 1)).toBe(8);
    expect(triggered(r.events, 'city-lord', 0)).toBe(true);
    const start = must(
      phase({ ...state, turn: { ...state.turn, seat: 2 } }, 'buy'),
      { type: 'endTurn', seat: 2 },
      env,
    );
    expect(mon(start.state, 0).vp).toBe(2 + 1); // 在東京 +2，卡 +1
  },
  scorch: () => {
    const r = attackWith(['scorch'], [A, 2, 2, E, E, E], {}, 4);
    expect([hp(r.state, 1), hp(r.state, 2), hp(r.state, 3)]).toEqual([8, 10, 9]);
    expect(triggered(r.events, 'scorch', 0)).toBe(true);
  },
  shockwave: () => {
    const r = attackWith(['shockwave'], [A, 2, 2, E, E, E]);
    expect([hp(r.state, 1), hp(r.state, 2)]).toEqual([9, 9]);
    expect(triggered(r.events, 'shockwave', 0)).toBe(true);
  },
  menace: () => {
    const r = attackWith(['menace'], [A, 2, 2, E, E, E]);
    expect(r.state.pending).toBeNull();
    expect(mon(r.state, 1).location).toBeNull();
    expect(mon(r.state, 0).location).toBe('city');
    expect(triggered(r.events, 'menace', 0)).toBe(true);
  },

  // ── 防禦 ──
  plating: () => {
    const one = attackWith([], [A, 2, 2, E, E, E], { 1: { location: 'city', cards: ['plating'] } });
    expect(hp(one.state, 1)).toBe(10);
    expect(one.events.some((e) => e.type === 'damage_prevented' && e.cardId === 'plating')).toBe(
      true,
    );
    const two = attackWith([], [A, A, 2, E, E, E], { 1: { location: 'city', cards: ['plating'] } });
    expect(hp(two.state, 1)).toBe(8);
  },
  'mimicry-skin': () => {
    let prevented = false;
    let hit = false;
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = { ...world(3, { 0: {}, 1: { location: 'city', cards: ['mimicry-skin'] } }) };
      state.rng = seed;
      const r = resolveWith(state, [A, A, A, E, E, E], env);
      expect(hp(r.state, 1)).toBeGreaterThanOrEqual(7);
      if (hp(r.state, 1) > 7) prevented = true;
      if (hp(r.state, 1) < 10) hit = true;
    }
    expect(prevented && hit).toBe(true);
  },
  'mirror-scale': () => {
    const r = attackWith([], [A, 2, 2, E, E, E], {
      1: { location: 'city', cards: ['mirror-scale'] },
    });
    expect(hp(r.state, 1)).toBe(9);
    expect(hp(r.state, 0)).toBe(9);
    expect(triggered(r.events, 'mirror-scale', 1)).toBe(true);
  },
  resolve: () => {
    const r = attackWith([], [A, A, 2, E, E, E], { 1: { location: 'city', cards: ['resolve'] } });
    expect(mon(r.state, 1).energy).toBe(1);
    expect(triggered(r.events, 'resolve', 1)).toBe(true);
    const one = attackWith([], [A, 2, 2, E, E, E], { 1: { location: 'city', cards: ['resolve'] } });
    expect(mon(one.state, 1).energy).toBe(0); // 只失去 1 點不算
  },
  'gust-shield': () => {
    const r = attackWith([], [A, A, 2, E, E, E], {
      1: { location: 'city', cards: ['gust-shield'], energy: 5 },
    });
    expect(r.state.pending).toMatchObject({ kind: 'react' });
    const used = must(r.state, { type: 'reactDecision', seat: 1, cardId: 'gust-shield' }, env);
    expect(hp(used.state, 1)).toBe(10);
    expect(mon(used.state, 1).energy).toBe(3);
  },
  sidestep: () => {
    const r = attackWith([], [A, A, 2, E, E, E], {
      1: { location: 'city', cards: ['sidestep'], energy: 3 },
    });
    expect(r.state.pending).toMatchObject({ kind: 'react' });
    const used = must(r.state, { type: 'reactDecision', seat: 1, cardId: 'sidestep' }, env);
    expect(hp(used.state, 1)).toBe(9); // 2 點傷害免除 1 點
    expect(mon(used.state, 1).energy).toBe(2);
  },
  'escape-rocket': () => {
    const r = attackWith([], [A, A, 2, E, E, E], {
      1: { location: 'city', cards: ['escape-rocket'] },
    });
    expect(r.state.pending).toMatchObject({ kind: 'react' });
    const used = must(r.state, { type: 'reactDecision', seat: 1, cardId: 'escape-rocket' }, env);
    expect(hp(used.state, 1)).toBe(10);
    expect(mon(used.state, 1).location).toBeNull();
    expect(mon(used.state, 0).location).toBe('city');
  },
  'body-swap': () => {
    const r = attackWith(['razor-claw'], [A, 2, 2, E, E, E], {
      1: { location: 'city', cards: ['body-swap'] },
    });
    const y = must(
      r.state,
      { type: 'yieldDecision', seat: 1, leave: true, takeCard: 'razor-claw' },
      env,
    );
    expect(mon(y.state, 1).cards).toEqual(['razor-claw']);
    expect(mon(y.state, 0).cards).toEqual(['body-swap']);
  },

  // ── 加害後 ──
  venom: () => {
    const r = attackWith(['venom'], [A, 2, 2, E, E, E]);
    expect(mon(r.state, 1).tokens.poison).toBe(1);
    expect(triggered(r.events, 'venom', 0)).toBe(true);
    // 在他的回合結束時造成 1 點傷害
    const poisoned = world(3, { 1: { tokens: { poison: 2, shrink: 0 } } });
    poisoned.turn.seat = 1;
    const end = must(phase(poisoned, 'buy'), { type: 'endTurn', seat: 1 }, env);
    expect(hp(end.state, 1)).toBe(8);
  },
  shrinker: () => {
    const r = attackWith(['shrinker'], [A, 2, 2, E, E, E]);
    expect(mon(r.state, 1).tokens.shrink).toBe(1);
    expect(triggered(r.events, 'shrinker', 0)).toBe(true);
    const next = must(
      phase(world(3, { 1: { tokens: { poison: 0, shrink: 1 } } }), 'buy'),
      { type: 'endTurn', seat: 0 },
      env,
    );
    expect(next.state.turn.seat).toBe(1);
    expect(next.state.turn.diceCount).toBe(5);
  },
  bloodthirst: () => {
    const r = attackWith(['bloodthirst'], [A, A, 2, E, E, E], { 0: { hp: 5 } });
    expect(hp(r.state, 0)).toBe(6);
    expect(triggered(r.events, 'bloodthirst', 0)).toBe(true);
  },
  undertaker: () => {
    const r = attackWith([], [A, 2, 2, E, E, E], {
      1: { location: 'city', hp: 1 },
      2: { cards: ['undertaker'] },
    });
    expect(mon(r.state, 1).alive).toBe(false);
    expect(mon(r.state, 2).vp).toBe(3);
    expect(triggered(r.events, 'undertaker', 2)).toBe(true);
  },
  'return-egg': () => {
    const r = attackWith([], [A, 2, 2, E, E, E], {
      1: { location: 'city', hp: 1, vp: 7, cards: ['return-egg', 'overclock'] },
    });
    expect(mon(r.state, 1)).toMatchObject({ alive: true, hp: 10, vp: 0, cards: [] });
  },
  'blood-pact': () => {
    const r = attackWith([], [A, 2, 2, E, E, E], {
      1: { location: 'city', hp: 1, vp: 7, cards: ['blood-pact'] },
    });
    expect(mon(r.state, 1)).toMatchObject({ alive: true, hp: 10, vp: 0, sidekickOf: 0 });
  },

  // ── 回合開始／結束、買牌 ──
  'press-office': () => {
    const r = buy('kiosk', { 0: { cards: ['press-office'] } });
    expect(mon(r.state, 0).vp).toBe(1 + 1);
    expect(triggered(r.events, 'press-office', 0)).toBe(true);
  },
  capacitor: () => {
    const r = endOfTurn({ 0: { cards: ['capacitor'], energy: 13 } });
    expect(mon(r.state, 0).vp).toBe(2);
    expect(triggered(r.events, 'capacitor', 0)).toBe(true);
  },
  'solar-panel': () => {
    const r = endOfTurn({ 0: { cards: ['solar-panel'] } });
    expect(mon(r.state, 0).energy).toBe(1);
    expect(triggered(r.events, 'solar-panel', 0)).toBe(true);
    expect(mon(endOfTurn({ 0: { cards: ['solar-panel'], energy: 2 } }).state, 0).energy).toBe(2);
  },
  pacifist: () => {
    const r = endOfTurn({ 0: { cards: ['pacifist'] } });
    expect(mon(r.state, 0).vp).toBe(1);
    expect(triggered(r.events, 'pacifist', 0)).toBe(true);
    const hit = endOfTurn({ 0: { cards: ['pacifist'] } }, (s) => {
      s.turn.damagedAnyone = true;
    });
    expect(mon(hit.state, 0).vp).toBe(0);
  },
  'heavy-hitter': () => {
    const r = endOfTurn({ 0: { cards: ['heavy-hitter'] } }, (s) => {
      s.turn.dealt = 3;
    });
    expect(mon(r.state, 0).vp).toBe(2);
    expect(triggered(r.events, 'heavy-hitter', 0)).toBe(true);
    expect(
      mon(
        endOfTurn({ 0: { cards: ['heavy-hitter'] } }, (s) => {
          s.turn.dealt = 2;
        }).state,
        0,
      ).vp,
    ).toBe(0);
  },
  comeback: () => {
    const r = endOfTurn({ 0: { cards: ['comeback'] }, 1: { vp: 5 }, 2: { vp: 5 } });
    expect(mon(r.state, 0).vp).toBe(1);
    expect(triggered(r.events, 'comeback', 0)).toBe(true);
    const lead = endOfTurn({ 0: { cards: ['comeback'], vp: 6 }, 1: { vp: 5 } });
    expect(mon(lead.state, 0).vp).toBe(6);
  },
  quake: () => {
    const r = endOfTurn({ 0: { cards: ['quake'] } }, (s) => {
      s.turn.vpGained = 4;
    });
    expect(r.state.stomp).toContain(0);
    expect(r.events.some((e) => e.type === 'dice_penalty')).toBe(true);
    expect(triggered(r.events, 'quake', 0)).toBe(true);
  },
  'spare-cells': () => {
    const bought = buy('spare-cells', { 0: { energy: 10 } }).state; // 此測試的 buy 沒帶 energy
    expect(mon(bought, 0).cards).toEqual(['spare-cells']);
    const state = world(3, { 0: { cards: ['spare-cells'] } });
    const m = mon(state, 0);
    m.cardData['spare-cells'] = { n: 3, ref: null };
    const start = must(
      phase({ ...state, turn: { ...state.turn, seat: 2 } }, 'buy'),
      { type: 'endTurn', seat: 2 },
      env,
    );
    expect(start.state.turn.seat).toBe(0);
    expect(mon(start.state, 0).energy).toBe(2);
    expect(mon(start.state, 0).cardData['spare-cells']?.n).toBe(1);
    expect(triggered(start.events, 'spare-cells', 0)).toBe(true);
  },
  chameleon: () => {
    const state = world(3, { 0: { energy: 20 }, 1: { cards: ['razor-claw'] } }, ['chameleon']);
    const r = must(
      phase(state, 'buy'),
      { type: 'buy', seat: 0, cardId: 'chameleon', target: 'razor-claw' },
      env,
    );
    expect(mon(r.state, 0).cardData['chameleon']?.ref).toBe('razor-claw');
    const atk = resolveWith(
      { ...r.state, phase: 'roll', turn: { ...r.state.turn, seat: 0 } } as GameState,
      [A, 2, 2, E, E, E],
      env,
    );
    void atk;
  },
  leech: () => {
    const state = world(3, { 0: { cards: ['leech'], energy: 10 }, 1: { cards: ['razor-claw'] } });
    const r = must(
      phase(state, 'buy'),
      { type: 'buy', seat: 0, cardId: 'razor-claw', from: 1 },
      env,
    );
    expect(mon(r.state, 0).cards).toContain('razor-claw');
    expect(mon(r.state, 1).cards).toEqual([]);
    expect(mon(r.state, 1).energy).toBe(def('razor-claw').cost);
  },
  oracle: () => {
    const state = world(3, { 0: { cards: ['oracle'], energy: 10 } }, [], ['subway']);
    const r = must(phase(state, 'buy'), { type: 'useCard', seat: 0, cardId: 'oracle' }, env);
    expect(r.events).toContainEqual({ type: 'deck_peeked', seat: 0, cardId: 'subway' });
    const b = must(r.state, { type: 'buy', seat: 0, cardId: 'subway', from: 'deck' }, env);
    expect(mon(b.state, 0).vp).toBe(2);
    expect(mon(b.state, 0).energy).toBe(10 - def('subway').cost);
  },
  vulture: () => {
    const state = world(
      3,
      { 0: { energy: 10 }, 1: { cards: ['vulture'], energy: 10 } },
      ['kiosk'],
      ['subway'],
    );
    const r = must(phase(state, 'buy'), { type: 'buy', seat: 0, cardId: 'kiosk' }, env);
    expect(r.state.pending).toMatchObject({ kind: 'opportunity' });
    const take = must(r.state, { type: 'opportunityDecision', seat: 1, buy: true }, env);
    expect(mon(take.state, 1).vp).toBe(2); // 搶先買下新翻開的牌
  },
  'mending-beam': () => {
    const state = world(3, { 0: { cards: ['mending-beam'] }, 1: { hp: 5, energy: 6 } });
    const r = resolveWith(state, [H, H, 1, 2, 3, E], env);
    expect(r.state.pending).toMatchObject({ kind: 'hearts' });
    const d = must(
      r.state,
      {
        type: 'heartsDecision',
        seat: 0,
        self: 0,
        poison: 0,
        shrink: 0,
        others: [{ seat: 1, amount: 2 }],
      },
      env,
    );
    expect(hp(d.state, 1)).toBe(7);
    expect(mon(d.state, 1).energy).toBe(2); // 每點付 2 ⚡
    expect(triggered(d.events, 'mending-beam', 0)).toBe(true);
  },
  disassemble: () => {
    const state = world(3, { 0: { cards: ['disassemble', 'razor-claw'] } });
    const r = must(
      phase(state, 'buy'),
      { type: 'useCard', seat: 0, cardId: 'disassemble', args: { cards: ['razor-claw'] } },
      env,
    );
    expect(mon(r.state, 0).cards).toEqual(['disassemble']);
    expect(mon(r.state, 0).energy).toBe(def('razor-claw').cost);
  },
  'time-rift': () => {
    const r = resolveWith(world(3, { 0: { cards: ['time-rift'] } }), [1, 1, 1, E, E, E], env);
    expect(r.state.phase).toBe('buy');
    const u = must(r.state, { type: 'useCard', seat: 0, cardId: 'time-rift' }, env);
    const e = must(u.state, { type: 'endTurn', seat: 0 }, env);
    expect(e.state.turn.seat).toBe(0);
    expect(e.state.turn.diceCount).toBe(5);
  },
  'quick-mend': () => {
    const state = world(3, { 0: { cards: ['quick-mend'], energy: 5, hp: 5 } });
    const r = must(phase(state, 'buy'), { type: 'useCard', seat: 0, cardId: 'quick-mend' }, env);
    expect([mon(r.state, 0).energy, hp(r.state, 0)]).toEqual([3, 6]);
  },
  'power-nap': () => {
    const state = world(3, { 0: { cards: ['power-nap'], energy: 4 } });
    const r = must(phase(state, 'buy'), { type: 'useCard', seat: 0, cardId: 'power-nap' }, env);
    expect([mon(r.state, 0).energy, mon(r.state, 0).vp]).toEqual([1, 1]);
  },
};

describe('原創卡組逐張檢查', () => {
  it('72 張卡都有對應的檢查（新增卡牌時會在這裡提醒）', () => {
    expect(Object.keys(scenarios).sort()).toEqual(SET.cards.map((c) => c.id).sort());
  });

  for (const c of SET.cards) {
    it(`${c.name}（${c.id}）：${c.text}`, () => {
      const run = scenarios[c.id];
      if (!run) throw new Error(`缺少 ${c.id} 的檢查`);
      run();
    });
  }
});
