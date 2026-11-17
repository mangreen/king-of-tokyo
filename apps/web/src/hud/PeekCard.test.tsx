import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CardDef } from '@kot/rules';
import { PeekCard } from './PeekCard.js';

const def: CardDef = {
  id: 'g',
  name: '電網過載',
  cost: 3,
  kind: 'discard',
  text: '所有怪獸各受 1 點傷害',
  effectId: 'instant',
  params: {},
};

describe('PeekCard（偷看到的牌庫頂）', () => {
  it('顯示卡名、費用與卡面文字，讓使用者可以慢慢讀', () => {
    const html = renderToStaticMarkup(<PeekCard id="g" def={def} />);
    expect(html).toContain('偷看到的牌庫頂');
    expect(html).toContain('電網過載');
    expect(html).toContain('⚡3');
    expect(html).toContain('所有怪獸各受 1 點傷害');
  });

  it('沒有偷看（或看不到內容）時什麼都不顯示', () => {
    expect(renderToStaticMarkup(<PeekCard id={null} def={undefined} />)).toBe('');
  });
});
