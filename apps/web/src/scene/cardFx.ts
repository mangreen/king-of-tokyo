import type { CardDef, InstantOp } from '@kot/rules';

/**
 * 卡牌特效的分類（純函式，不依賴 Three.js，可單元測試）。
 * 卡牌有 70 多張、效果上百種，場景不為每張各做一套，而是依「這張牌做了什麼」分成幾類主題，
 * 每類有自己的 3D 演出與顏色；卡面與怪獸頭上的卡名則一律顯示這張牌自己的名字。
 */
export type CardTheme =
  | 'meteor' // 全體傷害：流星雨
  | 'acid' // 對其他怪獸的持續／腐蝕傷害：酸雨
  | 'blast' // 攻擊強化、爆炸
  | 'stars' // 得分
  | 'bolt' // 能量
  | 'heal' // 治療、最大 HP
  | 'drain' // 奪取、吸取、削減他人
  | 'tokyo' // 空降東京
  | 'extra' // 額外回合
  | 'shield' // 防禦、反擊
  | 'dice' // 骰子相關
  | 'wings' // 移動、飛行
  | 'revive' // 復活
  | 'generic';

export interface ThemeStyle {
  color: string;
  icon: string;
  label: string;
}

export const THEME_STYLE: Record<CardTheme, ThemeStyle> = {
  meteor: { color: '#ff7a2f', icon: '☄️', label: '流星' },
  acid: { color: '#8be04e', icon: '🧪', label: '酸蝕' },
  blast: { color: '#ff4d4d', icon: '💥', label: '爆炸' },
  stars: { color: '#ffd23f', icon: '⭐', label: '得分' },
  bolt: { color: '#ffe14d', icon: '⚡', label: '能量' },
  heal: { color: '#4be08b', icon: '💚', label: '治療' },
  drain: { color: '#b565e6', icon: '🌀', label: '吸取' },
  tokyo: { color: '#7de3ff', icon: '🗼', label: '空降' },
  extra: { color: '#ffb347', icon: '⏩', label: '再一回合' },
  shield: { color: '#7de3ff', icon: '🛡️', label: '防禦' },
  dice: { color: '#f2f2f2', icon: '🎲', label: '骰子' },
  wings: { color: '#dff3ff', icon: '🪽', label: '移動' },
  revive: { color: '#fff3a8', icon: '✨', label: '復活' },
  generic: { color: '#ffffff', icon: '🃏', label: '卡牌' },
};

/** 持續效果（Keep）的效果 id → 主題。沒列到的退回 generic。 */
const KEEP_THEME: Record<string, CardTheme> = {
  armor: 'shield',
  camouflage: 'shield',
  reflect: 'shield',
  counter_attack: 'shield',
  attack_bonus: 'blast',
  neighbor_damage: 'blast',
  nova: 'blast',
  tokyo_attacker: 'blast',
  tokyo_target_bonus: 'blast',
  stomp: 'blast',
  forced_yield: 'blast',
  attack_vp: 'stars',
  big_hit_vp: 'stars',
  death_vp: 'stars',
  complete_set: 'stars',
  end_empty_energy: 'stars',
  end_energy_vp: 'stars',
  end_peaceful_vp: 'stars',
  end_underdog: 'stars',
  energy_to_vp: 'stars',
  straight_vp: 'stars',
  triple_bonus: 'stars',
  vp_on_buy: 'stars',
  batteries: 'bolt',
  energy_bonus: 'bolt',
  lose_hp_energy: 'bolt',
  cost_discount: 'bolt',
  reroll_energy: 'bolt',
  buy_from_others: 'bolt',
  heal_bonus: 'heal',
  heal_others: 'heal',
  rapid_heal: 'heal',
  max_hp: 'heal',
  lifesteal: 'drain',
  opportunist: 'drain',
  die_change: 'dice',
  extra_dice: 'dice',
  extra_rolls: 'dice',
  reroll_charges: 'dice',
  reroll_threes: 'dice',
  probe: 'dice',
  mimic: 'dice',
  metamorph: 'dice',
  peek_buy: 'dice',
  swap_on_yield: 'dice',
  wings: 'wings',
  jets: 'wings',
  super_jump: 'wings',
  revive_partner: 'revive',
  revive_self: 'revive',
  extra_turn_triple: 'extra',
};

const has = (ops: readonly InstantOp[], op: InstantOp['op']): boolean =>
  ops.some((o) => o.op === op);

/** 即時效果（Discard）依步驟決定主題：傷害 > 空降 > 額外回合 > 削減他人 > 能量 > 治療 > 得分。 */
function instantTheme(ops: readonly InstantOp[]): CardTheme {
  if (has(ops, 'damageAll')) return 'meteor';
  if (has(ops, 'damageOthers')) return has(ops, 'vp') ? 'blast' : 'acid';
  if (has(ops, 'takeTokyo')) return 'tokyo';
  if (has(ops, 'extraTurn')) return 'extra';
  if (has(ops, 'othersLoseVp') || has(ops, 'othersLoseEnergyPer')) return 'drain';
  if (has(ops, 'energy')) return 'bolt';
  if (has(ops, 'heal')) return 'heal';
  if (has(ops, 'vp') || has(ops, 'perCard')) return 'stars';
  return 'generic';
}

export function themeOf(def: Pick<CardDef, 'kind' | 'effectId' | 'params'> | undefined): CardTheme {
  if (!def) return 'generic';
  if (def.effectId === 'instant') {
    const ops = def.params['ops'];
    return Array.isArray(ops) ? instantTheme(ops as InstantOp[]) : 'generic';
  }
  return KEEP_THEME[def.effectId] ?? 'generic';
}

/** 場景用的卡牌查詢（卡牌組載入前為空：只演通用特效、卡名退回 id）。 */
export type CardLookup = (id: string) => CardDef | undefined;

export function cardLookup(cards: readonly CardDef[]): CardLookup {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return (id) => byId.get(id);
}
