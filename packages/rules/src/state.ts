import { NO_CARDS } from './cards/types.js';
import type { RulesEnv } from './cards/types.js';
import { rollDie } from './dice.js';
import { nextInt, seedToState } from './rng.js';
import type { RngState } from './rng.js';
import type {
  GameEvent,
  GameState,
  Market,
  Monster,
  Pending,
  RulesConfig,
  TurnState,
} from './types.js';

/** 東京灣可用所需的最少存活怪獸數。R-TOKYO-09 */
export const BAY_MIN_ALIVE = 5;

/** 預設設定（R-SETUP-01、R-DICE-01、R-END-02）。 */
export function defaultConfig(playerCount: number): RulesConfig {
  return { playerCount, startingHp: 10, victoryPoints: 20, diceCount: 6, maxRolls: 3 };
}

export function validateConfig(config: RulesConfig): void {
  const ints: [string, number, number, number][] = [
    ['playerCount', config.playerCount, 2, 6],
    ['startingHp', config.startingHp, 1, 99],
    ['victoryPoints', config.victoryPoints, 1, 999],
    ['diceCount', config.diceCount, 1, 12],
    ['maxRolls', config.maxRolls, 1, 10],
  ];
  for (const [name, value, min, max] of ints) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new RangeError(`${name} 必須是 ${min}–${max} 的整數，收到 ${String(value)}`);
    }
  }
}

/** 一個新回合的初始狀態。 */
export function newTurn(seat: number, diceCount: number, dicePenalty = 0): TurnState {
  return {
    seat,
    rollsUsed: 0,
    dice: [],
    diceCount,
    bonusRolls: 0,
    used: [],
    shielded: [],
    vpGained: 0,
    dealt: 0,
    damagedAnyone: false,
    peek: null,
    extraTurn: null,
    dicePenalty,
    tripleOnes: false,
    attackTargets: [],
    hit: [],
  };
}

export function newMonster(seat: number, hp: number): Monster {
  return {
    seat,
    hp,
    maxHp: hp,
    vp: 0,
    energy: 0,
    alive: true,
    location: null,
    cards: [],
    tokens: { poison: 0, shrink: 0 },
    cardData: {},
    sidekickOf: null,
    sidekickUsed: false,
  };
}

function clonePending(p: Pending | null): Pending | null {
  if (!p) {
    return null;
  }
  switch (p.kind) {
    case 'yield':
      return { kind: 'yield', attacker: p.attacker, queue: [...p.queue] };
    case 'react':
      return { ...p, plan: p.plan.map((i) => ({ ...i })) };
    case 'hearts':
      return { ...p };
    case 'probe':
      return { kind: 'probe', queue: [...p.queue] };
    case 'opportunity':
      return { kind: 'opportunity', queue: p.queue.map((q) => ({ ...q })) };
  }
}

function cloneMarket(m: Market | null): Market | null {
  return m ? { deck: [...m.deck], faceUp: [...m.faceUp], discard: [...m.discard] } : null;
}

/** 深拷貝。狀態是純資料，所以手動複製即可（不依賴 structuredClone）。 */
export function cloneState(state: GameState): GameState {
  return {
    config: { ...state.config },
    rng: state.rng,
    version: state.version,
    phase: state.phase,
    firstSeat: state.firstSeat,
    round: state.round,
    monsters: state.monsters.map((m) => ({
      ...m,
      cards: [...m.cards],
      tokens: { ...m.tokens },
      cardData: Object.fromEntries(Object.entries(m.cardData).map(([k, v]) => [k, { ...v }])),
    })),
    turn: {
      ...state.turn,
      dice: [...state.turn.dice],
      used: [...state.turn.used],
      shielded: [...state.turn.shielded],
      extraTurn: state.turn.extraTurn ? { ...state.turn.extraTurn } : null,
      attackTargets: [...state.turn.attackTargets],
      hit: [...state.turn.hit],
    },
    pending: clonePending(state.pending),
    market: cloneMarket(state.market),
    stomp: [...state.stomp],
    outcome: state.outcome
      ? { winners: [...state.outcome.winners], reason: state.outcome.reason }
      : null,
  };
}

export function getMonster(state: GameState, seat: number): Monster {
  const monster = state.monsters[seat];
  if (!monster) {
    throw new RangeError(`座位 ${String(seat)} 不存在`);
  }
  return monster;
}

export function aliveMonsters(state: GameState): Monster[] {
  return state.monsters.filter((m) => m.alive);
}

/** 東京灣目前是否可用。 */
export function isBayOpen(state: GameState): boolean {
  return aliveMonsters(state).length >= BAY_MIN_ALIVE;
}

/** 座位在「一輪」中的位置（先手為 0）。R-END-08 */
export function roundPosition(state: GameState, seat: number): number {
  const n = state.config.playerCount;
  return (seat - state.firstSeat + n) % n;
}

/** 順時針的下一位存活座位；只剩自己時回傳自己。 */
export function nextAliveSeat(state: GameState, from: number): number {
  const n = state.config.playerCount;
  for (let i = 1; i < n; i += 1) {
    const seat = (from + i) % n;
    if (getMonster(state, seat).alive) {
      return seat;
    }
  }
  return from;
}

/** 目前佔住指定東京位置的怪獸（沒有則為 undefined）。 */
export function occupantOf(state: GameState, location: 'city' | 'bay'): Monster | undefined {
  return state.monsters.find((m) => m.alive && m.location === location);
}

/**
 * 建立新遊戲：決定先手並開始第一位玩家的回合。R-SETUP-01 ~ 05
 * 同一個 config + seed（與卡牌目錄）一定產生相同的結果。
 */
export function createGame(
  config: RulesConfig,
  seed: number,
  env: RulesEnv = NO_CARDS,
): { state: GameState; events: GameEvent[] } {
  validateConfig(config);
  let rng: RngState = seedToState(seed);

  // R-SETUP-04：每人擲骰比攻擊面，平手者重擲。迴圈設上限避免理論上的無窮迴圈。
  let candidates = Array.from({ length: config.playerCount }, (_, seat) => seat);
  const rounds: { seat: number; attacks: number }[][] = [];
  for (let attempt = 0; attempt < 100 && candidates.length > 1; attempt += 1) {
    const round: { seat: number; attacks: number }[] = [];
    for (const seat of candidates) {
      let attacks = 0;
      for (let i = 0; i < config.diceCount; i += 1) {
        const [face, next] = rollDie(rng);
        rng = next;
        if (face === 'attack') {
          attacks += 1;
        }
      }
      round.push({ seat, attacks });
    }
    rounds.push(round);
    const best = Math.max(...round.map((r) => r.attacks));
    candidates = round.filter((r) => r.attacks === best).map((r) => r.seat);
  }
  // 上限內仍平手（預設設定下機率可忽略）時取最小座位，確保結果確定
  const firstSeat = Math.min(...candidates);

  const monsters: Monster[] = Array.from({ length: config.playerCount }, (_, seat) =>
    newMonster(seat, config.startingHp),
  );

  // R-CARD-10：洗牌（Fisher–Yates，用遊戲 RNG）並翻開 3 張
  let market: Market | null = null;
  const events: GameEvent[] = [{ type: 'first_player_decided', rounds, firstSeat }];
  const ids = Object.keys(env.cards);
  if (ids.length > 0) {
    const deck = [...ids];
    for (let i = deck.length - 1; i > 0; i -= 1) {
      const [j, next] = nextInt(rng, i + 1);
      rng = next;
      const tmp = deck[i] as string;
      deck[i] = deck[j] as string;
      deck[j] = tmp;
    }
    const faceUp = deck.splice(0, Math.min(3, deck.length));
    market = { deck, faceUp, discard: [] };
    for (const cardId of faceUp) {
      events.push({ type: 'card_revealed', cardId });
    }
  }
  events.push({ type: 'turn_started', seat: firstSeat, round: 1 });

  const state: GameState = {
    config: { ...config },
    rng,
    version: 0,
    phase: 'roll',
    firstSeat,
    round: 1,
    monsters,
    turn: newTurn(firstSeat, config.diceCount),
    pending: null,
    market,
    stomp: [],
    outcome: null,
  };

  return { state, events };
}
