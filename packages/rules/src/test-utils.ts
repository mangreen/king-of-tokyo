/** 測試用工具（不從 index 匯出）。 */
import { applyAction } from './engine.js';
import type { CardCatalog, CardDef, RulesEnv } from './cards/types.js';
import { cloneState, createGame, defaultConfig, newTurn } from './state.js';
import type { Action, Face, GameEvent, GameState, Monster } from './types.js';

export interface MakeStateOptions {
  players: number;
  /** 先手座位，也是目前回合的座位。預設 0。 */
  firstSeat?: number;
  /** 目前回合的座位。預設等於 firstSeat。 */
  turnSeat?: number;
  monsters?: Record<number, Partial<Monster>>;
  round?: number;
  seed?: number;
  /** 卡牌目錄；提供時商店以 faceUp／deck 指定。 */
  env?: RulesEnv;
  faceUp?: string[];
  deck?: string[];
}

/** 測試用卡牌：只需指定 effectId，其餘用預設值。 */
export function card(id: string, effectId: string, extra: Partial<CardDef> = {}): CardDef {
  return {
    id,
    name: id,
    cost: 3,
    kind: effectId === 'instant' ? 'discard' : 'keep',
    text: '',
    effectId,
    params: {},
    ...extra,
  };
}

export function makeEnv(...defs: CardDef[]): RulesEnv {
  const cards: Record<string, CardDef> = {};
  for (const d of defs) cards[d.id] = d;
  return { cards: cards as CardCatalog };
}

/** 建立指定情境的狀態（不經過先手擲骰）。 */
export function makeState(opts: MakeStateOptions): GameState {
  const state = cloneState(createGame(defaultConfig(opts.players), opts.seed ?? 1, opts.env).state);
  if (opts.env && state.market) {
    state.market.faceUp = [...(opts.faceUp ?? [])];
    state.market.deck = [...(opts.deck ?? [])];
    state.market.discard = [];
  }
  const first = opts.firstSeat ?? 0;
  state.firstSeat = first;
  state.round = opts.round ?? 1;
  state.turn = newTurn(opts.turnSeat ?? first, state.config.diceCount);
  for (const [seat, patch] of Object.entries(opts.monsters ?? {})) {
    const monster = state.monsters[Number(seat)];
    if (!monster) throw new Error(`座位 ${seat} 不存在`);
    Object.assign(monster, patch);
    for (const id of monster.cards) {
      monster.cardData[id] ??= { n: 0, ref: null };
    }
  }
  return state;
}

/** 指定目前回合的骰面（視為已擲過一次），之後 endRolling 會走真正的結算流程。 */
export function withDice(state: GameState, dice: Face[]): GameState {
  const next = cloneState(state);
  next.turn.dice = [...dice];
  next.turn.diceCount = dice.length;
  next.turn.rollsUsed = 1;
  return next;
}

export function must(
  state: GameState,
  action: Action,
  env?: RulesEnv,
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action, env);
  if (!result.ok) {
    throw new Error(`動作被拒絕：${result.error}`);
  }
  return { state: result.state, events: result.events };
}

/** 以指定骰面結算目前回合。 */
export function resolveWith(
  state: GameState,
  dice: Face[],
  env?: RulesEnv,
): { state: GameState; events: GameEvent[] } {
  const seat = state.turn.seat;
  return must(withDice(state, dice), { type: 'endRolling', seat }, env);
}

/** 讓位詢問中尚未決定的座位。 */
export function yieldQueue(state: GameState): number[] {
  return state.pending?.kind === 'yield' ? state.pending.queue : [];
}

export function eventTypes(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.type);
}

export function mon(state: GameState, seat: number): Monster {
  const m = state.monsters[seat];
  if (!m) throw new Error(`座位 ${String(seat)} 不存在`);
  return m;
}

/** 每種效果各一張（部分有兩張不同參數），用來讓機器人把所有路徑都跑過。 */
export function fullEnv(): RulesEnv {
  const ins = (id: string, cost: number, ...ops: object[]) =>
    card(id, 'instant', { cost, params: { ops: ops as never } });
  return makeEnv(
    ins('i-vp', 4, { op: 'vp', n: 4 }),
    ins('i-vp2', 2, { op: 'vp', n: 1 }),
    ins('i-energy', 6, { op: 'energy', n: 9 }),
    ins('i-heal', 3, { op: 'heal', n: 2 }),
    ins('i-blast', 3, { op: 'damageOthers', n: 2 }),
    ins('i-bomb', 4, { op: 'damageAll', n: 3 }),
    ins('i-jet', 5, { op: 'vp', n: 5 }, { op: 'selfDamage', n: 4 }),
    ins('i-evac', 7, { op: 'othersLoseVp', n: 5 }),
    ins('i-storm', 6, { op: 'vp', n: 2 }, { op: 'othersLoseEnergyPer', per: 2 }),
    ins('i-drop', 5, { op: 'vp', n: 2 }, { op: 'takeTokyo' }),
    ins('i-extra-turn', 7, { op: 'extraTurn' }),
    ins('i-army', 2, { op: 'perCard', vp: 1, damage: 1 }),
    card('extra-dice', 'extra_dice', { cost: 7 }),
    card('extra-rolls', 'extra_rolls', { cost: 5 }),
    card('discount', 'cost_discount', { cost: 3 }),
    card('k-energy-bonus', 'energy_bonus', { cost: 3 }),
    card('regen', 'heal_bonus', { cost: 4 }),
    card('bigger', 'max_hp', { cost: 4, params: { n: 2 } }),
    card('threes', 'reroll_threes', { cost: 4 }),
    card('plot', 'die_change', { cost: 3, params: { cost: 0, to: 'any', discard: true } }),
    card('stretchy', 'die_change', { cost: 3, params: { cost: 2, to: 'any' } }),
    card('culler', 'die_change', { cost: 3, params: { cost: 0, to: 1, once: true } }),
    card('k-reroll-energy', 'reroll_energy', { cost: 4, params: { cost: 1 } }),
    card('smoke', 'reroll_charges', { cost: 4, params: { charges: 3 } }),
    card('probe', 'probe', { cost: 3 }),
    card('quills', 'triple_bonus', { cost: 3, params: { face: 2, damage: 2 } }),
    card('gourmet', 'triple_bonus', { cost: 4, params: { face: 1, vp: 2 } }),
    card('destruction', 'complete_set', { cost: 3, params: { vp: 9 } }),
    card('omni', 'straight_vp', { cost: 4, params: { vp: 2 } }),
    card('alpha', 'attack_vp', { cost: 5, params: { vp: 1 } }),
    card('tail', 'attack_bonus', { cost: 5, params: { n: 1 } }),
    card('acid', 'attack_bonus', { cost: 6, params: { n: 1, always: true } }),
    card('burrow', 'tokyo_target_bonus', { cost: 5, params: { n: 1, yieldDamage: 1 } }),
    card('k-tokyo-attacker', 'tokyo_attacker', { cost: 4 }),
    card('breath', 'neighbor_damage', { cost: 4 }),
    card('nova', 'nova', { cost: 7 }),
    card('roar', 'forced_yield', { cost: 3 }),
    card('armor', 'armor', { cost: 4 }),
    card('camo', 'camouflage', { cost: 3 }),
    card('hide', 'reflect', { cost: 6 }),
    card('stronger', 'lose_hp_energy', { cost: 3 }),
    card('wings', 'wings', { cost: 6 }),
    card('jump', 'super_jump', { cost: 4 }),
    card('jets', 'jets', { cost: 5 }),
    card('dna', 'swap_on_yield', { cost: 3 }),
    card('poison', 'counter_attack', { cost: 4, params: { counter: 'poison' } }),
    card('shrink', 'counter_attack', { cost: 6, params: { counter: 'shrink' } }),
    card('cannibal', 'lifesteal', { cost: 5 }),
    card('eater', 'death_vp', { cost: 4, params: { vp: 3 } }),
    card('child', 'revive_self', { cost: 7, params: { hp: 10 } }),
    card('sidekick', 'revive_partner', { cost: 4, params: { hp: 10 } }),
    card('news', 'vp_on_buy', { cost: 3 }),
    card('hoarder', 'end_energy_vp', { cost: 3, params: { per: 6, vp: 1 } }),
    card('solar', 'end_empty_energy', { cost: 2 }),
    card('k-peaceful', 'end_peaceful_vp', { cost: 5 }),
    card('tanker', 'big_hit_vp', { cost: 4, params: { min: 3, vp: 2 } }),
    card('k-underdog', 'end_underdog', { cost: 3 }),
    card('stomp', 'stomp', { cost: 3, params: { min: 4 } }),
    card('batteries', 'batteries', { cost: 2 }),
    card('mimic', 'mimic', { cost: 8 }),
    card('parasite', 'buy_from_others', { cost: 4 }),
    card('lab', 'peek_buy', { cost: 2 }),
    card('opportunist', 'opportunist', { cost: 3 }),
    card('ray', 'heal_others', { cost: 4 }),
    card('metamorph', 'metamorph', { cost: 3 }),
    card('freeze', 'extra_turn_triple', { cost: 5, params: { penalty: 1 } }),
    card('rapid', 'rapid_heal', { cost: 3, params: { cost: 2, heal: 1 } }),
    card('sleep', 'energy_to_vp', { cost: 3, params: { cost: 3, vp: 1 } }),
  );
}
