/**
 * 稽核：卡牌造成的事件，前面一定要有 card_used／card_triggered／card_bought「掛名」，
 * 否則提示不知道是哪張牌做的，事件就只剩事件日誌看得到。
 * 用機器人把真實卡組（card-sets/original）打很多局，檢查有沒有「沒有主人」的卡牌事件。
 */
import { describe, expect, it } from 'vitest';
import original from '../../../card-sets/original/set.json';
import { greedyBot, randomBot } from './bot.js';
import type { CardDef } from './cards/types.js';
import { applyAction } from './engine.js';
import { seedToState } from './rng.js';
import { createGame, defaultConfig } from './state.js';
import { makeEnv } from './test-utils.js';
import type { Action, GameEvent } from './types.js';

/** 只會由卡牌產生的事件類型：一定要有主人。 */
const CARD_ONLY = ['die_changed', 'die_rerolled', 'card_swapped', 'deck_peeked', 'rolls_added'];

const isCardOrigin = (e: GameEvent): boolean => {
  if (CARD_ONLY.includes(e.type)) return true;
  if (e.type === 'damage_taken') return e.cause === 'card';
  if (e.type === 'energy_gained') return e.source === 'card';
  if (e.type === 'vp_gained') return e.reason === 'card';
  return false;
};

describe('卡牌事件都有「主人」（card_used／card_triggered／card_bought）', () => {
  it('機器人打 120 局真實卡組：沒有沒掛名的卡牌事件', () => {
    const cards = (original as unknown as { cards: CardDef[] }).cards;
    const env = makeEnv(...cards);
    const orphans = new Map<string, string>();
    const owners = new Set<string>();
    for (let seed = 1; seed <= 120; seed += 1) {
      let { state } = createGame(defaultConfig(2 + (seed % 5)), seed, env);
      let rng = seedToState(seed * 31);
      for (let step = 0; step < 4000 && state.phase !== 'over'; step += 1) {
        let action: Action;
        if (seed % 2 === 0) {
          action = greedyBot(state, env);
        } else {
          const [a, next] = randomBot(state, rng, env);
          action = a;
          rng = next;
        }
        const r = applyAction(state, action, env);
        if (!r.ok) break;
        state = r.state;
        let owned = false;
        for (const e of r.events) {
          if (e.type === 'card_used' || e.type === 'card_triggered' || e.type === 'card_bought') {
            owned = true;
            owners.add(e.cardId);
          } else if (e.type === 'turn_started' || e.type === 'turn_ended' || e.type === 'smash') {
            owned = false;
          } else if (!owned && isCardOrigin(e)) {
            orphans.set(e.type, `${JSON.stringify(action)} → ${JSON.stringify(r.events)}`);
          }
        }
      }
    }
    expect([...orphans]).toEqual([]);
    expect(owners.size).toBeGreaterThan(30); // 確認真的有跑到很多張卡
  });
});
