/**
 * 電腦玩家的策略（smartBot）。純函式、確定性、不使用系統亂數。
 *
 * 公平性：只看 redactState(state, seat) 之後的資訊（看不到牌庫順序與亂數狀態），
 * 與真人看到的相同；所有「如果這樣做會怎樣」都用規則引擎本身去推演，因此新增卡牌效果
 * 不需要另外教機器人（只需要在 KEEP_VALUE 補一個估值，沒補就用卡費估算）。
 *
 * 決策方式：
 * - 擲骰：把「擲骰結束時的每一種骰面組合」交給引擎結算並以 evaluate() 打分，
 *   再用動態規劃（期望值）算出每一種保留方式的期望分數（剩下幾次重擲就算幾層）。
 * - 讓位／反應／分配治療／立即購買：逐一試算每個合法選項，選結算後分數最高者。
 * - 買牌：試算每一張買得起的牌，扣掉能量成本後分數有提升才買。
 *
 * 這是啟發式策略，不是理論最佳解（本遊戲有隱藏資訊與多人博弈，沒有可證明的最佳解）；
 * 實際勝率見 docs/architecture.md 的量測表與 ai.arena.test.ts。
 */
import { NO_CARDS } from './cards/types.js';
import type { RulesEnv } from './cards/types.js';
import { applyAction } from './engine.js';
import { currentActor, defaultAction, legalActions } from './legal.js';
import { effectOf, makeG, ownedOf } from './ops.js';
import { aliveMonsters, cloneState, getMonster } from './state.js';
import { FACES } from './types.js';
import type { Action, Face, GameState, Monster } from './types.js';
import { redactState } from './view.js';

// ── 評分 ────────────────────────────────────────────────

const WIN = 10_000;
const DEAD = -5_000;

/** Keep 卡的估值（與能量成本同單位：1 點能量 ≈ AiWeights.energy）。沒列出的用卡費估算。 */
const KEEP_VALUE: Readonly<Record<string, number>> = {
  armor: 4,
  attack_bonus: 5,
  attack_vp: 3,
  batteries: 2,
  big_hit_vp: 2,
  buy_from_others: 1,
  camouflage: 3,
  complete_set: 4,
  cost_discount: 3,
  counter_attack: 3,
  death_vp: 1,
  die_change: 4,
  end_empty_energy: 1,
  end_energy_vp: 2,
  end_peaceful_vp: 2,
  end_underdog: 2,
  energy_bonus: 4,
  energy_to_vp: 3,
  extra_dice: 8,
  extra_rolls: 7,
  extra_turn_triple: 2,
  forced_yield: 1,
  heal_bonus: 3,
  heal_others: 0,
  jets: 5,
  lifesteal: 3,
  lose_hp_energy: 1,
  max_hp: 4,
  metamorph: 1,
  mimic: 3,
  neighbor_damage: 4,
  nova: 5,
  opportunist: 1,
  peek_buy: 1,
  probe: 1,
  rapid_heal: 2,
  reflect: 4,
  reroll_charges: 4,
  reroll_energy: 3,
  reroll_threes: 2,
  revive_partner: 2,
  revive_self: 6,
  stomp: 3,
  straight_vp: 3,
  super_jump: 2,
  swap_on_yield: 1,
  tokyo_attacker: 4,
  tokyo_target_bonus: 2,
  triple_bonus: 3,
  vp_on_buy: 2,
  wings: 5,
};

/** 評分權重。預設值由對戰量測調整；量測腳本可以傳入不同權重互相比較。 */
export interface AiWeights {
  /** 每點 VP 的價值。 */
  vp: number;
  /** 接近勝利時 VP 的加成（(vp/20)^3 的係數）。 */
  vpConvex: number;
  /** HP 價值的整體倍率。 */
  hp: number;
  /** 每點能量的價值。 */
  energy: number;
  /** Keep 卡估值倍率。 */
  cards: number;
  /** 健康地待在東京內的加分。 */
  tokyo: number;
  /** 對手分數的基本權重（越大越重視壓制對手）。 */
  opp: number;
  /** 一對一時，對手 HP 的權重（打殘對手能直接獲勝）。 */
  duelHp: number;
  /** 淘汰一位對手的加分。 */
  kill: number;
}

export const DEFAULT_WEIGHTS: AiWeights = {
  vp: 1.1,
  vpConvex: 14,
  hp: 1,
  energy: 0.4,
  cards: 1,
  tokyo: 2.4,
  opp: 0.3,
  duelHp: 0.8,
  kill: 2,
};

function vpValue(vp: number, w: AiWeights): number {
  return vp * w.vp + (vp / 20) ** 3 * w.vpConvex;
}

function hpValue(hp: number, w: AiWeights): number {
  const h = Math.max(0, hp);
  return (
    w.hp *
    (1.2 * Math.min(h, 4) + 0.55 * Math.min(Math.max(h - 4, 0), 4) + 0.25 * Math.max(h - 8, 0))
  );
}

function cardsValue(m: Monster, env: RulesEnv, w: AiWeights): number {
  let total = 0;
  for (const id of m.cards) {
    const def = env.cards[id];
    if (def) {
      total += KEEP_VALUE[def.effectId] ?? def.cost * 0.9;
    }
  }
  return total * w.cards;
}

/**
 * 目前使用的權重。smartBot 是同步函式，進入時設定、結束時還原，所以不會互相干擾；
 * 這樣內部各層不必到處傳遞權重。
 */
let W: AiWeights = DEFAULT_WEIGHTS;

/** 從 me 的角度替局面打分：越高越好。 */
export function evaluate(s: GameState, me: number, env: RulesEnv): number {
  if (s.outcome) {
    const { winners } = s.outcome;
    if (!winners.includes(me)) {
      return -WIN;
    }
    return winners.length === 1 ? WIN : WIN * 0.6;
  }
  const mine = getMonster(s, me);
  if (!mine.alive) {
    return DEAD;
  }
  const opps = aliveMonsters(s).filter((m) => m.seat !== me);
  const outside = opps.filter((m) => m.location === null).length;

  let score = vpValue(mine.vp, W) + hpValue(mine.hp, W);
  score += W.energy * Math.min(mine.energy, 10) + 0.5 * W.energy * Math.max(mine.energy - 10, 0);
  score += cardsValue(mine, env, W);
  score -= 1.5 * mine.tokens.poison + 1.0 * mine.tokens.shrink;
  if (mine.hp <= 2) {
    score -= 2;
  }
  if (mine.location !== null) {
    // 東京內：預期每輪會挨的傷害約是「東京外的對手數 × 1.2」。血量不夠撐就有可能在下個回合前死掉，
    // 死掉等於失去目前的一切，所以按死亡機率打折；撐得住才拿得到待在東京的好處。
    const risk = 1.2 * outside;
    const pDeath = 1 / (1 + Math.exp(-(risk - mine.hp + 0.3) / 1.3));
    score -= pDeath * (Math.max(score, 0) + 6);
    score += W.tokyo * (1 - pDeath);
  }

  const maxOppVp = Math.max(0, ...opps.map((m) => m.vp));
  const duel = opps.length === 1;
  for (const o of opps) {
    let w = W.opp;
    if (o.vp >= maxOppVp && o.vp > 0) w += 0.2;
    if (o.vp >= 14) w += 0.3;
    let v = vpValue(o.vp, W) + (duel ? W.duelHp : 0.3) * hpValue(o.hp, W);
    v += W.energy * 0.5 * Math.min(o.energy, 10) + 0.3 * cardsValue(o, env, W);
    if (o.location !== null) v += 0.5;
    score -= w * v;
  }
  score += W.kill * (s.monsters.length - 1 - opps.length); // 每淘汰一位對手
  return score;
}

// ── 推演 ────────────────────────────────────────────────

/** 套用動作，失敗回 null（redacted 視角下偶爾會因為看不到牌庫而失敗，視為不可行）。 */
function step(state: GameState, action: Action, env: RulesEnv): GameState | null {
  try {
    const r = applyAction(state, action, env);
    return r.ok ? r.state : null;
  } catch {
    return null;
  }
}

/**
 * 把待決定事項依「合理的對手行為」自動走完，停在買牌／下一個擲骰／結束。
 * 對手模型：血量 ≤ 4 就讓位、其餘用最保守的預設。
 */
function settle(start: GameState, env: RulesEnv): GameState | null {
  let s = start;
  for (let i = 0; i < 24 && s.phase === 'prompt'; i += 1) {
    const seat = currentActor(s);
    const p = s.pending;
    if (seat === null || !p) break;
    const action: Action | null =
      p.kind === 'yield'
        ? { type: 'yieldDecision', seat, leave: getMonster(s, seat).hp <= 4 }
        : defaultAction(s);
    if (!action) return null;
    const next = step(s, action, env);
    if (!next) return null;
    s = next;
  }
  return s.phase === 'prompt' ? null : s;
}

function scoreAfter(state: GameState, action: Action, me: number, env: RulesEnv): number {
  const next = step(state, action, env);
  const settled = next ? settle(next, env) : null;
  return settled ? evaluate(settled, me, env) : -Infinity;
}

// ── 擲骰：期望值動態規劃 ─────────────────────────────────

type Counts = readonly number[]; // 依 FACES 順序的各面數量

const FACE_INDEX = new Map<Face, number>(FACES.map((f, i) => [f, i]));

function keyOf(c: Counts): string {
  return c.join(',');
}

/** 所有 m 顆骰子的面數分佈（multiset）與其機率。 */
function outcomes(m: number): { counts: Counts; prob: number }[] {
  const out: { counts: Counts; prob: number }[] = [];
  const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
  const rec = (face: number, left: number, acc: number[]): void => {
    if (face === FACES.length - 1) {
      const counts = [...acc, left];
      let ways = fact(m);
      for (const c of counts) ways /= fact(c);
      out.push({ counts, prob: ways / FACES.length ** m });
      return;
    }
    for (let c = 0; c <= left; c += 1) {
      rec(face + 1, left - c, [...acc, c]);
    }
  };
  rec(0, m, []);
  return out;
}

const OUTCOME_CACHE = new Map<number, { counts: Counts; prob: number }[]>();
function outcomesOf(m: number): { counts: Counts; prob: number }[] {
  let v = OUTCOME_CACHE.get(m);
  if (!v) {
    v = outcomes(m);
    OUTCOME_CACHE.set(m, v);
  }
  return v;
}

function toDice(c: Counts): Face[] {
  const dice: Face[] = [];
  FACES.forEach((face, i) => {
    for (let k = 0; k < (c[i] ?? 0); k += 1) dice.push(face);
  });
  return dice;
}

/** c 的所有子 multiset（不含自己）。 */
function subsets(c: Counts): Counts[] {
  const out: number[][] = [[]];
  for (const n of c) {
    const next: number[][] = [];
    for (const partial of out) {
      for (let k = 0; k <= n; k += 1) next.push([...partial, k]);
    }
    out.length = 0;
    out.push(...next);
  }
  return out.filter((s) => s.some((v, i) => v !== c[i]));
}

function rerollsLeft(s: GameState, env: RulesEnv): number {
  const g = makeG(s, env, []);
  let limit = s.config.maxRolls + s.turn.bonusRolls;
  for (const o of ownedOf(g, s.turn.seat)) {
    limit += effectOf(o.def)?.extraRolls?.(o) ?? 0;
  }
  return Math.max(0, limit - s.turn.rollsUsed);
}

interface RollPlan {
  /** 現在就停手的分數。 */
  stop: number;
  /** 最佳的重擲方式（要保留的 multiset）與其期望分數；沒有重擲次數時為 null。 */
  best: { keep: Counts; value: number } | null;
}

/** 以目前骰面為起點，算出「停手」與「最佳重擲」的分數。 */
function planRoll(s: GameState, me: number, env: RulesEnv): RollPlan {
  const n = s.turn.dice.length;
  const k = rerollsLeft(s, env);
  const resolved = new Map<string, number>();
  const stopValue = (c: Counts): number => {
    const key = keyOf(c);
    let v = resolved.get(key);
    if (v === undefined) {
      const state = cloneState(s);
      state.turn.dice = toDice(c);
      state.turn.rollsUsed = Math.max(1, state.turn.rollsUsed);
      const next = step(state, { type: 'endRolling', seat: me }, env);
      const settled = next ? settle(next, env) : null;
      v = settled ? evaluate(settled, me, env) : -Infinity;
      resolved.set(key, v);
    }
    return v;
  };

  const start: number[] = FACES.map(() => 0);
  for (const f of s.turn.dice) {
    const i = FACE_INDEX.get(f);
    if (i !== undefined) start[i] = (start[i] ?? 0) + 1;
  }
  const stop = stopValue(start);
  if (k <= 0 || n === 0) {
    return { stop, best: null };
  }

  // V[level][key]：還剩 level 次重擲時、手上是這組骰面的最佳期望分數
  const all = outcomesOf(n);
  let prev = new Map<string, number>();
  for (const { counts } of all) prev.set(keyOf(counts), stopValue(counts));
  let best: { keep: Counts; value: number } | null = null;
  for (let level = 1; level <= k; level += 1) {
    // E[s]：保留 s、其餘重擲後的期望分數（用 level-1 層的值）
    const expect = new Map<string, number>();
    const expectOf = (keep: Counts): number => {
      const key = keyOf(keep);
      let v = expect.get(key);
      if (v === undefined) {
        const m = n - keep.reduce((a, b) => a + b, 0);
        v = 0;
        for (const o of outcomesOf(m)) {
          const merged = keep.map((c, i) => c + (o.counts[i] ?? 0));
          v += o.prob * (prev.get(keyOf(merged)) ?? -Infinity);
        }
        expect.set(key, v);
      }
      return v;
    };
    const cur = new Map<string, number>();
    for (const { counts } of all) {
      let v = stopValue(counts);
      for (const keep of subsets(counts)) {
        const e = expectOf(keep);
        if (e > v) {
          v = e;
        }
      }
      cur.set(keyOf(counts), v);
    }
    if (level === k) {
      // 在現在這組骰子上挑出最佳的保留方式
      let value = -Infinity;
      for (const keep of subsets(start)) {
        const e = expectOf(keep);
        if (e > value) {
          value = e;
          best = { keep, value: e };
        }
      }
    }
    prev = cur;
  }
  return { stop, best };
}

/** 把「保留哪幾種面各幾顆」換成骰子索引。 */
function keepIndices(dice: readonly Face[], keep: Counts): number[] {
  const left = [...keep];
  const out: number[] = [];
  dice.forEach((face, i) => {
    const f = FACE_INDEX.get(face);
    if (f !== undefined && (left[f] ?? 0) > 0) {
      left[f] = (left[f] ?? 0) - 1;
      out.push(i);
    }
  });
  return out;
}

// ── 對外入口 ────────────────────────────────────────────

/** 擲骰階段中值得考慮的卡牌能力（多一次重擲）。 */
const ROLL_BOOST = new Set(['reroll_energy', 'reroll_charges']);
/** 買牌階段值得自動使用的卡牌能力。 */
const BUY_USE = new Set(['energy_to_vp', 'rapid_heal']);

function effectIdOf(env: RulesEnv, cardId: string): string {
  return env.cards[cardId]?.effectId ?? '';
}

function decideRoll(v: GameState, me: number, env: RulesEnv): Action {
  if (v.turn.rollsUsed === 0) {
    return { type: 'roll', seat: me, keep: [] };
  }
  const plan = planRoll(v, me, env);
  // 重擲次數用完時，看看有沒有「花資源多擲一次」的卡值得用
  if (plan.best === null) {
    for (const a of legalActions(v, env)) {
      if (a.type !== 'useCard' || !ROLL_BOOST.has(effectIdOf(env, a.cardId))) continue;
      const next = step(v, a, env);
      if (!next) continue;
      const after = planRoll(next, me, env);
      const value = Math.max(after.stop, after.best?.value ?? -Infinity);
      if (value > plan.stop + 0.3) {
        return a;
      }
    }
    return { type: 'endRolling', seat: me };
  }
  if (plan.best.value > plan.stop + 1e-9) {
    const keep = keepIndices(v.turn.dice, plan.best.keep);
    return { type: 'roll', seat: me, keep };
  }
  return { type: 'endRolling', seat: me };
}

function decideBuy(v: GameState, me: number, env: RulesEnv): Action {
  const base = evaluate(v, me, env);
  let best: Action = { type: 'endTurn', seat: me };
  let bestGain = 0.3; // 至少要有這麼多的進步才值得動
  const mine = getMonster(v, me);
  for (const a of legalActions(v, env)) {
    if (a.type === 'endTurn') continue;
    if (a.type === 'sweep' && mine.energy < 7) continue;
    if (a.type === 'useCard' && !BUY_USE.has(effectIdOf(env, a.cardId))) continue;
    if (a.type === 'buy' && a.from !== undefined && a.from !== 'deck') continue;
    const gain = scoreAfter(v, a, me, env) - base;
    if (gain > bestGain) {
      best = a;
      bestGain = gain;
    }
  }
  return best;
}

const DECISION_TYPES: Readonly<Record<string, Action['type']>> = {
  yield: 'yieldDecision',
  react: 'reactDecision',
  hearts: 'heartsDecision',
  opportunity: 'opportunityDecision',
};

function decidePrompt(v: GameState, me: number, env: RulesEnv): Action {
  const fallback = defaultAction(v) as Action;
  const kind = v.pending?.kind;
  const type = kind ? DECISION_TYPES[kind] : undefined;
  if (!type) {
    return fallback; // probe 等：看不到別人的亂數，不值得算
  }
  let best = fallback;
  let bestScore = scoreAfter(v, fallback, me, env);
  for (const a of legalActions(v, env)) {
    if (a.type !== type) continue;
    const score = scoreAfter(v, a, me, env);
    if (score > bestScore + 1e-9) {
      best = a;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 替目前輪到的座位選一個動作。永遠回傳引擎接受的動作（遊戲結束時丟例外）。
 * 傳入的是真實狀態，內部先套用視角過濾，不會偷看牌庫與亂數。
 */
export function smartBot(
  state: GameState,
  env: RulesEnv = NO_CARDS,
  weights: AiWeights = DEFAULT_WEIGHTS,
): Action {
  const me = currentActor(state);
  if (me === null) {
    throw new Error('遊戲已結束，沒有合法動作');
  }
  const fallback = defaultAction(state) as Action;
  const v = redactState(state, me);
  let action: Action;
  const previous = W;
  W = weights;
  try {
    action =
      v.phase === 'roll'
        ? decideRoll(v, me, env)
        : v.phase === 'buy'
          ? decideBuy(v, me, env)
          : decidePrompt(v, me, env);
  } catch {
    return fallback;
  } finally {
    W = previous;
  }
  // 最後一道保險：不被引擎接受就退回保守動作
  return step(state, action, env) ? action : fallback;
}
