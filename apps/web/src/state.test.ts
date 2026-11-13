import { describe, expect, it } from 'vitest';
import { createGame, defaultConfig } from '@kot/rules';
import { PROTOCOL_VERSION, type GameUpdateMessage, type RoomSnapshot } from '@kot/protocol';
import {
  appReducer,
  FEED_LIMIT,
  initialAppState,
  LOG_LIMIT,
  selfPlayer,
  type AppState,
} from './state.js';

const TOKEN = 'ab'.repeat(32);
const hello = {
  protocolVersion: PROTOCOL_VERSION,
  playerId: 'p1',
  sessionToken: TOKEN,
  resumed: false,
  nickname: 'Mang',
  cardSets: [{ id: 'original', name: '原創卡組', cardCount: 72 }],
  defaultCardSetId: 'original',
};

const room: RoomSnapshot = {
  code: 'ABCDE',
  cardSet: { id: 'original', name: '原創卡組', cardCount: 72 },
  phase: 'lobby',
  hostId: 'p1',
  players: [
    {
      id: 'p1',
      nickname: 'Mang',
      seat: null,
      monster: null,
      bot: false,
      ready: true,
      connected: true,
      away: false,
      left: false,
    },
  ],
};

function update(version: number, withEvents = true): GameUpdateMessage {
  const created = createGame(defaultConfig(2), 3);
  return {
    version,
    state: { ...created.state, version },
    events: withEvents ? created.events : [],
    remainingMs: 30_000,
    actorSeat: created.state.firstSeat,
  };
}

const online = (): AppState => appReducer(initialAppState, { type: 'hello', payload: hello });

describe('連線狀態', () => {
  it('合法的 server:hello → online；不把 token 放進畫面狀態', () => {
    const state = online();
    expect(state.connection).toEqual({ status: 'online', playerId: 'p1', nickname: 'Mang' });
    expect(JSON.stringify(state)).not.toContain(TOKEN);
  });

  it('server:hello 格式不符 → error，而不是信任伺服器資料', () => {
    const next = appReducer(initialAppState, { type: 'hello', payload: { playerId: 1 } });
    expect(next.connection.status).toBe('error');
  });

  it('server:error 顯示伺服器訊息；格式不符時顯示通用訊息', () => {
    expect(
      appReducer(initialAppState, {
        type: 'server-error',
        payload: { code: 'session_replaced', message: '已在其他地方登入' },
      }).connection,
    ).toEqual({ status: 'error', message: '已在其他地方登入' });
    expect(
      appReducer(initialAppState, { type: 'server-error', payload: 'oops' }).connection,
    ).toEqual({ status: 'error', message: '伺服器回報未知錯誤' });
  });

  it('斷線：已登入的玩家進入 reconnecting 並保留房間畫面；重連成功後回到 online', () => {
    const inRoom = appReducer(online(), { type: 'room-state', payload: { room } });
    const dropped = appReducer(inRoom, { type: 'disconnected' });
    expect(dropped.connection).toEqual({
      status: 'reconnecting',
      playerId: 'p1',
      nickname: 'Mang',
    });
    expect(dropped.room).toEqual(room);
    expect(selfPlayer(dropped)?.nickname).toBe('Mang');
    const back = appReducer(dropped, { type: 'hello', payload: hello });
    expect(back.connection.status).toBe('online');
  });

  it('重連期間連線失敗只是暫時的，不會變成錯誤畫面；第一次連線就失敗才顯示錯誤', () => {
    const dropped = appReducer(online(), { type: 'disconnected' });
    expect(appReducer(dropped, { type: 'transport-error' }).connection.status).toBe('reconnecting');
    expect(appReducer(online(), { type: 'transport-error' }).connection.status).toBe(
      'reconnecting',
    );
    const failed = appReducer(initialAppState, { type: 'transport-error' });
    expect(failed.connection.status).toBe('error');
    expect(appReducer(failed, { type: 'disconnected' })).toBe(failed);
  });

  it('reset 回到初始狀態', () => {
    expect(appReducer(online(), { type: 'reset' })).toEqual(initialAppState);
  });
});

describe('房間狀態', () => {
  it('收到房間快照；selfPlayer 找得到自己', () => {
    const state = appReducer(online(), { type: 'room-state', payload: { room } });
    expect(state.room?.code).toBe('ABCDE');
    expect(selfPlayer(state)?.nickname).toBe('Mang');
  });

  it('room 為 null（離開或房間關閉）：清掉對局與日誌', () => {
    let state = appReducer(online(), { type: 'room-state', payload: { room } });
    state = appReducer(state, { type: 'game-update', payload: update(1), at: 0 });
    expect(state.log.length).toBeGreaterThan(0);
    state = appReducer(state, { type: 'room-state', payload: { room: null } });
    expect(state).toMatchObject({ room: null, game: null, deadlineAt: null, log: [], feed: [] });
  });

  it('格式不符的房間訊息被忽略', () => {
    const state = online();
    expect(appReducer(state, { type: 'room-state', payload: { room: { code: 5 } } })).toBe(state);
    expect(appReducer(state, { type: 'room-state', payload: null })).toBe(state);
  });
});

describe('對局更新', () => {
  it('事件轉成文字日誌；deadline 由本機接收時間換算', () => {
    const state = appReducer(online(), { type: 'game-update', payload: update(0), at: 1000 });
    expect(state.game?.version).toBe(0);
    expect(state.deadlineAt).toBe(31_000);
    expect(state.log.some((line) => line.includes('先手'))).toBe(true);
  });

  it('事件批次進入 feed（供 3D 重播）；沒有事件的重送不進 feed；長度有上限', () => {
    let state = appReducer(online(), { type: 'game-update', payload: update(0), at: 0 });
    expect(state.feed).toHaveLength(1);
    expect(state.feed[0]?.version).toBe(0);
    expect(state.feed[0]?.events.length).toBeGreaterThan(0);
    state = appReducer(state, { type: 'game-update', payload: update(0, false), at: 5 });
    expect(state.feed).toHaveLength(1);
    for (let v = 1; v <= FEED_LIMIT + 10; v++) {
      state = appReducer(state, { type: 'game-update', payload: update(v), at: v });
    }
    expect(state.feed).toHaveLength(FEED_LIMIT);
    expect(state.feed.at(-1)?.version).toBe(FEED_LIMIT + 10);
  });

  it('重連時的完整重送（沒有事件）不會重複寫入日誌', () => {
    let state = appReducer(online(), { type: 'game-update', payload: update(0), at: 0 });
    const before = state.log.length;
    state = appReducer(state, { type: 'game-update', payload: update(0, false), at: 5 });
    expect(state.log).toHaveLength(before);
  });

  it('過期（版本較舊）的更新被丟棄', () => {
    const state = appReducer(online(), { type: 'game-update', payload: update(5), at: 0 });
    expect(appReducer(state, { type: 'game-update', payload: update(4), at: 1 })).toBe(state);
  });

  it('沒有計時（遊戲結束）時 deadlineAt 為 null', () => {
    const over = { ...update(9), remainingMs: null };
    expect(
      appReducer(online(), { type: 'game-update', payload: over, at: 0 }).deadlineAt,
    ).toBeNull();
  });

  it('日誌長度有上限', () => {
    let state = online();
    for (let i = 0; i < LOG_LIMIT + 50; i += 1) {
      state = appReducer(state, { type: 'game-update', payload: update(i), at: 0 });
    }
    expect(state.log.length).toBe(LOG_LIMIT);
  });

  it('格式不符的更新被忽略', () => {
    const state = online();
    expect(appReducer(state, { type: 'game-update', payload: { version: 'x' }, at: 0 })).toBe(
      state,
    );
  });
});

describe('提示', () => {
  it('設定與清除提示', () => {
    const state = appReducer(initialAppState, { type: 'notice', message: '還沒輪到你' });
    expect(state.notice).toBe('還沒輪到你');
    expect(appReducer(state, { type: 'notice', message: null }).notice).toBeNull();
  });
});

describe('卡牌', () => {
  const cards = [
    {
      id: 'c1',
      name: '測試卡',
      cost: 3,
      kind: 'keep',
      text: '效果',
      effectId: 'max_hp',
      params: {},
    },
  ];

  it('握手記下可用卡牌組與預設值', () => {
    const state = online();
    expect(state.cardSets).toEqual(hello.cardSets);
    expect(state.defaultCardSetId).toBe('original');
  });

  it('game:cards 存入卡牌目錄；格式不符則忽略；離開房間清掉', () => {
    let state = online();
    state = appReducer(state, { type: 'game-cards', payload: { cardSetId: 'original', cards } });
    expect(state.cards).toHaveLength(1);
    expect(appReducer(state, { type: 'game-cards', payload: { cards: 'x' } }).cards).toHaveLength(
      1,
    );
    state = appReducer(state, { type: 'room-state', payload: { room: null } });
    expect(state.cards).toBeNull();
  });

  it('事件日誌用卡牌名稱而不是 id', () => {
    let state = appReducer(online(), { type: 'room-state', payload: { room } });
    state = appReducer(state, { type: 'game-cards', payload: { cardSetId: 'original', cards } });
    const base = update(1, false);
    state = appReducer(state, {
      type: 'game-update',
      at: 0,
      payload: { ...base, events: [{ type: 'card_revealed', cardId: 'c1' }] },
    });
    expect(state.log.join('\n')).toContain('測試卡');
    expect(state.log.join('\n')).not.toContain('c1');
  });
});

describe('閒置踢除', () => {
  it('idle_timeout 進入 timed-out 狀態；之後的 disconnected 不會把它蓋成「重連中」', () => {
    let s = appReducer(initialAppState, { type: 'connecting' });
    s = appReducer(s, {
      type: 'server-error',
      payload: { code: 'idle_timeout', message: '閒置太久' },
    });
    expect(s.connection).toEqual({ status: 'timed-out', message: '閒置太久' });
    s = appReducer(s, { type: 'disconnected' });
    expect(s.connection.status).toBe('timed-out');
  });
});

describe('版本倒退（房主重新整理後從存檔還原）', () => {
  const at = (version: number) =>
    ({ type: 'game-update', payload: update(version), at: 0 }) as const;

  it('平常丟棄比手上舊的更新；剛握手後的第一筆就算比較舊也接受，之後恢復丟棄', () => {
    let state = appReducer(online(), at(10));
    state = appReducer(state, at(7));
    expect(state.game?.version).toBe(10); // 亂序的舊更新：丟棄
    state = appReducer(state, { type: 'hello', payload: hello }); // 重新握手（重連）
    state = appReducer(state, at(8));
    expect(state.game?.version).toBe(8); // 以房主為準
    state = appReducer(state, at(6));
    expect(state.game?.version).toBe(8); // 只有握手後的第一筆可以倒退
  });

  it('倒退時把比新版本更新的舊事件從動畫佇列移除', () => {
    let state = appReducer(online(), at(9));
    state = appReducer(state, at(10));
    expect(state.feed.map((b) => b.version)).toEqual([9, 10]);
    state = appReducer(state, { type: 'hello', payload: hello });
    state = appReducer(state, at(9));
    expect(state.feed.map((b) => b.version)).toEqual([9]); // 舊的 9 被新的取代
  });
});
