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
