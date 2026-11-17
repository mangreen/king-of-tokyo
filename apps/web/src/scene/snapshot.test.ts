import { describe, expect, it } from 'vitest';
import { createGame, defaultConfig, legalActions, type CardDef, type GameState } from '@kot/rules';
import { envOf } from '../actions.js';
import { isShopOpen, shopStatus, toSnapshot } from './snapshot.js';

const room = { players: [{ id: 'me', nickname: 'A', seat: 0, monster: null }] } as never;
const state = {
  config: { playerCount: 2 },
  monsters: [],
  market: { faceUp: ['a', 'b', 'c'] },
} as never;

describe('toSnapshot 商店', () => {
  it('買得起 → shop 帶商店翻開的牌，飛碟帶牌入場', () => {
    const snap = toSnapshot(room, state, 0, 'me', 'buy');
    expect(snap.shop).toEqual(['a', 'b', 'c']);
    expect(snap.shopRefresh).toBe(false);
  });
  it('買不起但清得起 → shop 為 null、shopRefresh 為 true（飛碟入場、光束裡飄 ♻）', () => {
    const snap = toSnapshot(room, state, 0, 'me', 'sweep');
    expect(snap.shop).toBeNull();
    expect(snap.shopRefresh).toBe(true);
  });
  it('商店沒開（預設）→ 飛碟離場', () => {
    for (const snap of [
      toSnapshot(room, state, 0, 'me'),
      toSnapshot(room, state, 0, 'me', 'closed'),
    ]) {
      expect(snap.shop).toBeNull();
      expect(snap.shopRefresh).toBe(false);
    }
  });
});

describe('shopStatus／isShopOpen（飛碟入場條件）', () => {
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

  it('買得起商店的牌 → buy', () => {
    expect(shopStatus(buyPhase(5), env)).toBe('buy');
    expect(isShopOpen(buyPhase(5), env)).toBe(true);
  });
  it('買不起、但清得起商店（2 能量）→ sweep：飛碟入場，光束裡飄 ♻', () => {
    // 能量 3：買不起 5 費的牌，但清商店（2 能量）是合法的
    const s = buyPhase(3);
    expect(legalActions(s, env).some((a) => a.type === 'sweep')).toBe(true);
    expect(shopStatus(s, env)).toBe('sweep');
    expect(isShopOpen(s, env)).toBe(false); // 沒有牌可買
  });
  it('連清商店都付不起 → closed，飛碟不該出現', () => {
    expect(shopStatus(buyPhase(1), env)).toBe('closed');
  });
  it('不在買牌階段 → closed', () => {
    const s = buyPhase(9);
    s.phase = 'roll';
    expect(shopStatus(s, env)).toBe('closed');
  });
});
