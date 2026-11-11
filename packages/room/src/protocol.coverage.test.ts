/**
 * 協定涵蓋度：規則引擎在整場模擬中產生的「每一種合法動作」，去掉座位後都必須通過
 * GameActionSchema，而且經過伺服器的 toAction 轉換後與原動作等價。
 * 這能抓到「引擎新增了動作或參數，但協定沒跟上」的錯誤。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  defaultConfig,
  legalActions,
  nextInt,
  seedToState,
  type Action,
  type RulesEnv,
} from '@kot/rules';
import { GameActionSchema, type GameActionInput } from '@kot/protocol';
import { Room } from './room.js';
import { FakeScheduler, RecordingPublisher } from './testing.js';
import { testCardSet } from './testing-fs.js';

function env(): RulesEnv {
  return { cards: Object.fromEntries(testCardSet().set.cards.map((c) => [c.id, c])) };
}

function intentOf(action: Action): unknown {
  return Object.fromEntries(Object.entries(action).filter(([key]) => key !== 'seat'));
}

describe('協定涵蓋規則引擎的所有合法動作', () => {
  it('整場隨機模擬：每個合法動作都通過驗證且內容不被丟棄', () => {
    const rulesEnv = env();
    const kinds = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const created = createGame(defaultConfig(3), seed, rulesEnv);
      let state = created.state;
      let rng = seedToState(seed + 1000);
      for (let step = 0; step < 4000 && state.phase !== 'over'; step += 1) {
        const actions = legalActions(state, rulesEnv);
        for (const action of actions) {
          kinds.add(action.type);
          const parsed = GameActionSchema.safeParse(intentOf(action));
          expect(parsed.success, JSON.stringify(action)).toBe(true);
          // 沒有被 schema 默默丟掉任何欄位（strict 以外的物件會 strip 未知鍵）
          expect(parsed.data).toEqual(intentOf(action));
        }
        const [index, next] = nextInt(rng, actions.length);
        rng = next;
        const chosen = actions[index];
        if (!chosen) break;
        const result = applyAction(state, chosen, rulesEnv);
        expect(result.ok).toBe(true);
        if (!result.ok) break;
        state = result.state;
      }
    }
    for (const type of ['roll', 'endRolling', 'buy', 'sweep', 'endTurn', 'useCard']) {
      expect(kinds.has(type), `模擬中沒有出現 ${type}`).toBe(true);
    }
  });

  it('Room 能接受每一個合法動作：以房間為介面隨機打完一局', () => {
    const scheduler = new FakeScheduler();
    const publisher = new RecordingPublisher();
    const room = new Room('ABCDE', { id: 'p0', nickname: 'A' }, testCardSet(), {
      scheduler,
      publisher,
      newSeed: () => 99,
      timings: {
        decisionMs: 1000,
        yieldMs: 500,
        awayConnectedMs: 200,
        awayOfflineMs: 50,
        emptyRoomMs: 10_000,
        lobbyOfflineMs: 2_000,
        overRoomMs: 30_000,
        botMs: 500,
      },
      onClose: () => undefined,
      onMemberRemoved: () => undefined,
    });
    room.join({ id: 'p1', nickname: 'B' });
    room.setReady('p1', true);
    room.start('p0');

    const rulesEnv = env();
    let rng = seedToState(7);
    let rejected = 0;
    for (let step = 0; step < 6000 && room.phase === 'playing'; step += 1) {
      const update = publisher.lastGame('p0');
      if (!update || update.state.phase === 'over' || update.actorSeat === null) break;
      // 玩家端看到的是遮蔽後的狀態；合法動作必須只靠它就能算出來
      const actions = legalActions(update.state, rulesEnv);
      const [index, next] = nextInt(rng, actions.length);
      rng = next;
      const chosen = actions[index];
      if (!chosen) break;
      const playerId = `p${String(update.actorSeat)}`;
      const result = room.act(playerId, intentOf(chosen) as GameActionInput);
      if (!result.ok) rejected += 1;
    }
    expect(rejected).toBe(0);
    expect(room.phase).toBe('over');
  });
});
