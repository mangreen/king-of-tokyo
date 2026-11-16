import { describe, expect, it } from 'vitest';
import { toSnapshot } from './snapshot.js';

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
