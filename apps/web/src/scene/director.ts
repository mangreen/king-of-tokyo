import type { DamageCause, GameEvent } from '@kot/rules';
import type { ShotSpec } from './shots.js';

/**
 * 事件導演（純函式）：把伺服器送來的 GameEvent 轉成一條「提示（cue）時間軸」。
 * 動畫只是事件的重播——不影響遊戲狀態、可以跳過；怪獸的位置與存活由狀態決定，
 * cue 只負責「怎麼演」（撲擊、受擊、特效、鏡頭）。ADR-0003。
 */

export type Power = 'light' | 'medium' | 'heavy';

export type Cue =
  | { kind: 'focus'; at: number; seat: number }
  | { kind: 'lunge'; at: number; dur: number; seat: number; targets: number[]; power: Power }
  | {
      kind: 'hit';
      at: number;
      seat: number;
      amount: number;
      /** 受傷後的 HP（畫面上的血量在這一刻才更新）。 */
      hp: number;
      power: Power;
      by: number | null;
      cause: DamageCause | 'attack';
    }
  | { kind: 'hitstop'; at: number; dur: number }
  | { kind: 'stomp'; at: number; seat: number; location: 'city' | 'bay' }
  | { kind: 'leave'; at: number; seat: number }
  | { kind: 'ko'; at: number; seat: number; by: number | null }
  | { kind: 'pickup'; at: number; seat: number; what: 'energy' | 'heal' | 'vp'; amount: number }
  | { kind: 'shield'; at: number; seat: number; amount: number }
  | { kind: 'card'; at: number; seat: number; cardId: string }
  | { kind: 'victory'; at: number; seats: number[] }
  | { kind: 'shot'; at: number; dur: number; spec: ShotSpec };

export interface Timeline {
  cues: Cue[];
  /** 全部播完需要的毫秒數。 */
  duration: number;
}

/** 撲擊從開始到「打到」的時間。 */
export const IMPACT_DELAY = 380;
export const LUNGE_DURATION = 700;
/** 單一批事件最長播放時間；超過就整體加速。 */
export const MAX_DURATION = 7000;
export const MIN_SPEEDUP = 0.4;

export function powerOf(amount: number): Power {
  if (amount >= 5) return 'heavy';
  if (amount >= 3) return 'medium';
  return 'light';
}

/** 命中停頓（ADR-0003：60–120ms）。 */
export function hitstopFor(power: Power): number {
  return power === 'heavy' ? 120 : power === 'medium' ? 90 : 60;
}

const cueEnd = (c: Cue): number => {
  switch (c.kind) {
    case 'lunge':
    case 'shot':
    case 'hitstop':
      return c.at + c.dur;
    default:
      return c.at + 400;
  }
};

interface PendingAttack {
  attacker: number;
  impactAt: number;
  power: Power;
  end: number;
}

export function directEvents(events: readonly GameEvent[]): Timeline {
  const cues: Cue[] = [];
  let t = 0;
  let pending: PendingAttack | null = null;

  /** 撲擊告一段落：時間軸推進到撞擊後。 */
  const flush = (): void => {
    if (pending) {
      t = Math.max(t, pending.end);
      pending = null;
    }
  };

  for (const e of events) {
    switch (e.type) {
      case 'turn_started':
        flush();
        cues.push({ kind: 'focus', at: t, seat: e.seat });
        t += 350;
        break;

      case 'smash': {
        flush();
        const power = powerOf(e.damage);
        cues.push({
          kind: 'lunge',
          at: t,
          dur: LUNGE_DURATION,
          seat: e.attacker,
          targets: [...e.targets],
          power,
        });
        if (power === 'heavy') {
          cues.push({
            kind: 'shot',
            at: t,
            dur: 1100,
            spec: { type: 'lowHero', seat: e.attacker, targets: [...e.targets] },
          });
        }
        pending = {
          attacker: e.attacker,
          impactAt: t + IMPACT_DELAY,
          power,
          end: t + IMPACT_DELAY + 280,
        };
        break;
      }

      case 'damage_taken': {
        const power = powerOf(e.amount);
        // 骰子攻擊造成的傷害（沒有 cause）掛在撲擊的撞擊點；其餘（毒、卡牌、反彈…）獨立演出
        if (pending && e.cause === undefined && e.source === pending.attacker) {
          const stop = hitstopFor(power);
          cues.push({
            kind: 'hit',
            at: pending.impactAt,
            seat: e.seat,
            amount: e.amount,
            hp: e.hp,
            power,
            by: e.source,
            cause: 'attack',
          });
          cues.push({ kind: 'hitstop', at: pending.impactAt, dur: stop });
          pending.end = Math.max(pending.end, pending.impactAt + stop + 260);
          if (power === 'medium' && pending.power !== 'heavy') {
            cues.push({
              kind: 'shot',
              at: pending.impactAt - 150,
              dur: 900,
              spec: { type: 'pushIn', seat: e.seat },
            });
          }
        } else {
          flush();
          cues.push({
            kind: 'hit',
            at: t,
            seat: e.seat,
            amount: e.amount,
            hp: e.hp,
            power,
            by: e.source,
            cause: e.cause ?? 'attack',
          });
          cues.push({ kind: 'hitstop', at: t, dur: hitstopFor(power) });
          t += 380;
        }
        break;
      }

      case 'damage_prevented':
        cues.push({
          kind: 'shield',
          at: pending ? pending.impactAt : t,
          seat: e.seat,
          amount: e.amount,
        });
        if (!pending) t += 250;
        break;

      case 'entered_tokyo':
        flush();
        cues.push({ kind: 'stomp', at: t, seat: e.seat, location: e.location });
        cues.push({ kind: 'shot', at: t, dur: 950, spec: { type: 'pushIn', seat: e.seat } });
        t += 650;
        break;

      case 'yielded':
        flush();
        cues.push({ kind: 'leave', at: t, seat: e.seat });
        t += 500;
        break;

      case 'eliminated':
        flush();
        cues.push({ kind: 'ko', at: t, seat: e.seat, by: e.by });
        cues.push({ kind: 'shot', at: t, dur: 1400, spec: { type: 'closeUp', seat: e.seat } });
        t += 1300;
        break;

      case 'energy_gained':
        flush();
        cues.push({ kind: 'pickup', at: t, seat: e.seat, what: 'energy', amount: e.amount });
        t += 120;
        break;
      case 'healed':
        flush();
        cues.push({ kind: 'pickup', at: t, seat: e.seat, what: 'heal', amount: e.amount });
        t += 120;
        break;
      case 'vp_gained':
        flush();
        cues.push({ kind: 'pickup', at: t, seat: e.seat, what: 'vp', amount: e.amount });
        t += 120;
        break;

      case 'card_bought':
      case 'card_used':
        flush();
        cues.push({ kind: 'card', at: t, seat: e.seat, cardId: e.cardId });
        t += 200;
        break;

      case 'game_over': {
        flush();
        cues.push({ kind: 'victory', at: t, seats: [...e.winners] });
        const star = e.winners[0];
        if (star !== undefined) {
          cues.push({ kind: 'shot', at: t, dur: 3200, spec: { type: 'orbit', seat: star } });
        }
        t += 3200;
        break;
      }

      default:
        // 擲骰、首位決定、輪次結束等：由 HUD／3D 骰子處理，場景不演
        break;
    }
  }
  flush();

  cues.sort((a, b) => a.at - b.at);
  let duration = cues.reduce((m, c) => Math.max(m, cueEnd(c)), 0);
  if (duration > MAX_DURATION) {
    const k = Math.max(MIN_SPEEDUP, MAX_DURATION / duration);
    for (const c of cues) {
      c.at = Math.round(c.at * k);
      if (c.kind === 'lunge' || c.kind === 'shot') c.dur = Math.round(c.dur * k);
    }
    duration = cues.reduce((m, c) => Math.max(m, cueEnd(c)), 0);
  }
  return { cues, duration };
}
