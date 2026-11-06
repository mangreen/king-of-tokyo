import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@kot/protocol';
import { buildHello, connectionReducer, initialConnectionState } from './connection.js';

describe('buildHello', () => {
  it('帶入目前協定版本', () => {
    expect(buildHello('Mang')).toEqual({ protocolVersion: PROTOCOL_VERSION, nickname: 'Mang' });
  });
});

describe('connectionReducer', () => {
  it('收到合法的 server:hello 進入 connected', () => {
    const next = connectionReducer(initialConnectionState, {
      type: 'hello',
      payload: { protocolVersion: PROTOCOL_VERSION, connectionId: 'abc' },
    });
    expect(next).toEqual({ status: 'connected', connectionId: 'abc' });
  });

  it('server:hello 格式不符時進入 error，而不是信任伺服器資料', () => {
    const next = connectionReducer(initialConnectionState, {
      type: 'hello',
      payload: { connectionId: 123 },
    });
    expect(next.status).toBe('error');
  });

  it('server:error 顯示伺服器訊息；格式不符時顯示通用訊息', () => {
    expect(
      connectionReducer(initialConnectionState, {
        type: 'server-error',
        payload: { code: 'protocol_mismatch', message: '版本不符' },
      }),
    ).toEqual({ status: 'error', message: '版本不符' });
    expect(
      connectionReducer(initialConnectionState, { type: 'server-error', payload: 'oops' }),
    ).toEqual({ status: 'error', message: '伺服器回報未知錯誤' });
  });

  it('斷線：connected 回到 connecting，error 狀態保留原因', () => {
    expect(
      connectionReducer({ status: 'connected', connectionId: 'abc' }, { type: 'disconnected' }),
    ).toEqual({ status: 'connecting' });
    const failed = { status: 'error', message: '版本不符' } as const;
    expect(connectionReducer(failed, { type: 'disconnected' })).toBe(failed);
  });

  it('transport 錯誤進入 error', () => {
    expect(connectionReducer(initialConnectionState, { type: 'transport-error' }).status).toBe(
      'error',
    );
  });
});
