import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Action, CardDef, GameState } from '@kot/rules';
import { ShopPanel } from './Panels.js';

const def = (id: string, name: string, text: string, cost: number): CardDef => ({
  id,
  name,
  cost,
  kind: 'keep',
  text,
  effectId: 'armor',
  params: {},
});
const env = {
  cards: {
    m1: def('m1', '市場牌', '市場牌的說明文字', 3),
    o1: def('o1', '對手的盔甲', '對手盔甲的說明文字', 4),
    d1: def('d1', '牌庫頂的牌', '牌庫頂的說明文字', 2),
  },
};
const state = { market: { faceUp: ['m1'], deck: ['d1'], discard: [] } } as unknown as GameState;
const labelCtx = { cardName: (id: string) => env.cards[id as 'm1'].name, nameOf: () => '對手甲' };
const buy = (cardId: string, from?: number | 'deck'): Extract<Action, { type: 'buy' }> =>
  from === undefined ? { type: 'buy', seat: 0, cardId } : { type: 'buy', seat: 0, cardId, from };

const render = (otherBuys: Extract<Action, { type: 'buy' }>[]): string =>
  renderToStaticMarkup(
    <ShopPanel
      state={state}
      env={env}
      buys={[buy('m1')]}
      otherBuys={otherBuys}
      sweep={undefined}
      labelCtx={labelCtx}
      onAct={() => undefined}
    />,
  );

describe('ShopPanel（商店分頁）', () => {
  it('寄生觸手：列出別人持有的牌，附卡面文字與「向 X 買」按鈕', () => {
    const html = render([buy('o1', 1)]);
    expect(html).toContain('別人持有的牌');
    expect(html).toContain('對手盔甲的說明文字');
    expect(html).toContain('向 對手甲 買 對手的盔甲');
  });

  it('先知：列出牌庫頂的牌，附卡面文字與購買按鈕', () => {
    const html = render([buy('d1', 'deck')]);
    expect(html).toContain('牌庫頂');
    expect(html).toContain('牌庫頂的說明文字');
    expect(html).toContain('買牌庫頂的 牌庫頂的牌');
  });

  it('沒有這些動作時不顯示這兩個區塊', () => {
    const html = render([]);
    expect(html).not.toContain('別人持有的牌');
    expect(html).not.toContain('🔮');
    expect(html).toContain('市場牌的說明文字');
  });
});
