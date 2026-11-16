import { describe, expect, it } from 'vitest';
import { createGame, defaultConfig, legalActions, type CardDef, type GameState } from '@kot/rules';
import { envOf } from '../actions.js';
import { isShopOpen, toSnapshot } from './snapshot.js';

const room = { players: [{ id: 'me', nickname: 'A', seat: 0, monster: null }] } as never;
const state = {
  config: { playerCount: 2 },
  monsters: [],
  market: { faceUp: ['a', 'b', 'c'] },
} as never;

describe('toSnapshot 商店', () => {
  it('商店開著（買得起）→ shop 帶商店翻開的牌，飛碟才入場', () => {
    expect(toSnapshot(room, state, 0, 'me', true).shop).toEqual(['a', 'b', 'c']);
  });
  it('商店沒開（預設）→ shop 為 null，飛碟離場', () => {
    expect(toSnapshot(room, state, 0, 'me').shop).toBeNull();
    expect(toSnapshot(room, state, 0, 'me', false).shop).toBeNull();
  });
});

describe('isShopOpen（飛碟入場條件）', () => {
  const cards: CardDef[] = Array.from({ length: 12 }, (_, i) => ({
    id: `c${String(i)}`,
    name: `卡${String(i)}`,
    cost: 5,
    kind: 'keep' as const,
    text: '',
    effectId: 'max_hp',
    params: { n: 2 },
  }));
  const env = envOf(cards);
  const buyPhase = (energy: number): GameState => {
    const { state } = createGame(defaultConfig(2), 7, env);
    const s: GameState = structuredClone(state);
    s.phase = 'buy';
    const m = s.monsters.find((x) => x.seat === s.turn.seat);
    if (m) m.energy = energy;
    return s;
  };

  it('買得起商店的牌 → 開', () => {
    expect(isShopOpen(buyPhase(5), env)).toBe(true);
  });
  it('買不起（只剩花能量清商店）→ 不開，飛碟不該出現', () => {
    // 能量 3：買不起 5 費的牌，但清商店（2 能量）是合法的
    const s = buyPhase(3);
    expect(legalActions(s, env).some((a) => a.type === 'sweep')).toBe(true);
    expect(isShopOpen(s, env)).toBe(false);
  });
  it('不在買牌階段 → 不開', () => {
    const s = buyPhase(9);
    s.phase = 'roll';
    expect(isShopOpen(s, env)).toBe(false);
  });
});
