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
  /** 持有的 Keep 卡 id（M3 起使用）。 */
  cards: string[];
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

export type Phase = 'roll' | 'yield' | 'over';

export interface TurnState {
  seat: number;
  /** 已擲次數（0 = 尚未擲）。 */
  rollsUsed: number;
  /** 目前的骰面；尚未擲時為空陣列。 */
  dice: Face[];
}

/** 等待東京內怪獸決定是否讓位。R-TOKYO-04 */
export interface PendingYield {
  attacker: number;
  /** 尚未決定的座位，queue[0] 是現在要決定的人。 */
  queue: number[];
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
  pending: PendingYield | null;
  outcome: Outcome | null;
}

// ── 動作 ────────────────────────────────────────────────

export type Action =
  /** keep：要保留（不重擲）的骰子索引。首擲必須為空。 */
  | { type: 'roll'; seat: number; keep: number[] }
  | { type: 'endRolling'; seat: number }
  | { type: 'yieldDecision'; seat: number; leave: boolean };

export type ErrorCode =
  | 'game_over'
  | 'not_your_turn'
  | 'wrong_phase'
  | 'invalid_keep'
  | 'invalid_action'
  | 'no_rolls_left'
  | 'roll_first';

export type ActionResult =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: ErrorCode };

// ── 事件（供 3D 演出回放，ADR-0003）──────────────────────

export type VpReason = 'tokyo_start' | 'enter_tokyo' | 'dice';

export type GameEvent =
  | {
      type: 'first_player_decided';
      /** 每一輪擲骰的攻擊面數；平手者才會進入下一輪。 */
      rounds: { seat: number; attacks: number }[][];
      firstSeat: number;
    }
  | { type: 'turn_started'; seat: number; round: number }
  | { type: 'vp_gained'; seat: number; amount: number; reason: VpReason }
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
  | { type: 'healed'; seat: number; amount: number }
  /** 在東京內擲出治療面：無效。R-HEAL-02 */
  | { type: 'heal_ignored'; seat: number; faces: number }
  | { type: 'smash'; attacker: number; damage: number; targets: number[] }
  | { type: 'damage_taken'; seat: number; amount: number; hp: number; source: number }
  | { type: 'eliminated'; seat: number; by: number }
  | { type: 'yield_requested'; seat: number; attacker: number }
  | { type: 'yielded'; seat: number; location: TokyoLocation }
  | { type: 'stayed'; seat: number }
  | { type: 'entered_tokyo'; seat: number; location: TokyoLocation }
  /** 東京灣關閉（存活 ≤4）。movedTo 為 city 表示改移到東京市。R-TOKYO-09 */
  | { type: 'bay_closed'; seat: number; movedTo: 'city' | null }
  | { type: 'turn_ended'; seat: number }
  | { type: 'round_ended'; round: number }
  | { type: 'game_over'; winners: number[]; reason: WinReason };
