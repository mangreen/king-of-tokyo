import { describe, expect, it } from 'vitest';
import { createGame, defaultConfig } from '@kot/rules';
import { PROTOCOL_VERSION, type GameUpdateMessage, type RoomSnapshot } from '@kot/protocol';
import { appReducer, initialAppState, LOG_LIMIT, selfPlayer, type AppState } from './state.js';

const TOKEN = 'ab'.repeat(32);
const hello = {
  protocolVersion: PROTOCOL_VERSION,
  playerId: 'p1',
  sessionToken: TOKEN,
  resumed: false,
  nickname: 'Mang',
};

const room: RoomSnapshot = {
  code: 'ABCDE',
  phase: 'lobby',
  hostId: 'p1',
  players: [
    {
      id: 'p1',
      nickname: 'Mang',
      seat: null,
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
    expect(state).toMatchObject({ room: null, game: null, deadlineAt: null, log: [] });
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
