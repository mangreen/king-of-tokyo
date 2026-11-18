import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GameState, Monster } from '@kot/rules';
import type { RoomSnapshot } from '@kot/protocol';
import { MyCardsPanel, PlayersPanel } from './Panels.js';

const mon = (seat: number, alive = true): Monster =>
  ({
    seat,
    alive,
    hp: 10,
    maxHp: 10,
    vp: 0,
    energy: 0,
    location: null,
    cards: seat === 0 ? ['ts'] : [],
    tokens: { poison: 0, shrink: 0 },
  }) as unknown as Monster;

const env = {
  cards: {
    ts: {
      id: 'ts',
      name: '震地步伐',
      cost: 3,
      kind: 'keep',
      text: '少擲',
      effectId: 'stomp',
      params: {},
    },
  },
} as never;

const render = (stomp: number[]): string =>
  renderToStaticMarkup(
    <PlayersPanel
      state={
        {
          config: { playerCount: 3 },
          monsters: [mon(0), mon(1), mon(2, false)],
          stomp,
        } as unknown as GameState
      }
      room={{ players: [] } as unknown as RoomSnapshot}
      actorSeat={1}
      mySeat={0}
      nameOf={(s) => `P${String(s)}`}
      env={env}
    />,
  );

describe('玩家分頁：震地暈眩標籤', () => {
  it('持有者以外的存活玩家有 🥴 標籤；持有者與淘汰者沒有', () => {
    const html = render([0]);
    expect(html.match(/🥴 暈眩 −1/g)).toHaveLength(1);
    expect(render([]).includes('🥴')).toBe(false);
  });
});

describe('我的卡牌：生效中', () => {
  it('持續生效的牌標示「▶ 生效中」與說明；沒有就不標', () => {
    const html = renderToStaticMarkup(
      <MyCardsPanel monster={mon(0)} env={env} lingering={{ ts: '全場少擲，直到你的下個回合' }} />,
    );
    expect(html).toContain('▶ 生效中：全場少擲，直到你的下個回合');
    expect(renderToStaticMarkup(<MyCardsPanel monster={mon(0)} env={env} />)).not.toContain(
      '生效中',
    );
  });
});
