import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Action, CardDef, GameState } from '@kot/rules';
import { CardRefs, ShopPanel } from './Panels.js';

const def = (id: string, name: string, text: string, cost = 3): CardDef => ({
  id,
  name,
  cost,
  kind: 'keep',
  text,
  effectId: 'armor',
  params: {},
});
const cards: Record<string, CardDef> = {
  mimic: def('mimic', '變色龍之眼', '複製你持有的另一張持續牌', 8),
  head: def('head', '第三顆頭', '多擲 1 顆骰子', 4),
  claws: def('claws', '利爪', '攻擊 +1', 3),
};
const labelCtx = {
  cardName: (id: string) => cards[id]?.name ?? id,
  nameOf: () => '甲',
  cardDef: (id: string) => cards[id],
};

describe('CardRefs（相關卡牌說明）', () => {
  it('列出每張牌的名稱、費用與卡面文字', () => {
    const html = renderToStaticMarkup(
      <CardRefs ids={['head', 'claws']} labelCtx={labelCtx} title="這些動作牽涉的牌" />,
    );
    expect(html).toContain('這些動作牽涉的牌');
    expect(html).toContain('第三顆頭');
    expect(html).toContain('多擲 1 顆骰子');
    expect(html).toContain('利爪');
    expect(html).toContain('攻擊 +1');
  });

  it('沒有卡牌資料時退回只顯示名稱；沒有牌就什麼都不顯示', () => {
    const html = renderToStaticMarkup(
      <CardRefs
        ids={['head']}
        labelCtx={{ cardName: labelCtx.cardName, nameOf: labelCtx.nameOf }}
        title="t"
      />,
    );
    expect(html).toContain('第三顆頭');
    expect(html).not.toContain('多擲 1 顆骰子');
    expect(renderToStaticMarkup(<CardRefs ids={[]} labelCtx={labelCtx} title="t" />)).toBe('');
  });
});

describe('商店：買變色龍之眼時看得到可複製的牌的卡面文字', () => {
  const state = { market: { faceUp: ['mimic'], deck: [], discard: [] } } as unknown as GameState;
  const buys: Extract<Action, { type: 'buy' }>[] = [
    { type: 'buy', seat: 0, cardId: 'mimic', target: 'head' },
    { type: 'buy', seat: 0, cardId: 'mimic', target: 'claws' },
  ];
  it('每個複製對象的內容都列在買鈕下面', () => {
    const html = renderToStaticMarkup(
      <ShopPanel
        state={state}
        env={{ cards }}
        buys={buys}
        sweep={undefined}
        labelCtx={labelCtx}
        onAct={() => undefined}
      />,
    );
    expect(html).toContain('買 變色龍之眼（複製 第三顆頭）');
    expect(html).toContain('可複製的牌');
    expect(html).toContain('多擲 1 顆骰子');
    expect(html).toContain('攻擊 +1');
  });
});
