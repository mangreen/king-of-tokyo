/**
 * 規則運算層：引擎流程與卡牌效果共用的「改變狀態並產生事件」的基本操作。
 * 所有函式都直接修改 g.s（呼叫端已經 clone 過），並把事件推進 g.ev。
 */
import { EFFECTS } from './cards/effects.js';
import type { Effect } from './cards/effects.js';
import type { CardDef, RulesEnv } from './cards/types.js';
import { nextInt } from './rng.js';
import { aliveMonsters, getMonster, occupantOf } from './state.js';
import type { DamageCause, GameEvent, GameState, Monster, PlanItem, WinReason } from './types.js';

/** 一次動作處理期間的上下文。 */
export interface G {
  s: GameState;
  env: RulesEnv;
  ev: GameEvent[];
  /** 這次動作中新翻開的牌（供「新牌即買」使用）。 */
  revealed: string[];
  /**
   * 買 Discard 卡時，卡牌的傷害先收集起來、買牌結算完才一起處理，
   * 讓受害者有機會使用減傷／反應能力（OQ-C3）。null 表示直接造成傷害。
   */
  deferDamage: { source: number; items: PlanItem[] } | null;
}

/** 一張持有中的卡牌。def 是實際生效的卡（複製卡會指向被複製的卡），base 是這張實體自己。 */
export interface Owned {
  seat: number;
  cardId: string;
  def: CardDef;
  base: CardDef;
}

export function makeG(s: GameState, env: RulesEnv, ev: GameEvent[]): G {
  return { s, env, ev, revealed: [], deferDamage: null };
}

/** 卡牌造成的傷害：買牌結算中先收集（OQ-C3），否則直接造成。 */
export function cardDamage(g: G, source: number, seat: number, amount: number): void {
  const deferred = g.deferDamage;
  if (deferred && deferred.source === source) {
    const existing = deferred.items.find((i) => i.seat === seat);
    if (existing) {
      existing.amount += amount;
    } else if (amount > 0) {
      deferred.items.push({ seat, amount, target: false, asked: false, cause: 'card' });
    }
    return;
  }
  inflict(g, seat, amount, source, 'card');
}

export function cardDef(g: G, id: string): CardDef {
  const def = g.env.cards[id];
  if (!def) {
    throw new Error(`卡牌 ${id} 不在目前的卡牌組中`);
  }
  return def;
}

export function effectOf(def: CardDef): Effect | undefined {
  return EFFECTS[def.effectId];
}

/** 取卡牌參數（數字），沒有就用預設值。 */
export function num(def: CardDef, key: string, fallback = 0): number {
  const v = def.params[key];
  return typeof v === 'number' ? v : fallback;
}

/** 座位持有的所有卡（依購買順序）。複製卡沒有目標時沒有效果，不列入 effective 清單。 */
export function ownedOf(g: G, seat: number): Owned[] {
  const m = getMonster(g.s, seat);
  const out: Owned[] = [];
  for (const cardId of m.cards) {
    const base = g.env.cards[cardId];
    if (!base) {
      continue;
    }
    let def: CardDef | undefined = base;
    if (base.effectId === 'mimic') {
      const ref = m.cardData[cardId]?.ref;
      def = ref ? g.env.cards[ref] : undefined;
    }
    if (def) {
      out.push({ seat, cardId, def, base });
    }
  }
  return out;
}

/** 座位持有、且定義了某個 hook 的效果。 */
export function effectsWith<K extends keyof Effect>(
  g: G,
  seat: number,
  hook: K,
): { e: Effect & Required<Pick<Effect, K>>; o: Owned }[] {
  const out: { e: Effect & Required<Pick<Effect, K>>; o: Owned }[] = [];
  for (const o of ownedOf(g, seat)) {
    const e = effectOf(o.def);
    if (e && e[hook] !== undefined) {
      out.push({ e: e as Effect & Required<Pick<Effect, K>>, o });
    }
  }
  return out;
}

/** 座位是否持有某個 effectId（含複製卡）。 */
export function hasEffect(g: G, seat: number, effectId: string): boolean {
  return ownedOf(g, seat).some((o) => o.def.effectId === effectId);
}

export function findOwned(g: G, seat: number, effectId: string): Owned | undefined {
  return ownedOf(g, seat).find((o) => o.def.effectId === effectId);
}

// ── 資源 ────────────────────────────────────────────────

export type EnergySource = 'dice' | 'card' | 'transfer' | 'refund' | 'reserve';

export function gainVp(
  g: G,
  seat: number,
  amount: number,
  reason: 'dice' | 'card' | 'tokyo_start' | 'enter_tokyo',
): void {
  if (amount <= 0) {
    return;
  }
  getMonster(g.s, seat).vp += amount;
  if (seat === g.s.turn.seat) {
    g.s.turn.vpGained += amount;
  }
  g.ev.push({ type: 'vp_gained', seat, amount, reason });
}

export function loseVp(g: G, seat: number, amount: number): void {
  const m = getMonster(g.s, seat);
  const lost = Math.min(m.vp, amount);
  if (lost <= 0) {
    return;
  }
  m.vp -= lost;
  g.ev.push({ type: 'vp_lost', seat, amount: lost });
}

/** 得到能量。只有骰面與卡牌效果得到的能量會吃「額外能量」加成（OQ-C8）。 */
export function gainEnergy(g: G, seat: number, amount: number, source: EnergySource): number {
  if (amount <= 0) {
    return 0;
  }
  let total = amount;
  if (source === 'dice' || source === 'card') {
    for (const { e, o } of effectsWith(g, seat, 'energyBonus')) {
      total += e.energyBonus(o);
    }
  }
  getMonster(g.s, seat).energy += total;
  g.ev.push({ type: 'energy_gained', seat, amount: total });
  return total;
}

export function spendEnergy(g: G, seat: number, amount: number): void {
  if (amount <= 0) {
    return;
  }
  getMonster(g.s, seat).energy -= amount;
  g.ev.push({ type: 'energy_spent', seat, amount });
}

/** 治療。回傳實際回復量。在東京內骰面治療無效由呼叫端處理。 */
export function heal(g: G, seat: number, amount: number): number {
  if (amount <= 0) {
    return 0;
  }
  const m = getMonster(g.s, seat);
  let total = amount;
  for (const { e, o } of effectsWith(g, seat, 'healBonus')) {
    total += e.healBonus(o);
  }
  const actual = Math.min(total, m.maxHp - m.hp);
  if (actual > 0) {
    m.hp += actual;
    g.ev.push({ type: 'healed', seat, amount: actual });
  }
  return actual;
}

/** 依持有的卡重新計算最大 HP，並把 HP 夾到上限。OQ-C7 */
export function syncMaxHp(g: G, seat: number): void {
  const m = getMonster(g.s, seat);
  let max = g.s.config.startingHp;
  for (const { e, o } of effectsWith(g, seat, 'maxHpBonus')) {
    max += e.maxHpBonus(o);
  }
  if (max !== m.maxHp) {
    m.maxHp = max;
    g.ev.push({ type: 'max_hp_changed', seat, maxHp: max });
  }
  if (m.hp > m.maxHp) {
    m.hp = m.maxHp;
  }
}

export function addCounter(g: G, seat: number, counter: 'poison' | 'shrink', n = 1): void {
  const m = getMonster(g.s, seat);
  m.tokens[counter] += n;
  g.ev.push({ type: 'counter_gained', seat, counter, total: m.tokens[counter] });
}

export function removeCounter(g: G, seat: number, counter: 'poison' | 'shrink', n = 1): void {
  const m = getMonster(g.s, seat);
  m.tokens[counter] = Math.max(0, m.tokens[counter] - n);
  g.ev.push({ type: 'counter_removed', seat, counter, total: m.tokens[counter] });
}

// ── 牌庫與持有 ──────────────────────────────────────────

/** 從牌庫頂抽一張；牌庫空了就把棄牌堆洗回（R-CARD-11）。沒有牌時回傳 null。 */
export function drawCard(g: G): string | null {
  const market = g.s.market;
  if (!market) {
    return null;
  }
  reshuffleIfEmpty(g);
  g.s.turn.peek = null; // 牌庫頂換了，先前偷看到的牌作廢
  return market.deck.shift() ?? null;
}

/** 牌庫空了且棄牌堆有牌時，把棄牌堆洗回牌庫。R-CARD-11 */
export function reshuffleIfEmpty(g: G): void {
  const market = g.s.market;
  if (market && market.deck.length === 0 && market.discard.length > 0) {
    const pile = [...market.discard];
    market.discard = [];
    for (let i = pile.length - 1; i > 0; i -= 1) {
      const [j, next] = nextInt(g.s.rng, i + 1);
      g.s.rng = next;
      const tmp = pile[i] as string;
      pile[i] = pile[j] as string;
      pile[j] = tmp;
    }
    market.deck = pile;
  }
}

/** 把面朝上的牌補到 3 張。 */
export function refillFaceUp(g: G): void {
  const market = g.s.market;
  if (!market) {
    return;
  }
  while (market.faceUp.length < 3) {
    const id = drawCard(g);
    if (id === null) {
      return;
    }
    market.faceUp.push(id);
    g.revealed.push(id);
    g.ev.push({ type: 'card_revealed', cardId: id });
  }
}

export function costFor(g: G, seat: number, def: CardDef): number {
  let cost = def.cost;
  for (const { e, o } of effectsWith(g, seat, 'costDelta')) {
    cost += e.costDelta(o);
  }
  return Math.max(0, cost);
}

/** 讓怪獸持有一張 Keep 卡。 */
export function gainCard(g: G, seat: number, cardId: string): void {
  const m = getMonster(g.s, seat);
  const def = cardDef(g, cardId);
  m.cards.push(cardId);
  m.cardData[cardId] = { n: effectOf(def)?.initialCharges?.(def) ?? 0, ref: null };
  syncMaxHp(g, seat);
}

/**
 * 棄掉持有的卡（進棄牌堆）。複製它的卡會失去目標（R-CARD-54）。
 * 回傳 false 表示沒有這張卡。
 */
export function discardCard(g: G, seat: number, cardId: string, reason: string): boolean {
  const m = getMonster(g.s, seat);
  const index = m.cards.indexOf(cardId);
  if (index < 0) {
    return false;
  }
  const owned = ownedOf(g, seat).find((o) => o.cardId === cardId);
  if (owned) {
    effectOf(owned.def)?.onLeave?.(g, owned);
  }
  m.cards.splice(index, 1);
  delete m.cardData[cardId];
  for (const other of g.s.monsters) {
    for (const data of Object.values(other.cardData)) {
      if (data.ref === cardId) {
        data.ref = null;
      }
    }
  }
  g.s.market?.discard.push(cardId);
  g.ev.push({ type: 'card_discarded', seat, cardId, reason });
  for (const other of g.s.monsters) {
    if (other.alive) syncMaxHp(g, other.seat); // 複製這張卡的怪獸也會失去效果
  }
  return true;
}

export function discardAllCards(g: G, seat: number, reason: string): void {
  for (const cardId of [...getMonster(g.s, seat).cards]) {
    discardCard(g, seat, cardId, reason);
  }
}

// ── 傷害與淘汰 ──────────────────────────────────────────

export interface InflictOptions {
  /** 略過「扣血前」的減傷（已由攻擊流程先套用）。 */
  skipPre?: boolean;
  /** 此傷害不會觸發反射、搭檔等（反射傷害用）。 */
  noReflect?: boolean;
}

/** 套用「扣血前」減傷（忽略 1 點傷害等）。回傳減傷後的傷害。 */
export function mitigatePre(g: G, seat: number, amount: number): number {
  let result = amount;
  for (const { e, o } of effectsWith(g, seat, 'mitigatePre')) {
    if (result <= 0) break;
    const before = result;
    result = e.mitigatePre(g, o, result);
    if (result < before) {
      g.ev.push({ type: 'damage_prevented', seat, amount: before - result, cardId: o.cardId });
    }
  }
  return result;
}

/**
 * 對怪獸造成傷害。回傳實際扣掉的 HP。
 * source = 傷害來源座位（沒有來源為 null）。cause 省略表示骰面攻擊。
 */
export function inflict(
  g: G,
  seat: number,
  amount: number,
  source: number | null,
  cause?: DamageCause,
  options: InflictOptions = {},
): number {
  const m = getMonster(g.s, seat);
  if (!m.alive || amount <= 0 || g.s.phase === 'over') {
    return 0;
  }
  if (g.s.turn.shielded.includes(seat)) {
    g.ev.push({ type: 'damage_prevented', seat, amount, cardId: null });
    return 0;
  }
  let dmg = amount;
  if (options.skipPre !== true) {
    dmg = mitigatePre(g, seat, dmg);
  }
  for (const { e, o } of effectsWith(g, seat, 'mitigatePost')) {
    if (dmg <= 0) break;
    const before = dmg;
    dmg = e.mitigatePost(g, o, dmg);
    if (dmg < before) {
      g.ev.push({ type: 'damage_prevented', seat, amount: before - dmg, cardId: o.cardId });
    }
  }
  dmg = Math.min(dmg, m.hp);
  if (dmg <= 0) {
    return 0;
  }
  m.hp -= dmg;
  const event: Extract<GameEvent, { type: 'damage_taken' }> = {
    type: 'damage_taken',
    seat,
    amount: dmg,
    hp: m.hp,
    source,
  };
  if (cause !== undefined) {
    event.cause = cause;
  }
  g.ev.push(event);
  // 活動怪獸造成的傷害統計（「沒打人」「本回合傷害門檻」類效果）。OQ-C5
  if (source === g.s.turn.seat && source !== seat && cause !== 'poison' && cause !== 'reflect') {
    g.s.turn.dealt += dmg;
    g.s.turn.damagedAnyone = true;
  }

  // 受傷後觸發（受害者）
  for (const { e, o } of effectsWith(g, seat, 'onDamaged')) {
    e.onDamaged(g, o, { amount: dmg, source, cause, noReflect: options.noReflect === true });
  }
  // 造成傷害後觸發（來源）。毒、反射、自傷、讓位傷害不算「造成傷害」給別人加成。
  if (source !== null && source !== seat && cause !== 'poison' && cause !== 'reflect') {
    for (const { e, o } of effectsWith(g, source, 'onDealt')) {
      e.onDealt(g, o, { victim: seat, amount: dmg, cause });
    }
  }
  if (m.hp === 0) {
    zeroHp(g, m, source);
  }
  return dmg;
}

/** HP 歸零：觸發「有人 HP 歸零」效果，再依序嘗試復活、搭檔，否則淘汰。R-CARD-40/41 */
function zeroHp(g: G, v: Monster, killer: number | null): void {
  for (const m of aliveMonsters(g.s)) {
    for (const { e, o } of effectsWith(g, m.seat, 'onAnyZero')) {
      e.onAnyZero(g, o, v.seat);
    }
  }
  const owned = ownedOf(g, v.seat);
  const self = owned.find((o) => effectOf(o.def)?.revive === 'self');
  if (self) {
    const hp = num(self.def, 'hp', 10);
    v.location = null;
    discardAllCards(g, v.seat, 'revived');
    v.vp = 0;
    v.hp = Math.min(hp, v.maxHp);
    g.ev.push({ type: 'revived', seat: v.seat, hp: v.hp, partner: null });
    return;
  }
  const partner = owned.find((o) => effectOf(o.def)?.revive === 'partner');
  if (partner && !v.sidekickUsed && killer !== null && getMonster(g.s, killer).alive) {
    v.location = null;
    v.vp = 0;
    v.hp = Math.min(num(partner.def, 'hp', 10), v.maxHp);
    v.sidekickOf = killer;
    v.sidekickUsed = true;
    g.ev.push({ type: 'revived', seat: v.seat, hp: v.hp, partner: killer });
    return;
  }
  eliminate(g, v, killer);
}

export function eliminate(g: G, v: Monster, by: number | null): void {
  if (!v.alive) {
    return;
  }
  v.alive = false;
  v.hp = 0;
  v.location = null;
  v.energy = 0;
  discardAllCards(g, v.seat, 'eliminated');
  g.ev.push({ type: 'eliminated', seat: v.seat, by });
  // R-CARD-42：擊殺者被淘汰時，搭檔一併淘汰
  for (const m of g.s.monsters) {
    if (m.alive && m.sidekickOf === v.seat) {
      eliminate(g, m, v.seat);
    }
  }
  checkLastStanding(g);
}

/** 只剩 ≤1 位存活者就結束遊戲。R-END-01、R-END-06 */
export function checkLastStanding(g: G): void {
  if (g.s.phase === 'over') {
    return;
  }
  const alive = aliveMonsters(g.s);
  if (alive.length <= 1) {
    endGame(
      g,
      alive.map((m) => m.seat),
      alive.length === 0 ? 'allEliminated' : 'lastStanding',
    );
    return;
  }
  // R-CARD-42：只剩一組搭檔（兩人互為搭檔）時，兩人共同勝利
  const [a, b] = alive;
  if (alive.length === 2 && a && b && (a.sidekickOf === b.seat || b.sidekickOf === a.seat)) {
    endGame(g, [a.seat], 'lastStanding');
  }
}

/** 勝者加上搭檔：任一方勝利則兩人共同勝利。R-CARD-42 */
function withPartners(s: GameState, winners: readonly number[]): number[] {
  const set = new Set(winners);
  for (const w of winners) {
    const m = getMonster(s, w);
    if (!m.alive) continue;
    for (const other of s.monsters) {
      if (other.alive && other.sidekickOf === w) set.add(other.seat);
    }
    if (m.sidekickOf !== null && getMonster(s, m.sidekickOf).alive) {
      set.add(m.sidekickOf);
    }
  }
  return [...set].sort((a, b) => a - b);
}

export function endGame(g: G, winners: readonly number[], reason: WinReason): void {
  const list = winners.length > 0 ? withPartners(g.s, winners) : [];
  g.s.outcome = { winners: list, reason };
  g.s.phase = 'over';
  g.s.pending = null;
  g.ev.push({ type: 'game_over', winners: [...list], reason });
}

// ── 東京 ────────────────────────────────────────────────

/** 讓怪獸離開東京。 */
export function leaveTokyo(g: G, seat: number): void {
  const m = getMonster(g.s, seat);
  if (m.location !== null) {
    g.ev.push({ type: 'yielded', seat, location: m.location });
    m.location = null;
  }
}

/** 強制佔領東京市（原佔領者被迫離開）。官方：在東京灣也算在東京，不處理。R-CARD-05 */
export function takeCity(g: G, seat: number): void {
  const m = getMonster(g.s, seat);
  if (!m.alive || m.location !== null) {
    return;
  }
  const holder = occupantOf(g.s, 'city');
  if (holder) {
    leaveTokyo(g, holder.seat);
  }
  m.location = 'city';
  g.ev.push({ type: 'entered_tokyo', seat, location: 'city' });
  gainVp(g, seat, 1, 'enter_tokyo');
}

/** 順時針的鄰座（存活者）。回傳不重複、不含自己的座位。 */
export function neighborsOf(s: GameState, seat: number): number[] {
  const n = s.config.playerCount;
  const result: number[] = [];
  for (const dir of [1, -1]) {
    for (let i = 1; i < n; i += 1) {
      const other = (((seat + dir * i) % n) + n) % n;
      if (getMonster(s, other).alive) {
        if (other !== seat && !result.includes(other)) {
          result.push(other);
        }
        break;
      }
    }
  }
  return result;
}

/** 從 from 的下一位起順時針的存活座位（不含 from）。 */
export function clockwiseFrom(s: GameState, from: number): number[] {
  const n = s.config.playerCount;
  const out: number[] = [];
  for (let i = 1; i < n; i += 1) {
    const seat = (from + i) % n;
    if (getMonster(s, seat).alive) {
      out.push(seat);
    }
  }
  return out;
}
