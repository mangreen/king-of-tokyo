/**
 * 規則引擎核心：applyAction(state, action, env) → { state, events }。
 *
 * 純函式：不修改傳入的 state、不使用 Math.random / Date.now / I/O。
 * 亂數狀態在 state.rng 內，因此「初始 seed + 動作序列」可完整重放。
 * 卡牌效果的定義由 env（卡牌目錄）提供；沒有卡牌時 env 可省略。
 */
import { CAP, EFFECTS } from './cards/effects.js';
import type { AttackCtx } from './cards/effects.js';
import { NO_CARDS } from './cards/types.js';
import type { RulesEnv } from './cards/types.js';
import { countFaces, numberVp, rollDie } from './dice.js';
import {
  checkLastStanding,
  clockwiseFrom,
  costFor,
  discardCard,
  effectOf,
  effectsWith,
  endGame,
  findOwned,
  gainCard,
  gainEnergy,
  gainVp,
  hasEffect,
  heal,
  leaveTokyo,
  makeG,
  mitigatePre,
  inflict,
  neighborsOf,
  num,
  ownedOf,
  refillFaceUp,
  removeCounter,
  spendEnergy,
  syncMaxHp,
} from './ops.js';
import type { G, Owned } from './ops.js';
import { pickWinners } from './outcome.js';
import {
  aliveMonsters,
  cloneState,
  getMonster,
  isBayOpen,
  newTurn,
  nextAliveSeat,
  occupantOf,
  roundPosition,
} from './state.js';
import type {
  Action,
  ActionResult,
  ErrorCode,
  Face,
  GameEvent,
  GameState,
  Pending,
  PlanItem,
} from './types.js';

/** 掃牌費用。R-CARD-12 */
export const SWEEP_COST = 2;

/** 避免 TypeScript 在呼叫會改變 phase 的函式之後仍沿用舊的窄化型別。 */
function isOver(s: GameState): boolean {
  return s.phase === 'over';
}

function fail(error: ErrorCode): ActionResult {
  return { ok: false, error };
}

const isInt = (v: unknown): v is number => Number.isInteger(v);

function isWellFormed(action: Action): boolean {
  switch (action.type) {
    case 'roll':
      return Array.isArray(action.keep) && isInt(action.seat);
    case 'endRolling':
    case 'sweep':
    case 'endTurn':
      return isInt(action.seat);
    case 'yieldDecision':
      return (
        typeof action.leave === 'boolean' &&
        isInt(action.seat) &&
        (action.takeCard === undefined || typeof action.takeCard === 'string')
      );
    case 'buy':
      return (
        isInt(action.seat) &&
        typeof action.cardId === 'string' &&
        (action.from === undefined || action.from === 'deck' || isInt(action.from)) &&
        (action.energy === undefined || isInt(action.energy)) &&
        (action.target === undefined || typeof action.target === 'string')
      );
    case 'useCard':
      return (
        isInt(action.seat) &&
        typeof action.cardId === 'string' &&
        (action.args === undefined || typeof action.args === 'object')
      );
    case 'reactDecision':
      return isInt(action.seat) && (action.cardId === null || typeof action.cardId === 'string');
    case 'heartsDecision':
      return (
        isInt(action.seat) &&
        isInt(action.self) &&
        isInt(action.poison) &&
        isInt(action.shrink) &&
        Array.isArray(action.others) &&
        action.others.every((o) => isInt(o.seat) && isInt(o.amount))
      );
    case 'probeDecision':
      return isInt(action.seat) && (action.die === null || isInt(action.die));
    case 'opportunityDecision':
      return isInt(action.seat) && typeof action.buy === 'boolean';
    default:
      return false;
  }
}

/** 驗證 keep 是「不重複、在範圍內的索引」，且至少要擲一顆。 */
function isValidKeep(keep: readonly number[], diceCount: number): boolean {
  if (keep.length >= diceCount) {
    return false; // 沒有任何骰子要重擲，沒有意義
  }
  const seen = new Set<number>();
  for (const index of keep) {
    if (!Number.isInteger(index) || index < 0 || index >= diceCount || seen.has(index)) {
      return false;
    }
    seen.add(index);
  }
  return true;
}

/** 目前等待決定的座位（沒有待決事項為 null）。 */
export function pendingSeat(p: Pending | null): number | null {
  if (!p) return null;
  switch (p.kind) {
    case 'yield':
    case 'probe':
      return p.queue[0] ?? null;
    case 'react':
    case 'hearts':
      return p.seat;
    case 'opportunity':
      return p.queue[0]?.seat ?? null;
  }
}

/**
 * 套用一個動作。回傳新的 state 與這個動作產生的事件；
 * 不合法的動作回傳穩定的錯誤碼，且不改變 state。
 */
export function applyAction(
  state: GameState,
  action: Action,
  env: RulesEnv = NO_CARDS,
): ActionResult {
  if (state.phase === 'over') {
    return fail('game_over');
  }
  // 引擎也可能在沒有經過協定層驗證時被呼叫：形狀不對一律回穩定的錯誤碼，不丟例外
  if (!isWellFormed(action)) {
    return fail('invalid_action');
  }

  const next = cloneState(state);
  const events: GameEvent[] = [];
  const g = makeG(next, env, events);
  const error = dispatch(g, action);
  if (error) {
    return fail(error);
  }
  next.version += 1;
  return { ok: true, state: next, events };
}

function dispatch(g: G, action: Action): ErrorCode | null {
  const s = g.s;
  switch (action.type) {
    case 'roll':
    case 'endRolling': {
      if (s.phase !== 'roll') return 'wrong_phase';
      if (action.seat !== s.turn.seat) return 'not_your_turn';
      return action.type === 'roll' ? handleRoll(g, action.keep) : handleEndRolling(g);
    }
    case 'yieldDecision': {
      if (s.phase !== 'prompt' || s.pending?.kind !== 'yield') return 'wrong_phase';
      if (action.seat !== s.pending.queue[0]) return 'not_your_turn';
      return decideYield(g, action.leave, action.takeCard);
    }
    case 'reactDecision': {
      if (s.phase !== 'prompt' || s.pending?.kind !== 'react') return 'wrong_phase';
      if (action.seat !== s.pending.seat) return 'not_your_turn';
      return decideReact(g, s.pending, action.cardId);
    }
    case 'heartsDecision': {
      if (s.phase !== 'prompt' || s.pending?.kind !== 'hearts') return 'wrong_phase';
      if (action.seat !== s.pending.seat) return 'not_your_turn';
      return decideHearts(g, s.pending, action);
    }
    case 'probeDecision': {
      if (s.phase !== 'prompt' || s.pending?.kind !== 'probe') return 'wrong_phase';
      if (action.seat !== s.pending.queue[0]) return 'not_your_turn';
      return decideProbe(g, action.die);
    }
    case 'opportunityDecision': {
      if (s.phase !== 'prompt' || s.pending?.kind !== 'opportunity') return 'wrong_phase';
      if (action.seat !== s.pending.queue[0]?.seat) return 'not_your_turn';
      return decideOpportunity(g, action.buy);
    }
    case 'buy':
    case 'sweep':
    case 'endTurn': {
      if (s.phase !== 'buy') return 'wrong_phase';
      if (action.seat !== s.turn.seat) return 'not_your_turn';
      if (action.type === 'endTurn') {
        endTurn(g);
        return null;
      }
      if (action.type === 'sweep') return handleSweep(g);
      return handleBuy(g, action);
    }
    case 'useCard':
      return handleUseCard(g, action);
  }
}

// ── 擲骰 ────────────────────────────────────────────────

/** 本回合可擲的次數上限（含加擲卡與已使用的額外重擲）。R-CARD-21 */
function rollLimit(g: G): number {
  let limit = g.s.config.maxRolls + g.s.turn.bonusRolls;
  for (const { e, o } of effectsWith(g, g.s.turn.seat, 'extraRolls')) {
    limit += e.extraRolls(o);
  }
  return limit;
}

/** 回合開始時的骰子數。R-CARD-21 */
function diceCountFor(g: G, seat: number, penalty: number): number {
  let n = g.s.config.diceCount;
  for (const { e, o } of effectsWith(g, seat, 'extraDice')) {
    n += e.extraDice(o);
  }
  n -= getMonster(g.s, seat).tokens.shrink;
  n -= g.s.stomp.length;
  n -= penalty;
  return Math.max(1, n);
}

/** 擲骰次數用完後，是否還有擲骰期能力值得等待玩家使用。R-CARD-22 */
function holdsForAbilities(g: G): boolean {
  const seat = g.s.turn.seat;
  for (const o of ownedOf(g, seat)) {
    const a = effectOf(o.def)?.active;
    if (a && a.when === 'rolled' && a.available(g, o)) {
      return true;
    }
  }
  return freeThreesRerollable(g);
}

/** 持有「只重擲 3」的卡且還有 3 時，次數用完仍可重擲。 */
function freeThreesRerollable(g: G): boolean {
  return (
    hasEffect(g, g.s.turn.seat, CAP.rerollThrees) &&
    g.s.turn.rollsUsed > 0 &&
    g.s.turn.dice.some((f) => f === 3)
  );
}

function handleRoll(g: G, keepInput: readonly number[]): ErrorCode | null {
  const t = g.s.turn;
  let keep = keepInput;
  let free = false;
  if (t.rollsUsed >= rollLimit(g) && t.rollsUsed > 0) {
    // 次數用完：只有「重擲 3」的卡能讓玩家只重擲 3
    const keepAll = t.dice.flatMap((f, i) => (f === 3 ? [] : [i]));
    const matches =
      freeThreesRerollable(g) &&
      keepInput.length === keepAll.length &&
      keepAll.every((i) => keepInput.includes(i));
    if (!matches) return 'no_rolls_left';
    free = true;
    keep = keepAll;
  } else if (t.rollsUsed === 0) {
    if (keepInput.length > 0) return 'invalid_keep';
    keep = [];
  } else if (!isValidKeep(keepInput, t.diceCount)) {
    return 'invalid_keep';
  }

  const keepSet = new Set(keep);
  const dice: Face[] = [...t.dice];
  const rerolled: number[] = [];
  for (let i = 0; i < t.diceCount; i += 1) {
    if (!keepSet.has(i)) {
      const [face, rng] = rollDie(g.s.rng);
      g.s.rng = rng;
      dice[i] = face;
      rerolled.push(i);
    }
  }
  t.dice = dice;
  if (!free) t.rollsUsed += 1;
  g.ev.push({
    type: 'dice_rolled',
    seat: t.seat,
    rollNumber: t.rollsUsed,
    dice: [...dice],
    rerolled,
  });
  // 用完所有擲骰次數就自動進入結算（除非還有能力要等玩家使用）。R-DICE-01、R-CARD-22
  if (t.rollsUsed >= rollLimit(g) && !holdsForAbilities(g)) {
    finishRolling(g);
  }
  return null;
}

function handleEndRolling(g: G): ErrorCode | null {
  if (g.s.turn.rollsUsed === 0) return 'roll_first';
  finishRolling(g);
  return null;
}

function finishRolling(g: G): void {
  const t = g.s.turn;
  g.ev.push({ type: 'rolling_ended', seat: t.seat, dice: [...t.dice] });
  t.tripleOnes = t.dice.filter((f) => f === 1).length >= 3;
  probeStage(g);
}

// ── 重擲他人骰子 ─────────────────────────────────────────

function probeStage(g: G): void {
  const queue = clockwiseFrom(g.s, g.s.turn.seat).filter((seat) => hasEffect(g, seat, CAP.probe));
  if (queue.length > 0) {
    g.s.pending = { kind: 'probe', queue };
    g.s.phase = 'prompt';
    return;
  }
  resolveDice(g);
}

function decideProbe(g: G, die: number | null): ErrorCode | null {
  const pending = g.s.pending;
  if (pending?.kind !== 'probe') return 'wrong_phase';
  const seat = pending.queue[0] as number;
  if (die !== null) {
    if (die < 0 || die >= g.s.turn.dice.length) return 'invalid_action';
    const owned = findOwned(g, seat, CAP.probe) as Owned;
    const [face, rng] = rollDie(g.s.rng);
    g.s.rng = rng;
    g.s.turn.dice[die] = face;
    g.ev.push({ type: 'card_used', seat, cardId: owned.cardId });
    g.ev.push({ type: 'die_rerolled', by: seat, seat: g.s.turn.seat, index: die, face });
    if (face === 'heal') {
      discardCard(g, seat, owned.cardId, 'backfired');
    }
  }
  pending.queue.shift();
  if (pending.queue.length === 0) {
    g.s.pending = null;
    g.s.phase = 'roll';
    resolveDice(g);
  }
  return null;
}

// ── 結算骰子（R-DICE-06：VP → 能量 → 治療 → 攻擊）──────────────

function resolveDice(g: G): void {
  const s = g.s;
  const seat = s.turn.seat;
  const dice = [...s.turn.dice];
  const counts = countFaces(dice);

  gainVp(g, seat, numberVp(dice), 'dice');
  for (const { e, o } of effectsWith(g, seat, 'onDice')) {
    e.onDice(g, o, { dice, counts });
  }
  gainEnergy(g, seat, counts['energy'] ?? 0, 'dice');
  heartsStage(g, counts['heal'] ?? 0);
}

function rayTargets(g: G, seat: number): number[] {
  if (!hasEffect(g, seat, CAP.healingRay)) return [];
  return aliveMonsters(g.s)
    .filter((m) => m.seat !== seat && m.hp < m.maxHp && m.energy >= 1)
    .map((m) => m.seat);
}

function heartsStage(g: G, hearts: number): void {
  const seat = g.s.turn.seat;
  const me = getMonster(g.s, seat);
  if (hearts > 0) {
    const canCure = me.location === null && me.tokens.poison + me.tokens.shrink > 0;
    if (canCure || rayTargets(g, seat).length > 0) {
      g.s.pending = { kind: 'hearts', seat, hearts };
      g.s.phase = 'prompt';
      return;
    }
    healFromDice(g, seat, hearts);
  }
  attackStage(g);
}

function healFromDice(g: G, seat: number, hearts: number): void {
  if (hearts <= 0) return;
  if (getMonster(g.s, seat).location !== null) {
    g.ev.push({ type: 'heal_ignored', seat, faces: hearts }); // R-HEAL-02
  } else {
    heal(g, seat, hearts); // R-HEAL-01
  }
}

function decideHearts(
  g: G,
  pending: Extract<Pending, { kind: 'hearts' }>,
  a: Extract<Action, { type: 'heartsDecision' }>,
): ErrorCode | null {
  const me = getMonster(g.s, pending.seat);
  const others = a.others;
  const ints = [a.self, a.poison, a.shrink, ...others.map((o) => o.amount)];
  if (ints.some((n) => n < 0)) return 'invalid_action';
  const total = ints.reduce((x, y) => x + y, 0);
  if (total > pending.hearts) return 'invalid_action';
  if (a.poison > me.tokens.poison || a.shrink > me.tokens.shrink) return 'invalid_action';
  if (a.poison + a.shrink > 0 && me.location !== null) return 'invalid_action'; // R-CARD-61
  const allowed = rayTargets(g, pending.seat);
  const seen = new Set<number>();
  for (const o of others) {
    const target = g.s.monsters[o.seat];
    if (!allowed.includes(o.seat) || seen.has(o.seat) || !target) return 'invalid_action';
    if (o.amount > target.maxHp - target.hp) return 'invalid_action';
    seen.add(o.seat);
  }

  g.s.pending = null;
  g.s.phase = 'roll';
  healFromDice(g, pending.seat, a.self);
  if (a.poison > 0) removeCounter(g, pending.seat, 'poison', a.poison);
  if (a.shrink > 0) removeCounter(g, pending.seat, 'shrink', a.shrink);
  const ray = findOwned(g, pending.seat, CAP.healingRay);
  const rate = ray ? num(ray.def, 'rate', 2) : 2;
  for (const o of others) {
    if (o.amount <= 0) continue;
    const target = getMonster(g.s, o.seat);
    const pay = Math.min(rate * o.amount, target.energy);
    spendEnergy(g, o.seat, pay);
    gainEnergy(g, pending.seat, pay, 'transfer');
    const actual = Math.min(o.amount, target.maxHp - target.hp);
    target.hp += actual;
    g.ev.push({ type: 'healed', seat: o.seat, amount: actual });
  }
  attackStage(g);
  return null;
}

// ── 攻擊 ────────────────────────────────────────────────

/** 攻擊：在東京內打東京外的人，在東京外打東京內的人。R-SMASH-01 ~ 04 */
function attackStage(g: G): void {
  const s = g.s;
  const seat = s.turn.seat;
  const attacker = getMonster(s, seat);
  const counts = countFaces(s.turn.dice);
  const a: AttackCtx = {
    attacker: seat,
    faces: counts['attack'] ?? 0,
    counts,
    bonus: 0,
    always: false,
    tokyoBonus: 0,
    nova: false,
    neighbor: 0,
  };
  for (const { e, o } of effectsWith(g, seat, 'attack')) {
    e.attack(g, o, a);
  }
  if (a.faces === 0 && !a.always) {
    afterAttack(g);
    return;
  }
  const targets = aliveMonsters(s).filter(
    (m) =>
      m.seat !== seat &&
      (a.nova || (attacker.location === null ? m.location !== null : m.location === null)),
  );
  if (targets.length === 0) {
    afterAttack(g); // 實際沒有傷害就不算攻擊。R-SMASH-06
    return;
  }
  const base = a.faces + a.bonus;
  const plan: PlanItem[] = targets.map((t) => ({
    seat: t.seat,
    amount: base + (t.location !== null ? a.tokyoBonus : 0),
    target: true,
    asked: false,
  }));
  if (a.neighbor > 0 && base > 0) {
    for (const n of neighborsOf(s, seat)) {
      const item = plan.find((p) => p.seat === n);
      if (item) {
        item.amount += a.neighbor;
      } else {
        plan.push({ seat: n, amount: a.neighbor, target: false, asked: false });
      }
    }
  }
  s.turn.attackTargets = targets.map((t) => t.seat);
  g.ev.push({ type: 'smash', attacker: seat, damage: base, targets: s.turn.attackTargets.slice() });
  for (const { e, o } of effectsWith(g, seat, 'onAttack')) {
    e.onAttack(g, o, a, s.turn.attackTargets);
  }
  processPlan(g, plan, 0, seat);
}

function reactionsFor(g: G, item: PlanItem, attacker: number): Owned[] {
  const out: Owned[] = [];
  for (const o of ownedOf(g, item.seat)) {
    const r = effectOf(o.def)?.reaction;
    if (r?.available(g, o, item, attacker)) {
      out.push(o);
    }
  }
  return out;
}

function processPlan(g: G, plan: PlanItem[], from: number, attacker: number): void {
  const s = g.s;
  for (let i = from; i < plan.length; i += 1) {
    const item = plan[i] as PlanItem;
    if (!getMonster(s, item.seat).alive || item.amount <= 0) continue;
    if (!item.asked) {
      item.asked = true;
      item.amount = mitigatePre(g, item.seat, item.amount);
      if (item.amount <= 0) continue;
      if (reactionsFor(g, item, attacker).length > 0) {
        s.pending = { kind: 'react', seat: item.seat, attacker, plan, index: i };
        s.phase = 'prompt';
        return;
      }
    }
    const dealt = inflict(g, item.seat, item.amount, attacker, item.target ? undefined : 'extra', {
      skipPre: true,
    });
    if (dealt > 0 && item.target) {
      s.turn.hit.push(item.seat);
    }
    if (s.phase === 'over') return;
  }
  afterAttack(g);
}

function decideReact(
  g: G,
  pending: Extract<Pending, { kind: 'react' }>,
  cardId: string | null,
): ErrorCode | null {
  const item = pending.plan[pending.index] as PlanItem;
  if (cardId !== null) {
    const owned = ownedOf(g, pending.seat).find((o) => o.cardId === cardId);
    const reaction = owned ? effectOf(owned.def)?.reaction : undefined;
    if (!owned || !reaction) return 'card_unavailable';
    if (!reaction.available(g, owned, item, pending.attacker)) return 'cannot_use';
    reaction.use(g, owned, item, pending.attacker);
    if (item.amount > 0 && reactionsFor(g, item, pending.attacker).length > 0) {
      return null; // 還有可用的反應，繼續詢問
    }
  }
  g.s.pending = null;
  g.s.phase = 'roll';
  processPlan(g, pending.plan, pending.index, pending.attacker);
  return null;
}

// ── 讓位與進入東京 ───────────────────────────────────────────

/** 攻擊後：若攻擊者在東京外，依序詢問被攻擊的東京怪獸是否讓位。R-TOKYO-04/05 */
function afterAttack(g: G): void {
  const s = g.s;
  if (s.phase === 'over') return;
  const attacker = getMonster(s, s.turn.seat);
  if (attacker.alive && attacker.location === null && s.turn.attackTargets.length > 0) {
    const forced = hasEffect(g, attacker.seat, CAP.forcedYield);
    const queue: number[] = [];
    for (const seat of clockwiseFrom(s, attacker.seat)) {
      const m = getMonster(s, seat);
      if (!s.turn.attackTargets.includes(seat) || m.location === null) continue;
      if (forced && s.turn.hit.includes(seat)) {
        yieldTokyo(g, seat, attacker.seat); // R-CARD-37
      } else {
        queue.push(seat);
      }
    }
    if (queue.length > 0) {
      s.pending = { kind: 'yield', attacker: attacker.seat, queue };
      s.phase = 'prompt';
      g.ev.push({ type: 'yield_requested', seat: queue[0] as number, attacker: attacker.seat });
      return;
    }
  }
  enterTokyoAndBuy(g);
}

/** 讓位並觸發讓位效果。 */
function yieldTokyo(g: G, seat: number, taker: number): void {
  leaveTokyo(g, seat);
  for (const o of ownedOf(g, seat)) {
    effectOf(o.def)?.onYield?.(g, o, { taker });
  }
}

function decideYield(g: G, leave: boolean, takeCard?: string): ErrorCode | null {
  const pending = g.s.pending;
  if (pending?.kind !== 'yield') return 'wrong_phase';
  const seat = pending.queue[0] as number;
  const m = getMonster(g.s, seat);
  const swap = takeCard !== undefined ? findOwned(g, seat, CAP.swapOnYield) : undefined;
  if (takeCard !== undefined) {
    // R-CARD-38：讓位換卡
    if (!leave || !swap) return 'cannot_use';
    if (!getMonster(g.s, pending.attacker).cards.includes(takeCard)) return 'card_unavailable';
  }
  pending.queue.shift();
  if (leave && m.location !== null) {
    yieldTokyo(g, seat, pending.attacker);
    if (swap && takeCard !== undefined && m.alive) {
      transferCard(g, pending.attacker, seat, takeCard);
      transferCard(g, seat, pending.attacker, swap.cardId);
      g.ev.push({
        type: 'card_swapped',
        seat,
        gave: swap.cardId,
        took: takeCard,
        from: pending.attacker,
      });
    }
  } else {
    g.ev.push({ type: 'stayed', seat });
  }
  const nextSeat = pending.queue[0];
  if (nextSeat !== undefined) {
    g.ev.push({ type: 'yield_requested', seat: nextSeat, attacker: pending.attacker });
    return null;
  }
  g.s.pending = null;
  g.s.phase = 'roll';
  enterTokyoAndBuy(g);
  return null;
}

/** 轉移持有的卡（帶著它的計數）。 */
function transferCard(g: G, from: number, to: number, cardId: string): void {
  const a = getMonster(g.s, from);
  const b = getMonster(g.s, to);
  const index = a.cards.indexOf(cardId);
  if (index < 0) return;
  a.cards.splice(index, 1);
  b.cards.push(cardId);
  const data = a.cardData[cardId];
  delete a.cardData[cardId];
  b.cardData[cardId] = data ?? { n: 0, ref: null };
  syncMaxHp(g, from);
  syncMaxHp(g, to);
}

function enterTokyoAndBuy(g: G): void {
  enterTokyo(g);
  closeBayIfNeeded(g);
  buyStage(g);
}

/** 進入東京步驟（必須進入）。R-TOKYO-01/02/03/06/07 */
function enterTokyo(g: G): void {
  const s = g.s;
  const me = getMonster(s, s.turn.seat);
  if (!me.alive || me.location !== null) {
    return;
  }
  let location: 'city' | 'bay' | null = null;
  if (!occupantOf(s, 'city')) {
    location = 'city';
  } else if (isBayOpen(s) && !occupantOf(s, 'bay')) {
    location = 'bay';
  }
  if (location) {
    me.location = location;
    g.ev.push({ type: 'entered_tokyo', seat: me.seat, location });
    gainVp(g, me.seat, 1, 'enter_tokyo');
  }
}

/** 存活 ≤4 時東京灣關閉；灣內怪獸離開，東京市若空著就移過去（不得 VP）。R-TOKYO-09 */
function closeBayIfNeeded(g: G): void {
  const s = g.s;
  if (isBayOpen(s)) {
    return;
  }
  const inBay = occupantOf(s, 'bay');
  if (!inBay) {
    return;
  }
  if (!occupantOf(s, 'city')) {
    inBay.location = 'city';
    g.ev.push({ type: 'bay_closed', seat: inBay.seat, movedTo: 'city' });
  } else {
    inBay.location = null;
    g.ev.push({ type: 'bay_closed', seat: inBay.seat, movedTo: null });
  }
}

// ── 買牌階段 ────────────────────────────────────────────────

function buyStage(g: G): void {
  const s = g.s;
  if (s.phase === 'over') return;
  const me = getMonster(s, s.turn.seat);
  if (s.market && me.alive) {
    s.phase = 'buy';
    s.pending = null;
    return;
  }
  endTurn(g);
}

interface BuyRequest {
  cardId: string;
  from?: 'deck' | number;
  energy?: number;
  target?: string;
}

/** 購買（含驗證）。成功回傳 null。買家不一定是活動怪獸（新牌即買）。 */
function purchase(g: G, seat: number, req: BuyRequest): ErrorCode | null {
  const s = g.s;
  const market = s.market;
  const buyer = getMonster(s, seat);
  if (!market || !buyer.alive) return 'card_unavailable';
  const def = g.env.cards[req.cardId];
  if (!def) return 'card_unavailable';

  // 來源驗證
  let fromSeat: number | null = null;
  if (req.from === undefined) {
    if (!market.faceUp.includes(req.cardId)) return 'card_unavailable';
  } else if (req.from === 'deck') {
    if (!hasEffect(g, seat, CAP.peekBuy)) return 'cannot_use';
    if (s.turn.peek !== req.cardId || market.deck[0] !== req.cardId) return 'card_unavailable';
  } else {
    if (!hasEffect(g, seat, CAP.buyFromOthers)) return 'cannot_use';
    const owner = s.monsters[req.from];
    if (!owner?.alive || owner.seat === seat) return 'card_unavailable';
    if (!owner.cards.includes(req.cardId) || def.kind !== 'keep') return 'card_unavailable';
    fromSeat = owner.seat;
  }

  const cost = costFor(g, seat, def);
  if (buyer.energy < cost) return 'not_enough_energy';
  const args = { cost, energy: req.energy, target: req.target };
  const stub: Owned = { seat, cardId: req.cardId, def, base: def };
  const validate = effectOf(def)?.validateBuy;
  if (validate && fromSeat === null) {
    const err = validate(g, stub, args);
    if (err) return err;
  }

  // 變更狀態
  const beforeBuy = effectsWith(g, seat, 'onCardBought');
  spendEnergy(g, seat, cost);
  if (fromSeat !== null) {
    gainEnergy(g, fromSeat, cost, 'transfer');
  }
  g.ev.push({ type: 'card_bought', seat, cardId: req.cardId, cost, from: fromSeat });
  if (fromSeat !== null) {
    const owner = getMonster(g.s, fromSeat);
    const old = ownedOf(g, fromSeat).find((o) => o.cardId === req.cardId);
    if (old) effectOf(old.def)?.onLeave?.(g, old);
    transferCard(g, owner.seat, seat, req.cardId);
  } else if (req.from === 'deck') {
    market.deck.shift();
    s.turn.peek = null;
  } else {
    market.faceUp.splice(market.faceUp.indexOf(req.cardId), 1);
    refillFaceUp(g);
  }

  if (def.kind === 'keep') {
    if (fromSeat === null) gainCard(g, seat, req.cardId);
    effectOf(def)?.onBuy?.(g, stub, args);
  } else {
    effectOf(def)?.onBuy?.(g, stub, args);
    market.discard.push(req.cardId);
    g.ev.push({ type: 'card_discarded', seat: null, cardId: req.cardId, reason: 'instant' });
  }
  for (const { e, o } of beforeBuy) {
    if (getMonster(s, seat).alive) e.onCardBought(g, o);
  }
  checkLastStanding(g);
  return null;
}

function handleBuy(g: G, a: Extract<Action, { type: 'buy' }>): ErrorCode | null {
  const err = purchase(g, a.seat, a);
  if (err) return err;
  afterMarketChange(g);
  return null;
}

function handleSweep(g: G): ErrorCode | null {
  const market = g.s.market;
  const me = getMonster(g.s, g.s.turn.seat);
  if (!market) return 'card_unavailable';
  if (me.energy < SWEEP_COST) return 'not_enough_energy';
  spendEnergy(g, me.seat, SWEEP_COST);
  const discarded = [...market.faceUp];
  market.discard.push(...discarded);
  market.faceUp = [];
  g.s.turn.peek = null;
  g.ev.push({ type: 'market_swept', seat: me.seat, discarded });
  refillFaceUp(g);
  afterMarketChange(g);
  return null;
}

/** 買牌、掃牌之後：處理新牌即買的機會，或回到買牌階段。R-CARD-52 */
function afterMarketChange(g: G): void {
  if (g.s.phase === 'over') return;
  if (!getMonster(g.s, g.s.turn.seat).alive) {
    endTurn(g);
    return;
  }
  const fresh = g.revealed.splice(0);
  const queue = opportunities(g, fresh);
  dropInvalidOpportunities(g, queue);
  if (queue.length > 0) {
    g.s.pending = { kind: 'opportunity', queue };
    g.s.phase = 'prompt';
  }
}

function opportunities(g: G, cards: readonly string[]): { seat: number; cardId: string }[] {
  const out: { seat: number; cardId: string }[] = [];
  const seats = clockwiseFrom(g.s, g.s.turn.seat).filter((seat) => hasEffect(g, seat, CAP.opportunist));
  for (const cardId of cards) {
    for (const seat of seats) {
      out.push({ seat, cardId });
    }
  }
  return out;
}

/** 目前還有效的第一個機會；沒有則回傳 null。 */
function dropInvalidOpportunities(g: G, queue: { seat: number; cardId: string }[]): void {
  while (queue.length > 0) {
    const first = queue[0] as { seat: number; cardId: string };
    const def = g.env.cards[first.cardId];
    const m = getMonster(g.s, first.seat);
    const ok =
      def !== undefined &&
      m.alive &&
      g.s.market?.faceUp.includes(first.cardId) === true &&
      m.energy >= costFor(g, first.seat, def);
    if (ok) return;
    queue.shift();
  }
}

function decideOpportunity(g: G, buy: boolean): ErrorCode | null {
  const pending = g.s.pending;
  if (pending?.kind !== 'opportunity') return 'wrong_phase';
  const entry = pending.queue[0] as { seat: number; cardId: string };
  if (buy) {
    const err = purchase(g, entry.seat, { cardId: entry.cardId });
    if (err) return err;
    pending.queue.shift();
    pending.queue.push(...opportunities(g, g.revealed.splice(0)));
  } else {
    pending.queue.shift();
  }
  if (g.s.phase === 'over') return null;
  dropInvalidOpportunities(g, pending.queue);
  if (pending.queue.length === 0) {
    g.s.pending = null;
    g.s.phase = 'buy';
    if (!getMonster(g.s, g.s.turn.seat).alive) endTurn(g);
  }
  return null;
}

// ── 卡牌主動能力 ────────────────────────────────────────────

function timingOk(g: G, seat: number, when: 'start' | 'rolled' | 'buy' | 'free'): boolean {
  const s = g.s;
  const actor = seat === s.turn.seat;
  const asked = s.phase === 'prompt' && pendingSeat(s.pending) === seat;
  switch (when) {
    case 'start':
      return s.phase === 'roll' && actor && s.turn.rollsUsed === 0;
    case 'rolled':
      return s.phase === 'roll' && actor && s.turn.rollsUsed >= 1;
    case 'buy':
      return s.phase === 'buy' && actor;
    case 'free':
      return (actor && (s.phase === 'roll' || s.phase === 'buy')) || asked;
  }
}

function handleUseCard(g: G, a: Extract<Action, { type: 'useCard' }>): ErrorCode | null {
  const s = g.s;
  const me = s.monsters[a.seat];
  if (!me?.alive) return 'invalid_action';
  if (!me.cards.includes(a.cardId)) return 'card_unavailable';
  const base = g.env.cards[a.cardId];
  if (!base) return 'card_unavailable';
  const args = a.args ?? {};

  let owned = ownedOf(g, a.seat).find((o) => o.cardId === a.cardId);
  let effect = owned ? effectOf(owned.def) : undefined;
  // 複製卡：帶 target 表示要重新指定目標，否則使用目前複製的效果
  if (base.effectId === CAP.mimic && (args.target !== undefined || !owned)) {
    owned = { seat: a.seat, cardId: a.cardId, def: base, base };
    effect = EFFECTS[CAP.mimic];
  }
  const active = effect?.active;
  if (!owned || !active) return 'cannot_use';
  if (!timingOk(g, a.seat, active.when)) {
    return s.phase === 'over' ? 'game_over' : 'wrong_phase';
  }
  if (!active.available(g, owned)) return 'cannot_use';
  const err = active.check?.(g, owned, args) ?? null;
  if (err) return err;
  active.use(g, owned, args);
  checkLastStanding(g);
  return null;
}

// ── 回合結束與勝負 ──────────────────────────────────────────

function endTurn(g: G): void {
  const s = g.s;
  const current = s.turn.seat;
  const me = getMonster(s, current);

  // R-CARD-39：毒傷 → 持有者的回合結束效果 → 所有人的「任一回合結束」效果
  if (me.alive && me.tokens.poison > 0) {
    inflict(g, current, me.tokens.poison, null, 'poison');
  }
  if (isOver(s)) return;
  if (me.alive) {
    for (const { e, o } of effectsWith(g, current, 'onTurnEnd')) {
      e.onTurnEnd(g, o);
    }
  }
  for (const m of aliveMonsters(s)) {
    for (const { e, o } of effectsWith(g, m.seat, 'onAnyTurnEnd')) {
      e.onAnyTurnEnd(g, o);
    }
  }
  if (isOver(s)) return;
  closeBayIfNeeded(g);
  g.ev.push({ type: 'turn_ended', seat: current });

  const extra = me.alive ? s.turn.extraTurn : null;
  const next = extra ? current : nextAliveSeat(s, current);
  // R-END-08：下一位在一輪中的位置不大於目前這位，表示繞回先手，一輪結束。額外回合不推進一輪（R-END-09）
  const roundEnds = !extra && roundPosition(s, next) <= roundPosition(s, current);
  if (roundEnds) {
    g.ev.push({ type: 'round_ended', round: s.round });
  }

  const goal = s.config.victoryPoints;
  if (roundEnds) {
    // R-END-03、R-END-04：一輪結束時以所有 VP ≥ 目標的存活怪獸決勝
    const winners = aliveMonsters(s).filter((m) => m.vp >= goal);
    if (winners.length > 0) {
      endGame(g, pickWinners(winners), 'roundEnd');
      return;
    }
  } else if (me.alive && me.vp >= goal) {
    endGame(g, [current], 'turnEnd'); // R-END-02
    return;
  }

  if (roundEnds) {
    s.round += 1;
  }
  startTurn(g, next, extra?.dicePenalty ?? 0);
}

function startTurn(g: G, seat: number, penalty: number): void {
  const s = g.s;
  // 「全場少擲一顆」在持有者自己的下一個回合開始時結束。R-CARD-63
  s.stomp = s.stomp.filter((x) => x !== seat);
  s.turn = newTurn(seat, diceCountFor(g, seat, penalty), penalty);
  s.phase = 'roll';
  s.pending = null;
  g.ev.push({ type: 'turn_started', seat, round: s.round });
  if (getMonster(s, seat).location !== null) {
    gainVp(g, seat, 2, 'tokyo_start'); // R-TURN-02
  }
  for (const { e, o } of effectsWith(g, seat, 'onTurnStart')) {
    e.onTurnStart(g, o);
  }
  // 回合開始的效果可能改變骰子數（例如電池耗盡不影響，但保持一致）
  s.turn.diceCount = diceCountFor(g, seat, penalty);
}
