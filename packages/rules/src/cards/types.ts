/**
 * 卡牌資料型別。卡牌是資料、效果是程式碼，兩者以 effectId 連接（ADR-0004）。
 * 這些型別可序列化（JSON-safe），因此卡牌組可存成 set.json。
 */

export type CardKind = 'keep' | 'discard';

/** Discard 卡的即時效果步驟（effectId = "instant" 時使用）。 */
export type InstantOp =
  | { op: 'vp'; n: number }
  | { op: 'energy'; n: number }
  | { op: 'heal'; n: number }
  | { op: 'selfDamage'; n: number }
  | { op: 'damageOthers'; n: number }
  | { op: 'damageAll'; n: number }
  | { op: 'othersLoseVp'; n: number }
  /** 其他怪獸每 per 點能量失去 1 點。 */
  | { op: 'othersLoseEnergyPer'; per: number }
  | { op: 'takeTokyo' }
  | { op: 'extraTurn' }
  /** 持有的 Keep 卡每一張：得 vp 點 VP 並受 damage 點傷害。 */
  | { op: 'perCard'; vp: number; damage: number };

export type CardParams = Record<string, number | string | boolean | InstantOp[]>;

export interface CardDef {
  /** 卡組內唯一。同名多張的卡以不同 id 表示。 */
  id: string;
  name: string;
  cost: number;
  kind: CardKind;
  /** 顯示用的卡面文字（資料，不影響規則）。 */
  text: string;
  effectId: string;
  params: CardParams;
}

export type CardCatalog = Readonly<Record<string, CardDef>>;

/** 規則引擎需要的外部資料。沒有卡牌時用 NO_CARDS。 */
export interface RulesEnv {
  cards: CardCatalog;
}

export const NO_CARDS: RulesEnv = { cards: {} };
