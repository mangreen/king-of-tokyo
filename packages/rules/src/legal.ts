import { CAP, mimicTargets } from './cards/effects.js';
import { NO_CARDS } from './cards/types.js';
import type { RulesEnv } from './cards/types.js';
import { pendingSeat, SWEEP_COST } from './engine.js';
import { costFor, effectOf, hasEffect, makeG, ownedOf } from './ops.js';
import type { G, Owned } from './ops.js';
import { aliveMonsters, getMonster } from './state.js';
import { FACES } from './types.js';
import type { Action, GameState, UseArgs } from './types.js';

/** 現在輪到誰做決定（遊戲結束為 null）。 */
export function currentActor(state: GameState): number | null {
  switch (state.phase) {
    case 'roll':
    case 'buy':
      return state.turn.seat;
    case 'prompt':
      return pendingSeat(state.pending);
    case 'over':
      return null;
  }
}

/** 逾時或機器人補位時使用的「最保守」動作：不花資源、不做額外選擇。 */
export function defaultAction(state: GameState): Action | null {
  const seat = currentActor(state);
  if (seat === null) {
    return null;
  }
  switch (state.phase) {
    case 'roll':
      return state.turn.rollsUsed === 0
        ? { type: 'roll', seat, keep: [] }
        : { type: 'endRolling', seat };
    case 'buy':
      return { type: 'endTurn', seat };
    case 'prompt': {
      const p = state.pending;
      if (!p) return null;
      switch (p.kind) {
        case 'yield':
          return { type: 'yieldDecision', seat, leave: false };
        case 'react':
          return { type: 'reactDecision', seat, cardId: null };
        case 'hearts':
          return {
            type: 'heartsDecision',
            seat,
            self: p.hearts,
            poison: 0,
            shrink: 0,
            others: [],
          };
        case 'probe':
          return { type: 'probeDecision', seat, die: null };
        case 'opportunity':
          return { type: 'opportunityDecision', seat, buy: false };
      }
    }
  }
  return null;
}

function candidateArgs(g: G, o: Owned): UseArgs[] {
  const dice = g.s.turn.dice;
  switch (o.def.effectId) {
    case 'die_change': {
      const out: UseArgs[] = [];
      for (let die = 0; die < dice.length; die += 1) {
        for (const face of FACES) {
          if (dice[die] !== face) out.push({ die, face });
        }
      }
      return out;
    }
    case CAP.mimic:
      return mimicTargets(g).map((target) => ({ target }));
    case 'metamorph':
      return getMonster(g.s, o.seat).cards.map((id) => ({ cards: [id] }));
    default:
      return [{}];
  }
}

function useActions(g: G, seat: number): Action[] {
  const s = g.s;
  const actions: Action[] = [];
  const asked = s.phase === 'prompt' && pendingSeat(s.pending) === seat;
  const actor = seat === s.turn.seat;
  for (const o of ownedOf(g, seat)) {
    const a = effectOf(o.def)?.active;
    const base = o.base;
    const mimicSwitch =
      base.effectId === CAP.mimic && s.phase === 'roll' && actor && s.turn.rollsUsed === 0;
    if (mimicSwitch) {
      const mimic = effectOf(base)?.active;
      if (mimic?.available(g, { ...o, def: base })) {
        for (const args of candidateArgs(g, { ...o, def: base })) {
          if (!mimic.check || mimic.check(g, { ...o, def: base }, args) === null) {
            actions.push({ type: 'useCard', seat, cardId: o.cardId, args });
          }
        }
      }
    }
    if (!a) continue;
    const timing =
      (a.when === 'start' && s.phase === 'roll' && actor && s.turn.rollsUsed === 0) ||
      (a.when === 'rolled' && s.phase === 'roll' && actor && s.turn.rollsUsed >= 1) ||
      (a.when === 'buy' && s.phase === 'buy' && actor) ||
      (a.when === 'free' && ((actor && (s.phase === 'roll' || s.phase === 'buy')) || asked));
    if (!timing || !a.available(g, o) || o.def.effectId === CAP.mimic) continue;
    for (const args of candidateArgs(g, o)) {
      if (!a.check || a.check(g, o, args) === null) {
        actions.push({ type: 'useCard', seat, cardId: o.cardId, args });
      }
    }
  }
  return actions;
}

/**
 * 目前所有合法動作（保留骰子的每一種組合都列出）。供機器人、測試與 UI 提示使用。
 * 有卡牌時需傳入 env；少數需要額外參數的動作只列出代表性的選項。
 */
export function legalActions(state: GameState, env: RulesEnv = NO_CARDS): Action[] {
  const seat = currentActor(state);
  if (seat === null) {
    return [];
  }
  const g = makeG(state, env, []);
  const s = state;
  const actions: Action[] = [];

  if (s.phase === 'prompt') {
    const p = s.pending;
    if (!p) return [];
    switch (p.kind) {
      case 'yield': {
        const swap = ownedOf(g, seat).find((o) => o.def.effectId === CAP.swapOnYield);
        actions.push({ type: 'yieldDecision', seat, leave: true });
        actions.push({ type: 'yieldDecision', seat, leave: false });
        if (swap) {
          for (const takeCard of getMonster(s, p.attacker).cards) {
            actions.push({ type: 'yieldDecision', seat, leave: true, takeCard });
          }
        }
        break;
      }
      case 'react': {
        actions.push({ type: 'reactDecision', seat, cardId: null });
        const item = p.plan[p.index];
        if (item) {
          for (const o of ownedOf(g, seat)) {
            if (effectOf(o.def)?.reaction?.available(g, o, item, p.attacker)) {
              actions.push({ type: 'reactDecision', seat, cardId: o.cardId });
            }
          }
        }
        break;
      }
      case 'hearts': {
        const me = getMonster(s, seat);
        const cure = me.location === null;
        for (let self = 0; self <= p.hearts; self += 1) {
          const rest = p.hearts - self;
          actions.push({ type: 'heartsDecision', seat, self, poison: 0, shrink: 0, others: [] });
          if (cure && rest > 0) {
            const poison = Math.min(rest, me.tokens.poison);
            const shrink = Math.min(rest - poison, me.tokens.shrink);
            if (poison + shrink > 0) {
              actions.push({ type: 'heartsDecision', seat, self, poison, shrink, others: [] });
            }
          }
          if (hasEffect(g, seat, CAP.healingRay) && rest > 0) {
            for (const other of aliveMonsters(s)) {
              const missing = other.maxHp - other.hp;
              if (other.seat !== seat && missing > 0 && other.energy >= 1) {
                actions.push({
                  type: 'heartsDecision',
                  seat,
                  self,
                  poison: 0,
                  shrink: 0,
                  others: [{ seat: other.seat, amount: Math.min(rest, missing) }],
                });
              }
            }
          }
        }
        break;
      }
      case 'probe':
        actions.push({ type: 'probeDecision', seat, die: null });
        for (let die = 0; die < s.turn.dice.length; die += 1) {
          actions.push({ type: 'probeDecision', seat, die });
        }
        break;
      case 'opportunity':
        actions.push({ type: 'opportunityDecision', seat, buy: false });
        actions.push({ type: 'opportunityDecision', seat, buy: true });
        break;
    }
    actions.push(...useActions(g, seat));
    return actions;
  }

  if (s.phase === 'buy') {
    actions.push({ type: 'endTurn', seat });
    const me = getMonster(s, seat);
    if (s.market) {
      if (me.energy >= SWEEP_COST) actions.push({ type: 'sweep', seat });
      for (const cardId of s.market.faceUp) {
        const def = env.cards[cardId];
        if (!def || me.energy < costFor(g, seat, def)) continue;
        if (def.effectId === CAP.mimic) {
          const targets = mimicTargets(g);
          if (targets.length === 0) actions.push({ type: 'buy', seat, cardId });
          for (const target of targets) actions.push({ type: 'buy', seat, cardId, target });
        } else if (def.effectId === 'batteries') {
          const spare = me.energy - costFor(g, seat, def);
          for (const energy of new Set([0, Math.min(2, spare), spare])) {
            actions.push({ type: 'buy', seat, cardId, energy });
          }
        } else {
          actions.push({ type: 'buy', seat, cardId });
        }
      }
      const peek = s.turn.peek;
      const peeked = peek ? env.cards[peek] : undefined;
      if (peek && peeked && me.energy >= costFor(g, seat, peeked)) {
        actions.push({ type: 'buy', seat, cardId: peek, from: 'deck' });
      }
      if (hasEffect(g, seat, CAP.buyFromOthers)) {
        for (const other of aliveMonsters(s)) {
          if (other.seat === seat) continue;
          for (const cardId of other.cards) {
            const def = env.cards[cardId];
            if (def && def.kind === 'keep' && me.energy >= costFor(g, seat, def)) {
              actions.push({ type: 'buy', seat, cardId, from: other.seat });
            }
          }
        }
      }
    }
    actions.push(...useActions(g, seat));
    return actions;
  }

  // roll
  const { rollsUsed, dice, diceCount } = s.turn;
  if (rollsUsed === 0) {
    actions.push({ type: 'roll', seat, keep: [] });
    actions.push(...useActions(g, seat));
    return actions;
  }
  actions.push({ type: 'endRolling', seat });
  let limit = s.config.maxRolls + s.turn.bonusRolls;
  for (const o of ownedOf(g, seat)) {
    limit += effectOf(o.def)?.extraRolls?.(o) ?? 0;
  }
  const n = diceCount;
  if (rollsUsed < limit) {
    // 每一種「保留哪些骰子」的組合（不含全部保留）
    for (let mask = 0; mask < (1 << n) - 1; mask += 1) {
      const keep: number[] = [];
      for (let i = 0; i < n; i += 1) {
        if (mask & (1 << i)) {
          keep.push(i);
        }
      }
      actions.push({ type: 'roll', seat, keep });
    }
  } else if (hasEffect(g, seat, CAP.rerollThrees) && dice.some((f) => f === 3)) {
    actions.push({ type: 'roll', seat, keep: dice.flatMap((f, i) => (f === 3 ? [] : [i])) });
  }
  actions.push(...useActions(g, seat));
  return actions;
}
