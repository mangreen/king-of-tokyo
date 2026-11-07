/**
 * 規則引擎的資料型別。所有型別都是可序列化的純資料（JSON-safe），
 * 才能存進日誌、經由網路傳送、重放。
 */
import type { RngState } from './rng.js';

/** 骰面：1、2、3、能量、攻擊（Smash）、治療（Heal）。R-DICE-03 */
export type Face = 1 | 2 | 3 | 'energy' | 'attack' | 'heal';

export const FACES: readonly Face[] = [1, 2, 3, 'energy', 'attack', 'heal'];

/** 東京位置：null 表示在東京外。 */
export type TokyoLocation = 'city' | 'bay';

export interface Monster {
  /** 座位編號，0 起算，順時針遞增。 */
  readonly seat: number;
  hp: number;
  maxHp: number;
  vp: number;
  energy: number;
  alive: boolean;
  location: TokyoLocation | null;
  /** 持有的 Keep 卡 id，依購買順序。 */
  cards: string[];
  /** 指示物（Poison／Shrink）。留在怪獸身上，不隨卡牌離場。 */
  tokens: { poison: number; shrink: number };
  /** 持有中卡牌的動態資料（充能、複製目標等），key 是卡牌 id。 */
  cardData: Record<string, CardData>;
  /** 搭檔關係：此怪獸是哪位擊殺者的搭檔（無則 null）。R-CARD-42 */
  sidekickOf: number | null;
  /** 搭檔卡是否已用過（第二次淘汰無效）。 */
  sidekickUsed: boolean;
}

/** 單張持有中卡牌的動態資料。 */
export interface CardData {
  /** 計數（剩餘充能等）。 */
  n: number;
  /** 參照的卡牌 id（複製目標）。 */
  ref: string | null;
}

/** 牌庫、面朝上的商店與棄牌堆。R-CARD-10 */
export interface Market {
  /** 牌庫，index 0 是最上面。對非當事人的視角會被抹去內容（見 view.ts）。 */
  deck: string[];
  faceUp: string[];
  discard: string[];
}

export interface RulesConfig {
  /** 2–6。R-SETUP-01 */
  playerCount: number;
  /** 起始與預設上限 HP。 */
  startingHp: number;
  /** 勝利所需 VP。 */
  victoryPoints: number;
  /** 黑骰數量。 */
  diceCount: number;
  /** 每回合最多擲幾次。R-DICE-01 */
  maxRolls: number;
}

/** roll 擲骰與結算前；prompt 等待某位怪獸的決定；buy 買牌階段；over 結束。 */
export type Phase = 'roll' | 'prompt' | 'buy' | 'over';

export interface TurnState {
  seat: number;
  /** 已擲次數（0 = 尚未擲）。 */
  rollsUsed: number;
  /** 目前的骰面；尚未擲時為空陣列。 */
  dice: Face[];
  /** 本回合的骰子數（回合開始時決定）。R-CARD-21 */
  diceCount: number;
  /** 額外重擲次數（卡牌能力使用後累加）。 */
  bonusRolls: number;
  /** 本回合已使用過的「每回合一次」卡牌 id。 */
  used: string[];
  /** 本回合內免傷的座位。R-CARD-34 */
  shielded: number[];
  /** 本回合內活動怪獸得到的 VP。 */
  vpGained: number;
  /** 本回合內活動怪獸實際造成的傷害總和。 */
  dealt: number;
  /** 活動怪獸本回合是否曾實際傷到別人（用於「沒打人」類效果）。 */
  damagedAnyone: boolean;
  /** 窺看到的牌庫頂（只有活動怪獸看得到）。R-CARD-51 */
  peek: string | null;
  /** 本回合結束後的額外回合：骰子減幾顆。null = 沒有。R-CARD-56 */
  extraTurn: { dicePenalty: number } | null;
  /** 本回合是否是額外回合，以及它的骰子減量（回合開始時套用）。 */
  dicePenalty: number;
  /** 本回合是否滿足「連三個 1」（供額外回合卡使用）。 */
  tripleOnes: boolean;
  /** 本回合骰面攻擊的所有目標座位（用於讓位詢問）。 */
  attackTargets: number[];
  /** 本回合骰面攻擊實際被傷到的座位。 */
  hit: number[];
}

/** 待決定事項。每一種都由固定的動作回應。 */
export type Pending =
  /** 東京內怪獸決定是否讓位。R-TOKYO-04 */
  | { kind: 'yield'; attacker: number; queue: number[] }
  /** 被骰面攻擊的怪獸決定是否使用反應能力。R-CARD-34 */
  | { kind: 'react'; seat: number; attacker: number; plan: PlanItem[]; index: number }
  /** 活動怪獸分配治療面。R-CARD-60 */
  | { kind: 'hearts'; seat: number; hearts: number }
  /** 持有「重擲他人骰子」的怪獸依序決定。 */
  | { kind: 'probe'; queue: number[] }
  /** 新翻開的牌可被持有者立即購買。R-CARD-52 */
  | { kind: 'opportunity'; queue: { seat: number; cardId: string }[] };

/** 攻擊計畫中的一筆傷害。 */
export interface PlanItem {
  seat: number;
  amount: number;
  /** 是否為骰面攻擊的目標（鄰座額外傷害為 false）。 */
  target: boolean;
  /** 是否已經詢問過反應（避免重複詢問）。 */
  asked: boolean;
}

export type WinReason = 'lastStanding' | 'turnEnd' | 'roundEnd' | 'allEliminated';

export interface Outcome {
  /** 勝者座位集合（支援多位，OQ-4）。allEliminated 時為空。 */
  winners: number[];
  reason: WinReason;
}

export interface GameState {
  config: RulesConfig;
  rng: RngState;
  /** 每套用一個動作加 1。 */
  version: number;
  phase: Phase;
  /** 先手座位，用來決定「一輪」的邊界。R-END-08 */
  firstSeat: number;
  /** 目前第幾輪（1 起算）。 */
  round: number;
  monsters: Monster[];
  turn: TurnState;
  pending: Pending | null;
  /** 卡牌商店；沒有卡牌時為 null。 */
  market: Market | null;
  /** 「全場少擲一顆」效果的持有者座位。R-CARD-63 */
  stomp: number[];
  outcome: Outcome | null;
}

// ── 動作 ────────────────────────────────────────────────

/** 使用卡牌能力時的附加參數（依能力而定，未用到的欄位省略）。 */
export interface UseArgs {
  /** 骰子索引（改骰、重擲他人骰子）。 */
  die?: number;
  /** 指定的骰面（改骰）。 */
  face?: Face;
  /** 複製目標的卡牌 id。 */
  target?: string;
  /** 要賣掉的卡牌 id 清單。 */
  cards?: string[];
}

export type Action =
  /** keep：要保留（不重擲）的骰子索引。首擲必須為空。 */
  | { type: 'roll'; seat: number; keep: number[] }
  | { type: 'endRolling'; seat: number }
  /** takeCard：讓位時從接手者拿走的卡牌 id（需持有讓位換卡能力）。 */
  | { type: 'yieldDecision'; seat: number; leave: boolean; takeCard?: string }
  /** 買牌：from 缺省為商店面朝上；'deck' 為窺看過的牌庫頂；數字為向該座位買。 */
  | {
      type: 'buy';
      seat: number;
      cardId: string;
      from?: 'deck' | number;
      /** 電池類卡：放上去的能量。 */
      energy?: number;
      /** 複製類卡：複製目標。 */
      target?: string;
    }
  | { type: 'sweep'; seat: number }
  | { type: 'endTurn'; seat: number }
  /** 使用持有中卡牌的主動能力。 */
  | { type: 'useCard'; seat: number; cardId: string; args?: UseArgs }
  /** react：使用的能力卡 id；null = 不使用（結束反應）。 */
  | { type: 'reactDecision'; seat: number; cardId: string | null }
  /** 分配治療面。 */
  | {
      type: 'heartsDecision';
      seat: number;
      self: number;
      poison: number;
      shrink: number;
      others: { seat: number; amount: number }[];
    }
  /** 重擲他人的一顆骰子；die = null 表示不使用。 */
  | { type: 'probeDecision'; seat: number; die: number | null; target?: number }
  | { type: 'opportunityDecision'; seat: number; buy: boolean };

export type ErrorCode =
  | 'game_over'
  | 'not_your_turn'
  | 'wrong_phase'
  | 'invalid_keep'
  | 'invalid_action'
  | 'no_rolls_left'
  | 'roll_first'
  | 'not_enough_energy'
  | 'card_unavailable'
  | 'cannot_use';

export type ActionResult =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: ErrorCode };

// ── 事件（供 3D 演出回放，ADR-0003）──────────────────────

export type VpReason = 'tokyo_start' | 'enter_tokyo' | 'dice' | 'card';

/** 非骰面攻擊的傷害原因；骰面攻擊省略此欄位。 */
export type DamageCause = 'card' | 'poison' | 'reflect' | 'yield' | 'extra' | 'self';

export type GameEvent =
  | {
      type: 'first_player_decided';
      /** 每一輪擲骰的攻擊面數；平手者才會進入下一輪。 */
      rounds: { seat: number; attacks: number }[][];
      firstSeat: number;
    }
  | { type: 'turn_started'; seat: number; round: number }
  | { type: 'vp_gained'; seat: number; amount: number; reason: VpReason }
  | { type: 'vp_lost'; seat: number; amount: number }
  | {
      type: 'dice_rolled';
      seat: number;
      rollNumber: number;
      dice: Face[];
      /** 本次重擲的骰子索引。 */
      rerolled: number[];
    }
  | { type: 'rolling_ended'; seat: number; dice: Face[] }
  | { type: 'energy_gained'; seat: number; amount: number }
  | { type: 'energy_spent'; seat: number; amount: number }
  | { type: 'healed'; seat: number; amount: number }
  /** 在東京內擲出治療面：無效。R-HEAL-02 */
  | { type: 'heal_ignored'; seat: number; faces: number }
  | { type: 'smash'; attacker: number; damage: number; targets: number[] }
  | {
      type: 'damage_taken';
      seat: number;
      amount: number;
      hp: number;
      source: number | null;
      cause?: DamageCause;
    }
  /** 傷害被卡牌能力減免（amount 為被免除的點數）。 */
  | { type: 'damage_prevented'; seat: number; amount: number; cardId: string | null }
  | { type: 'eliminated'; seat: number; by: number | null }
  /** 復活：HP 歸零但因卡牌繼續遊戲。R-CARD-40 */
  | { type: 'revived'; seat: number; hp: number; partner: number | null }
  | { type: 'yield_requested'; seat: number; attacker: number }
  | { type: 'yielded'; seat: number; location: TokyoLocation }
  | { type: 'stayed'; seat: number }
  | { type: 'entered_tokyo'; seat: number; location: TokyoLocation }
  /** 東京灣關閉（存活 ≤4）。movedTo 為 city 表示改移到東京市。R-TOKYO-09 */
  | { type: 'bay_closed'; seat: number; movedTo: 'city' | null }
  // ── 卡牌 ──
  | { type: 'card_revealed'; cardId: string }
  | { type: 'market_swept'; seat: number; discarded: string[] }
  | { type: 'card_bought'; seat: number; cardId: string; cost: number; from: number | null }
  | { type: 'card_discarded'; seat: number | null; cardId: string; reason: string }
  | { type: 'card_used'; seat: number; cardId: string }
  | { type: 'card_swapped'; seat: number; gave: string; took: string; from: number }
  | { type: 'die_changed'; seat: number; index: number; face: Face }
  | { type: 'die_rerolled'; by: number; seat: number; index: number; face: Face }
  | { type: 'counter_gained'; seat: number; counter: 'poison' | 'shrink'; total: number }
  | { type: 'counter_removed'; seat: number; counter: 'poison' | 'shrink'; total: number }
  | { type: 'max_hp_changed'; seat: number; maxHp: number }
  | { type: 'extra_turn_granted'; seat: number }
  /** 窺看牌庫頂；對非當事人視角 cardId 為 null。 */
  | { type: 'deck_peeked'; seat: number; cardId: string | null }
  | { type: 'dice_penalty'; seats: number[] }
  | { type: 'turn_ended'; seat: number }
  | { type: 'round_ended'; round: number }
  | { type: 'game_over'; winners: number[]; reason: WinReason };
