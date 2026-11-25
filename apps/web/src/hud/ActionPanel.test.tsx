import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CardDef, Face, GameState } from '@kot/rules';
import { ActionPanel } from './Panels.js';

const ray: CardDef = {
  id: 'ray',
  name: '治癒光束',
  cost: 4,
  kind: 'keep',
  text: '',
  effectId: 'heal_others',
  params: {},
};

const render = (opts: {
  /** 另一隻怪獸（座位 1）的狀態；沒給＝沒有別的怪獸。 */
  other?: { hp: number; energy: number; location?: 'city' | null };
  inTokyo: boolean;
  dice: Face[];
  kept?: number[];
  cards?: string[];
  phase?: 'roll' | 'buy';
}): string => {
  const state = {
    config: { victoryPoints: 20, startingHp: 10, maxRolls: 3, diceCount: 6, playerCount: 4 },
    phase: opts.phase ?? 'roll',
    pending: null,
    turn: { seat: 0, rollsUsed: 1, dice: opts.dice, diceCount: opts.dice.length },
    monsters: [
      { seat: 0, alive: true, location: opts.inTokyo ? 'city' : null, cards: opts.cards ?? [] },
      ...(opts.other
        ? [{ seat: 1, alive: true, maxHp: 10, location: null, cards: [], ...opts.other }]
        : []),
    ],
  } as unknown as GameState;
  return renderToStaticMarkup(
    <ActionPanel
      state={state}
      actorSeat={0}
      myTurn
      me={undefined}
      nameOf={() => '我'}
      prompt="擲骰"
      kept={new Set(opts.kept ?? [])}
      spins={[]}
      canToggle
      canRoll
      rollMax={3}
      threesKeep={null}
      canStop
      onToggle={() => undefined}
      groups={[]}
      labelCtx={{
        cardName: (id) => id,
        nameOf: () => '我',
        cardDef: (id) => (id === 'ray' ? ray : undefined),
      }}
      onAct={() => undefined}
    />,
  );
};

describe('ActionPanel：在東京擲到 ❤️', () => {
  it('在東京：顯示提醒、❤️ 骰子標成無效', () => {
    const html = render({ inTokyo: true, dice: ['heal', 1, 2, 3, 'attack', 'energy'] });
    expect(html).toContain('在東京：❤️ 不能補血');
    expect(html.match(/dead-heart/g)).toHaveLength(1);
    expect(html).not.toContain('tokyo-heart warn');
  });

  it('在東京鎖定 ❤️：紅色警告取代一般提醒', () => {
    const html = render({ inTokyo: true, dice: ['heal', 'heal', 2, 3, 3, 1], kept: [1] });
    expect(html).toContain('tokyo-heart warn');
    expect(html).toContain('已保留 1 顆 ❤️');
  });

  it('不在東京：沒有提醒也沒有無效標記', () => {
    const html = render({ inTokyo: false, dice: ['heal', 1, 2, 3, 'attack', 'energy'] });
    expect(html).not.toContain('tokyo-heart');
    expect(html).not.toContain('dead-heart');
  });

  it('持有治癒光束且有可治療的對象：提醒改成只能治療別人（東京內的也可以），不標無效', () => {
    const html = render({
      inTokyo: true,
      dice: ['heal', 1, 2, 3, 3, 1],
      cards: ['ray'],
      other: { hp: 4, energy: 3 },
    });
    expect(html).toContain('治癒光束');
    expect(html).toContain('東京內的也可以');
    expect(html).not.toContain('dead-heart');
    expect(html).not.toContain('治療無效');
  });

  it('治療對象本身在東京內也算（卡牌能力不受東京限制）', () => {
    const html = render({
      inTokyo: false,
      dice: ['heal', 1, 2, 3, 3, 1],
      cards: ['ray'],
      other: { hp: 4, energy: 3, location: 'city' },
    });
    expect(html).toContain('用治癒光束分給別的怪獸');
  });

  it('持有治癒光束但沒有人能被治療（滿血或沒能量）：❤️ 在東京仍然無效', () => {
    for (const other of [undefined, { hp: 10, energy: 3 }, { hp: 4, energy: 0 }]) {
      const html = render({
        inTokyo: true,
        dice: ['heal', 1, 2, 3, 3, 1],
        cards: ['ray'],
        ...(other ? { other } : {}),
      });
      expect(html).toContain('dead-heart');
      expect(html).toContain('治療無效');
    }
  });

  it('還沒擲骰、或已進入買牌階段：不顯示提醒', () => {
    expect(render({ inTokyo: true, dice: [] })).not.toContain('tokyo-heart');
    expect(render({ inTokyo: true, dice: ['heal', 1, 2, 3, 3, 1], phase: 'buy' })).not.toContain(
      'tokyo-heart',
    );
  });
});
