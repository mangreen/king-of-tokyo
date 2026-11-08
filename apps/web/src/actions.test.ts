import { describe, expect, it } from 'vitest';
import { applyAction, createGame, defaultConfig, type Action, type CardDef } from '@kot/rules';
import { envOf, groupActions, labelAction, myActions, toIntent } from './actions.js';
import { GameActionSchema } from '@kot/protocol';

const CARDS: CardDef[] = Array.from({ length: 10 }, (_, i) => ({
  id: `c${String(i)}`,
  name: `卡${String(i)}`,
  cost: 3,
  kind: 'keep' as const,
  text: '',
  effectId: 'max_hp',
  params: { n: 2 },
}));
const ctx = { cardName: (id: string) => `〈${id}〉`, nameOf: (s: number) => `P${String(s)}` };

describe('toIntent', () => {
  it('去掉座位，其餘欄位原樣保留，並通過協定驗證', () => {
    const actions: Action[] = [
      { type: 'buy', seat: 1, cardId: 'c1', from: 'deck' },
      { type: 'endTurn', seat: 1 },
      { type: 'reactDecision', seat: 1, cardId: null },
      { type: 'useCard', seat: 1, cardId: 'c2', args: { die: 1, face: 'energy' } },
    ];
    for (const action of actions) {
      const intent = toIntent(action);
      expect('seat' in intent).toBe(false);
      expect(GameActionSchema.safeParse(intent).success).toBe(true);
    }
  });
});

describe('myActions', () => {
  const created = createGame(defaultConfig(2), 7, envOf(CARDS));
  const env = envOf(CARDS);

  it('輪到我時列出非擲骰動作；沒輪到或不在座位上則為空', () => {
    const seat = created.state.turn.seat;
    expect(myActions(created.state, env, seat === 0 ? 1 : 0)).toEqual([]);
    expect(myActions(created.state, env, null)).toEqual([]);
    // 擲骰階段沒有買牌動作，所以是空的（擲骰有專用介面）
    expect(myActions(created.state, env, seat).every((a) => a.type === 'useCard')).toBe(true);
  });

  it('買牌階段可以結束回合，且每個動作都能被引擎接受', () => {
    let state = created.state;
    const seat = state.turn.seat;
    let guard = 0;
    while (state.phase !== 'buy' && guard < 20) {
      guard += 1;
      const action: Action =
        state.phase === 'roll'
          ? state.turn.rollsUsed === 0
            ? { type: 'roll', seat, keep: [] }
            : { type: 'endRolling', seat }
          : ({ type: 'yieldDecision', seat, leave: false } as Action);
      const result = applyAction(state, action, env);
      if (!result.ok) break;
      state = result.state;
    }
    if (state.phase === 'buy') {
      const actions = myActions(state, env, seat);
      expect(actions.some((a) => a.type === 'endTurn')).toBe(true);
      for (const a of actions) expect(applyAction(state, a, env).ok).toBe(true);
    }
  });
});

describe('labelAction / groupActions', () => {
  it('每種動作都有非空的文字', () => {
    const actions: Action[] = [
      { type: 'yieldDecision', seat: 0, leave: true },
      { type: 'yieldDecision', seat: 0, leave: false },
      { type: 'yieldDecision', seat: 0, leave: true, takeCard: 'c1' },
      { type: 'buy', seat: 0, cardId: 'c1' },
      { type: 'buy', seat: 0, cardId: 'c1', from: 'deck' },
      { type: 'buy', seat: 0, cardId: 'c1', from: 1 },
      { type: 'buy', seat: 0, cardId: 'c1', energy: 2, target: 'c2' },
      { type: 'sweep', seat: 0 },
      { type: 'endTurn', seat: 0 },
      { type: 'useCard', seat: 0, cardId: 'c1' },
      { type: 'useCard', seat: 0, cardId: 'c1', args: { die: 0, face: 'heal' } },
      { type: 'reactDecision', seat: 0, cardId: null },
      { type: 'reactDecision', seat: 0, cardId: 'c1' },
      { type: 'heartsDecision', seat: 0, self: 1, poison: 1, shrink: 0, others: [] },
      { type: 'heartsDecision', seat: 0, self: 0, poison: 0, shrink: 0, others: [] },
      { type: 'probeDecision', seat: 0, die: null },
      { type: 'probeDecision', seat: 0, die: 2 },
      { type: 'opportunityDecision', seat: 0, buy: true },
    ];
    for (const a of actions) expect(labelAction(a, ctx).length).toBeGreaterThan(0);
    expect(labelAction({ type: 'buy', seat: 0, cardId: 'c1' }, ctx)).toBe('買 〈c1〉');
    expect(
      labelAction(
        {
          type: 'heartsDecision',
          seat: 0,
          self: 2,
          poison: 0,
          shrink: 0,
          others: [{ seat: 1, amount: 1 }],
        },
        ctx,
      ),
    ).toBe('自己回復 2，P1 回復 1');
  });

  it('同一張卡的多種用法合併成一組', () => {
    const groups = groupActions(
      [
        { type: 'endTurn', seat: 0 },
        { type: 'useCard', seat: 0, cardId: 'c1', args: { die: 0, face: 1 } },
        { type: 'useCard', seat: 0, cardId: 'c1', args: { die: 1, face: 1 } },
        { type: 'useCard', seat: 0, cardId: 'c2' },
      ],
      ctx,
    );
    expect(groups).toHaveLength(3);
    expect(groups[1]?.actions).toHaveLength(2);
    expect(groups[1]?.title).toBe('〈c1〉');
  });
});
