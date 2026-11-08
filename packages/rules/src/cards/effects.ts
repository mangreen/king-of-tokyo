/**
 * 卡牌效果登錄表。每個 effectId 是一個通用、由參數驅動的效果；卡牌資料（卡組）只負責挑選
 * effectId 與參數（ADR-0004、ADR-0006）。這裡不提到任何具體卡名。
 */
import { rollDie } from '../dice.js';
import {
  addCounter,
  cardDef,
  discardCard,
  effectOf,
  cardDamage,
  gainEnergy,
  gainVp,
  heal,
  inflict,
  leaveTokyo,
  loseVp,
  num,
  ownedOf,
  reshuffleIfEmpty,
  spendEnergy,
  syncMaxHp,
  takeCity,
} from '../ops.js';
import type { G, Owned } from '../ops.js';
import { aliveMonsters, getMonster } from '../state.js';
import { FACES } from '../types.js';
import type { DamageCause, ErrorCode, Face, PlanItem, UseArgs } from '../types.js';
import type { CardDef, CardKind, InstantOp } from './types.js';

/** 攻擊結算期間由「攻擊者的卡」逐步修改的內容。 */
export interface AttackCtx {
  attacker: number;
  /** 骰面攻擊數。 */
  faces: number;
  counts: Readonly<Record<string, number>>;
  /** 額外傷害（只在有攻擊時生效）。 */
  bonus: number;
  /** 即使沒有攻擊面也構成攻擊。 */
  always: boolean;
  /** 對東京內目標的額外傷害。 */
  tokyoBonus: number;
  /** 傷害所有其他怪獸。 */
  nova: boolean;
  /** 鄰座額外傷害。 */
  neighbor: number;
}

export interface DiceInfo {
  dice: readonly Face[];
  counts: Readonly<Record<string, number>>;
}

export interface BuyArgs {
  energy?: number | undefined;
  target?: string | undefined;
  /** 實際付出的費用（引擎在呼叫前算好）。 */
  cost: number;
}

export interface DamagedInfo {
  amount: number;
  source: number | null;
  cause: DamageCause | undefined;
  noReflect: boolean;
}

export interface Effect {
  kind: CardKind;
  /** 卡牌參數中必須存在的 key（卡組驗證用）。 */
  requiredParams?: string[];
  initialCharges?: (def: CardDef) => number;

  // ── 靜態修正 ──
  extraDice?: (o: Owned) => number;
  extraRolls?: (o: Owned) => number;
  costDelta?: (o: Owned) => number;
  maxHpBonus?: (o: Owned) => number;
  energyBonus?: (o: Owned) => number;
  healBonus?: (o: Owned) => number;
  /** 'self'：復活（棄所有卡）；'partner'：被擊殺時與擊殺者結為搭檔。 */
  revive?: 'self' | 'partner';

  // ── 觸發 ──
  validateBuy?: (g: G, o: Owned, args: BuyArgs) => ErrorCode | null;
  onBuy?: (g: G, o: Owned, args: BuyArgs) => void;
  onLeave?: (g: G, o: Owned) => void;
  onTurnStart?: (g: G, o: Owned) => void;
  onTurnEnd?: (g: G, o: Owned) => void;
  onAnyTurnEnd?: (g: G, o: Owned) => void;
  onDice?: (g: G, o: Owned, d: DiceInfo) => void;
  onCardBought?: (g: G, o: Owned) => void;
  attack?: (g: G, o: Owned, a: AttackCtx) => void;
  onAttack?: (g: G, o: Owned, a: AttackCtx, targets: number[]) => void;
  mitigatePre?: (g: G, o: Owned, amount: number) => number;
  mitigatePost?: (g: G, o: Owned, amount: number) => number;
  onDamaged?: (g: G, o: Owned, info: DamagedInfo) => void;
  onDealt?: (
    g: G,
    o: Owned,
    info: { victim: number; amount: number; cause: DamageCause | undefined },
  ) => void;
  onAnyZero?: (g: G, o: Owned, victim: number) => void;
  onYield?: (g: G, o: Owned, info: { taker: number }) => void;

  /** 被骰面攻擊時、扣血前可使用的反應。use 回傳 'left' 表示已讓位（不再受傷）。 */
  reaction?: {
    available: (g: G, o: Owned, item: PlanItem, attacker: number) => boolean;
    use: (g: G, o: Owned, item: PlanItem, attacker: number) => 'left' | undefined;
  };

  /** 主動能力。when：start＝擲骰前、rolled＝已擲骰未結算、buy＝買牌階段、free＝以上任一或被詢問時。 */
  active?: {
    when: 'start' | 'rolled' | 'buy' | 'free';
    available: (g: G, o: Owned) => boolean;
    check?: (g: G, o: Owned, args: UseArgs) => ErrorCode | null;
    use: (g: G, o: Owned, args: UseArgs) => void;
  };
}

/** 引擎以 effectId 直接辨識的「能力開關」。 */
export const CAP = {
  mimic: 'mimic',
  buyFromOthers: 'buy_from_others',
  peekBuy: 'peek_buy',
  opportunist: 'opportunist',
  probe: 'probe',
  healingRay: 'heal_others',
  swapOnYield: 'swap_on_yield',
  rerollThrees: 'reroll_threes',
  forcedYield: 'forced_yield',
} as const;

function healRaw(g: G, seat: number, amount: number): void {
  const m = getMonster(g.s, seat);
  const actual = Math.min(amount, m.maxHp - m.hp);
  if (actual > 0 && m.alive) {
    m.hp += actual;
    g.ev.push({ type: 'healed', seat, amount: actual });
  }
}

function used(g: G, o: Owned): boolean {
  return g.s.turn.used.includes(o.cardId);
}

function markUsed(g: G, o: Owned): void {
  g.s.turn.used.push(o.cardId);
  g.ev.push({ type: 'card_used', seat: o.seat, cardId: o.cardId });
}

// ── Discard 卡的即時效果 ──────────────────────────────────

function runOp(g: G, seat: number, op: InstantOp): void {
  const me = getMonster(g.s, seat);
  if (g.s.phase === 'over') {
    return;
  }
  switch (op.op) {
    case 'vp':
      gainVp(g, seat, op.n, 'card');
      return;
    case 'energy':
      gainEnergy(g, seat, op.n, 'card');
      return;
    case 'heal':
      heal(g, seat, op.n);
      return;
    case 'selfDamage':
      inflict(g, seat, op.n, null, 'self');
      return;
    case 'damageOthers':
      for (const m of aliveMonsters(g.s)) {
        if (m.seat !== seat) cardDamage(g, seat, m.seat, op.n);
      }
      return;
    case 'damageAll':
      for (const m of aliveMonsters(g.s)) {
        cardDamage(g, seat, m.seat, op.n);
      }
      return;
    case 'othersLoseVp':
      for (const m of aliveMonsters(g.s)) {
        if (m.seat !== seat) loseVp(g, m.seat, op.n);
      }
      return;
    case 'othersLoseEnergyPer':
      for (const m of aliveMonsters(g.s)) {
        if (m.seat !== seat) spendEnergy(g, m.seat, Math.floor(m.energy / op.per));
      }
      return;
    case 'takeTokyo':
      takeCity(g, seat);
      return;
    case 'extraTurn':
      // 只有自己的回合才有「再一個回合」可言（R-CARD-56）
      if (seat === g.s.turn.seat && me.alive && g.s.turn.extraTurn === null) {
        g.s.turn.extraTurn = { dicePenalty: 0 };
        g.ev.push({ type: 'extra_turn_granted', seat });
      }
      return;
    case 'perCard': {
      const count = me.cards.length;
      gainVp(g, seat, op.vp * count, 'card');
      inflict(g, seat, op.damage * count, null, 'self');
      return;
    }
  }
}

// ── 複製 ────────────────────────────────────────────────

/** 可被複製的 Keep 卡：任何存活怪獸持有、不是複製卡本身。 */
export function mimicTargets(g: G): string[] {
  const out: string[] = [];
  for (const m of aliveMonsters(g.s)) {
    for (const id of m.cards) {
      const def = g.env.cards[id];
      if (def && def.kind === 'keep' && def.effectId !== CAP.mimic) {
        out.push(id);
      }
    }
  }
  return out;
}

function pickDieFace(args: UseArgs, to: unknown): Face | null {
  if (typeof to === 'number') {
    return to as Face;
  }
  const face = args.face;
  return face !== undefined && FACES.includes(face) ? face : null;
}

// ── 登錄表 ──────────────────────────────────────────────

export const EFFECTS: Record<string, Effect> = {
  instant: {
    kind: 'discard',
    requiredParams: ['ops'],
    onBuy(g, o) {
      const ops = o.def.params['ops'];
      if (!Array.isArray(ops)) return;
      for (const op of ops) {
        if (!getMonster(g.s, o.seat).alive) break;
        runOp(g, o.seat, op);
      }
    },
  },

  // ── 靜態修正 ──
  extra_dice: { kind: 'keep', extraDice: (o) => num(o.def, 'n', 1) },
  extra_rolls: { kind: 'keep', extraRolls: (o) => num(o.def, 'n', 1) },
  cost_discount: { kind: 'keep', costDelta: (o) => -num(o.def, 'n', 1) },
  energy_bonus: { kind: 'keep', energyBonus: (o) => num(o.def, 'n', 1) },
  heal_bonus: { kind: 'keep', healBonus: (o) => num(o.def, 'n', 1) },
  max_hp: {
    kind: 'keep',
    requiredParams: ['n'],
    maxHpBonus: (o) => num(o.def, 'n', 2),
    onBuy(g, o) {
      healRaw(g, o.seat, num(o.def, 'healOnBuy', num(o.def, 'n', 2)));
    },
  },

  // ── 擲骰期 ──
  reroll_threes: { kind: 'keep' },
  die_change: {
    kind: 'keep',
    active: {
      when: 'rolled',
      available(g, o) {
        const cost = num(o.def, 'cost', 0);
        const once = o.def.params['once'] === true;
        return (
          getMonster(g.s, o.seat).energy >= cost &&
          !(once && used(g, o)) &&
          g.s.turn.dice.length > 0
        );
      },
      check(g, o, args) {
        const i = args.die;
        if (i === undefined || !Number.isInteger(i) || i < 0 || i >= g.s.turn.dice.length) {
          return 'invalid_action';
        }
        return pickDieFace(args, o.def.params['to']) === null ? 'invalid_action' : null;
      },
      use(g, o, args) {
        const face = pickDieFace(args, o.def.params['to']) as Face;
        const index = args.die as number;
        spendEnergy(g, o.seat, num(o.def, 'cost', 0));
        g.s.turn.dice[index] = face;
        g.ev.push({ type: 'die_changed', seat: o.seat, index, face });
        markUsed(g, o);
        if (o.def.params['discard'] === true) {
          discardCard(g, o.seat, o.cardId, 'used');
        }
      },
    },
  },
  reroll_energy: {
    kind: 'keep',
    active: {
      when: 'rolled',
      available: (g, o) => getMonster(g.s, o.seat).energy >= num(o.def, 'cost', 1),
      use(g, o) {
        spendEnergy(g, o.seat, num(o.def, 'cost', 1));
        g.s.turn.bonusRolls += 1;
        g.ev.push({ type: 'card_used', seat: o.seat, cardId: o.cardId });
      },
    },
  },
  reroll_charges: {
    kind: 'keep',
    initialCharges: (def) => num(def, 'charges', 3),
    active: {
      when: 'rolled',
      available: (g, o) => (getMonster(g.s, o.seat).cardData[o.cardId]?.n ?? 0) > 0,
      use(g, o) {
        const data = getMonster(g.s, o.seat).cardData[o.cardId];
        if (!data) return;
        data.n -= 1;
        g.s.turn.bonusRolls += 1;
        g.ev.push({ type: 'card_used', seat: o.seat, cardId: o.cardId });
        if (data.n <= 0) {
          discardCard(g, o.seat, o.cardId, 'spent');
        }
      },
    },
  },
  // 重擲他人骰子、買牌能力等「能力開關」：行為在引擎流程中，以 effectId 辨識
  probe: { kind: 'keep' },

  // ── 結算期 ──
  triple_bonus: {
    kind: 'keep',
    requiredParams: ['face'],
    onDice(g, o, d) {
      const face = num(o.def, 'face', 1);
      if ((d.counts[String(face)] ?? 0) >= 3) {
        gainVp(g, o.seat, num(o.def, 'vp', 0), 'card');
      }
    },
    attack(_g, o, a) {
      const dmg = num(o.def, 'damage', 0);
      if (dmg > 0 && (a.counts[String(num(o.def, 'face', 1))] ?? 0) >= 3) {
        a.always = true;
        a.bonus += dmg;
      }
    },
  },
  complete_set: {
    kind: 'keep',
    requiredParams: ['vp'],
    onDice(g, o, d) {
      if (FACES.every((f) => (d.counts[String(f)] ?? 0) > 0)) {
        gainVp(g, o.seat, num(o.def, 'vp', 9), 'card');
      }
    },
  },
  straight_vp: {
    kind: 'keep',
    requiredParams: ['vp'],
    onDice(g, o, d) {
      if ((d.counts['1'] ?? 0) > 0 && (d.counts['2'] ?? 0) > 0 && (d.counts['3'] ?? 0) > 0) {
        gainVp(g, o.seat, num(o.def, 'vp', 2), 'card');
      }
    },
  },

  // ── 攻擊者 ──
  attack_vp: {
    kind: 'keep',
    requiredParams: ['vp'],
    onAttack(g, o, a, targets) {
      if (a.faces > 0 && targets.length > 0) {
        gainVp(g, o.seat, num(o.def, 'vp', 1), 'card');
      }
    },
  },
  attack_bonus: {
    kind: 'keep',
    requiredParams: ['n'],
    attack(_g, o, a) {
      a.bonus += num(o.def, 'n', 1);
      if (o.def.params['always'] === true) {
        a.always = true;
      }
    },
  },
  tokyo_target_bonus: {
    kind: 'keep',
    attack(_g, o, a) {
      a.tokyoBonus += num(o.def, 'n', 1);
    },
    onYield(g, o, info) {
      const dmg = num(o.def, 'yieldDamage', 1);
      if (dmg > 0) {
        inflict(g, info.taker, dmg, o.seat, 'yield');
      }
    },
  },
  tokyo_attacker: {
    kind: 'keep',
    onTurnStart(g, o) {
      if (getMonster(g.s, o.seat).location !== null) {
        gainVp(g, o.seat, num(o.def, 'startVp', 1), 'card');
      }
    },
    attack(g, o, a) {
      if (getMonster(g.s, o.seat).location !== null) {
        a.bonus += num(o.def, 'damage', 1);
      }
    },
  },
  neighbor_damage: {
    kind: 'keep',
    attack(_g, o, a) {
      a.neighbor += num(o.def, 'n', 1);
    },
  },
  nova: {
    kind: 'keep',
    attack(_g, _o, a) {
      a.nova = true;
    },
  },
  forced_yield: { kind: 'keep' },

  // ── 受害者 ──
  armor: {
    kind: 'keep',
    mitigatePre: (_g, o, amount) => (amount <= num(o.def, 'max', 1) ? 0 : amount),
  },
  camouflage: {
    kind: 'keep',
    mitigatePost(g, _o, amount) {
      let remaining = amount;
      for (let i = 0; i < amount; i += 1) {
        const [face, rng] = rollDie(g.s.rng);
        g.s.rng = rng;
        if (face === 'heal') {
          remaining -= 1;
        }
      }
      return remaining;
    },
  },
  reflect: {
    kind: 'keep',
    onDamaged(g, o, info) {
      if (
        info.source !== null &&
        info.source !== o.seat &&
        info.cause !== 'reflect' &&
        !info.noReflect
      ) {
        inflict(g, info.source, num(o.def, 'n', 1), o.seat, 'reflect', { noReflect: true });
      }
    },
  },
  lose_hp_energy: {
    kind: 'keep',
    onDamaged(g, o, info) {
      if (info.amount >= num(o.def, 'min', 2)) {
        gainEnergy(g, o.seat, num(o.def, 'energy', 1), 'card');
      }
    },
  },
  wings: {
    kind: 'keep',
    reaction: {
      available: (g, o, item) =>
        item.amount > 0 &&
        !g.s.turn.shielded.includes(o.seat) &&
        getMonster(g.s, o.seat).energy >= num(o.def, 'cost', 2),
      use(g, o) {
        spendEnergy(g, o.seat, num(o.def, 'cost', 2));
        g.s.turn.shielded.push(o.seat);
        g.ev.push({ type: 'card_used', seat: o.seat, cardId: o.cardId });
        return undefined;
      },
    },
  },
  super_jump: {
    kind: 'keep',
    reaction: {
      available: (g, o, item) =>
        item.amount > 0 && !used(g, o) && getMonster(g.s, o.seat).energy >= num(o.def, 'cost', 1),
      use(g, o, item) {
        spendEnergy(g, o.seat, num(o.def, 'cost', 1));
        markUsed(g, o);
        item.amount = Math.max(0, item.amount - num(o.def, 'n', 1));
        g.ev.push({
          type: 'damage_prevented',
          seat: o.seat,
          amount: num(o.def, 'n', 1),
          cardId: o.cardId,
        });
        return undefined;
      },
    },
  },
  jets: {
    kind: 'keep',
    reaction: {
      available: (g, o, item) => item.target && getMonster(g.s, o.seat).location !== null,
      use(g, o, item, attacker) {
        item.amount = 0;
        g.ev.push({ type: 'card_used', seat: o.seat, cardId: o.cardId });
        leaveTokyo(g, o.seat);
        // 離開東京仍是「讓位」，讓位時觸發的效果照常
        for (const own of ownedOf(g, o.seat)) {
          effectOf(own.def)?.onYield?.(g, own, { taker: attacker });
        }
        return 'left';
      },
    },
  },
  swap_on_yield: { kind: 'keep' },

  // ── 加害後 ──
  counter_attack: {
    kind: 'keep',
    requiredParams: ['counter'],
    onDealt(g, o, info) {
      if (info.cause === 'yield' || info.cause === 'self') return;
      const counter = o.def.params['counter'] === 'shrink' ? 'shrink' : 'poison';
      if (getMonster(g.s, info.victim).alive) {
        addCounter(g, info.victim, counter);
      }
    },
  },
  lifesteal: {
    kind: 'keep',
    onDealt(g, o, info) {
      if (info.cause === 'yield') return;
      healRaw(g, o.seat, num(o.def, 'n', 1));
    },
  },
  death_vp: {
    kind: 'keep',
    requiredParams: ['vp'],
    onAnyZero(g, o) {
      gainVp(g, o.seat, num(o.def, 'vp', 3), 'card');
    },
  },
  revive_self: { kind: 'keep', revive: 'self' },
  revive_partner: { kind: 'keep', revive: 'partner' },

  // ── 回合開始／結束 ──
  vp_on_buy: {
    kind: 'keep',
    onCardBought(g, o) {
      gainVp(g, o.seat, num(o.def, 'vp', 1), 'card');
    },
  },
  end_energy_vp: {
    kind: 'keep',
    onTurnEnd(g, o) {
      const per = Math.max(1, num(o.def, 'per', 6));
      gainVp(
        g,
        o.seat,
        Math.floor(getMonster(g.s, o.seat).energy / per) * num(o.def, 'vp', 1),
        'card',
      );
    },
  },
  end_empty_energy: {
    kind: 'keep',
    onTurnEnd(g, o) {
      if (getMonster(g.s, o.seat).energy === 0) {
        gainEnergy(g, o.seat, num(o.def, 'n', 1), 'card');
      }
    },
  },
  end_peaceful_vp: {
    kind: 'keep',
    onTurnEnd(g, o) {
      if (!g.s.turn.damagedAnyone) {
        gainVp(g, o.seat, num(o.def, 'vp', 1), 'card');
      }
    },
  },
  big_hit_vp: {
    kind: 'keep',
    onTurnEnd(g, o) {
      if (g.s.turn.dealt >= num(o.def, 'min', 3)) {
        gainVp(g, o.seat, num(o.def, 'vp', 2), 'card');
      }
    },
  },
  end_underdog: {
    kind: 'keep',
    onAnyTurnEnd(g, o) {
      const me = getMonster(g.s, o.seat);
      if (me.alive && aliveMonsters(g.s).every((m) => m.vp >= me.vp)) {
        gainVp(g, o.seat, num(o.def, 'vp', 1), 'card');
      }
    },
  },
  stomp: {
    kind: 'keep',
    onTurnEnd(g, o) {
      if (g.s.turn.vpGained >= num(o.def, 'min', 4) && !g.s.stomp.includes(o.seat)) {
        g.s.stomp.push(o.seat);
        g.ev.push({ type: 'dice_penalty', seats: [...g.s.stomp] });
      }
    },
  },
  batteries: {
    kind: 'keep',
    validateBuy(g, o, args) {
      const e = args.energy ?? 0;
      const spare = getMonster(g.s, o.seat).energy - args.cost;
      return Number.isInteger(e) && e >= 0 && e <= spare ? null : 'not_enough_energy';
    },
    onBuy(g, o, args) {
      const e = args.energy ?? 0;
      const data = getMonster(g.s, o.seat).cardData[o.cardId];
      if (data && e > 0) {
        spendEnergy(g, o.seat, e);
        data.n = e;
      }
    },
    onTurnStart(g, o) {
      const data = getMonster(g.s, o.seat).cardData[o.cardId];
      if (!data) return;
      const take = Math.min(num(o.def, 'perTurn', 2), data.n);
      data.n -= take;
      gainEnergy(g, o.seat, take, 'reserve');
      if (data.n <= 0) {
        discardCard(g, o.seat, o.cardId, 'spent');
      }
    },
  },

  // ── 買牌階段 ──
  mimic: {
    kind: 'keep',
    validateBuy(g, o, args) {
      const targets = mimicTargets(g);
      if (args.target === undefined) {
        return targets.length === 0 ? null : 'invalid_action';
      }
      if (!targets.includes(args.target)) return 'invalid_action';
      // 買下時效果視同被複製的卡：它的買下條件（例如存放能量的上限）也要檢查
      const target = cardDef(g, args.target);
      return effectOf(target)?.validateBuy?.(g, { ...o, def: target }, args) ?? null;
    },
    onBuy(g, o, args) {
      const data = getMonster(g.s, o.seat).cardData[o.cardId];
      if (!data || args.target === undefined) return;
      data.ref = args.target;
      syncMaxHp(g, o.seat); // 複製最大 HP 類的卡時，先調整上限再執行買下時效果
      const target = cardDef(g, args.target);
      // 視同剛買下被複製的卡（包含買下時效果）
      const copy: Owned = { seat: o.seat, cardId: o.cardId, def: target, base: o.base };
      effectOf(target)?.onBuy?.(g, copy, { ...args, cost: args.cost });
    },
    active: {
      when: 'start',
      available: (g, o) =>
        getMonster(g.s, o.seat).energy >= num(o.base, 'switchCost', 1) &&
        mimicTargets(g).length > 0,
      check: (g, _o, args) =>
        args.target !== undefined && mimicTargets(g).includes(args.target)
          ? null
          : 'invalid_action',
      use(g, o, args) {
        const data = getMonster(g.s, o.seat).cardData[o.cardId];
        if (!data) return;
        spendEnergy(g, o.seat, num(o.base, 'switchCost', 1));
        data.ref = args.target ?? null;
        syncMaxHp(g, o.seat);
        g.ev.push({ type: 'card_used', seat: o.seat, cardId: o.cardId });
      },
    },
  },
  buy_from_others: { kind: 'keep' },
  peek_buy: {
    kind: 'keep',
    active: {
      when: 'buy',
      available: (g) =>
        (g.s.market?.deck.length ?? 0) + (g.s.market?.discard.length ?? 0) > 0 &&
        g.s.turn.peek === null,
      use(g, o) {
        const market = g.s.market;
        if (!market) return;
        reshuffleIfEmpty(g);
        const top = market.deck[0] ?? null;
        g.s.turn.peek = top;
        g.ev.push({ type: 'deck_peeked', seat: o.seat, cardId: top });
      },
    },
  },
  opportunist: { kind: 'keep' },
  heal_others: { kind: 'keep' },
  metamorph: {
    kind: 'keep',
    active: {
      when: 'buy',
      available: (g, o) => getMonster(g.s, o.seat).cards.length > 0,
      check(g, o, args) {
        const cards = args.cards;
        const me = getMonster(g.s, o.seat);
        if (!cards || cards.length === 0 || new Set(cards).size !== cards.length) {
          return 'invalid_action';
        }
        return cards.every((id) => me.cards.includes(id)) ? null : 'card_unavailable';
      },
      use(g, o, args) {
        g.ev.push({ type: 'card_used', seat: o.seat, cardId: o.cardId });
        for (const id of args.cards ?? []) {
          const printed = g.env.cards[id]?.cost ?? 0;
          if (discardCard(g, o.seat, id, 'sold')) {
            gainEnergy(g, o.seat, printed, 'refund');
          }
        }
      },
    },
  },
  extra_turn_triple: {
    kind: 'keep',
    active: {
      when: 'buy',
      available: (g) => g.s.turn.tripleOnes && g.s.turn.extraTurn === null,
      use(g, o) {
        g.s.turn.extraTurn = { dicePenalty: num(o.def, 'penalty', 1) };
        g.ev.push({ type: 'card_used', seat: o.seat, cardId: o.cardId });
        g.ev.push({ type: 'extra_turn_granted', seat: o.seat });
      },
    },
  },

  // ── 隨時 ──
  rapid_heal: {
    kind: 'keep',
    active: {
      when: 'free',
      available(g, o) {
        const me = getMonster(g.s, o.seat);
        return me.energy >= num(o.def, 'cost', 2) && me.hp < me.maxHp;
      },
      use(g, o) {
        spendEnergy(g, o.seat, num(o.def, 'cost', 2));
        g.ev.push({ type: 'card_used', seat: o.seat, cardId: o.cardId });
        heal(g, o.seat, num(o.def, 'heal', 1));
      },
    },
  },
  energy_to_vp: {
    kind: 'keep',
    active: {
      when: 'free',
      available: (g, o) => getMonster(g.s, o.seat).energy >= num(o.def, 'cost', 3),
      use(g, o) {
        spendEnergy(g, o.seat, num(o.def, 'cost', 3));
        g.ev.push({ type: 'card_used', seat: o.seat, cardId: o.cardId });
        gainVp(g, o.seat, num(o.def, 'vp', 1), 'card');
      },
    },
  },
};

/** 所有已知的 effectId（卡組驗證用）。 */
export function knownEffectIds(): string[] {
  return Object.keys(EFFECTS);
}
