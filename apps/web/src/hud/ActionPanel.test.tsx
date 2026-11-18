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
    monsters: [{ seat: 0, location: opts.inTokyo ? 'city' : null, cards: opts.cards ?? [] }],
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

  it('持有治癒光束：提醒改成只能治療別人，不標無效', () => {
    const html = render({ inTokyo: true, dice: ['heal', 1, 2, 3, 3, 1], cards: ['ray'] });
    expect(html).toContain('治癒光束');
    expect(html).not.toContain('dead-heart');
  });

  it('還沒擲骰、或已進入買牌階段：不顯示提醒', () => {
    expect(render({ inTokyo: true, dice: [] })).not.toContain('tokyo-heart');
    expect(render({ inTokyo: true, dice: ['heal', 1, 2, 3, 3, 1], phase: 'buy' })).not.toContain(
      'tokyo-heart',
    );
  });
});
