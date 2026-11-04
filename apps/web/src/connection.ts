import {
  PROTOCOL_VERSION,
  ServerErrorSchema,
  ServerHelloSchema,
  type ClientHello,
} from '@kot/protocol';

export type ConnectionState =
  | { status: 'connecting' }
  | { status: 'connected'; connectionId: string }
  | { status: 'error'; message: string };

export type ConnectionAction =
  | { type: 'hello'; payload: unknown }
  | { type: 'server-error'; payload: unknown }
  | { type: 'transport-error' }
  | { type: 'disconnected' };

export const initialConnectionState: ConnectionState = { status: 'connecting' };

export function buildHello(nickname: string): ClientHello {
  return { protocolVersion: PROTOCOL_VERSION, nickname };
}

/** 純函式 reducer：把伺服器訊息轉成畫面狀態，所有外部資料都經 zod 驗證。 */
export function connectionReducer(
  state: ConnectionState,
  action: ConnectionAction,
): ConnectionState {
  switch (action.type) {
    case 'hello': {
      const parsed = ServerHelloSchema.safeParse(action.payload);
      return parsed.success
        ? { status: 'connected', connectionId: parsed.data.connectionId }
        : { status: 'error', message: '伺服器回應格式不符，請重新整理頁面' };
    }
    case 'server-error': {
      const parsed = ServerErrorSchema.safeParse(action.payload);
      return {
        status: 'error',
        message: parsed.success ? parsed.data.message : '伺服器回報未知錯誤',
      };
    }
    case 'transport-error':
      return { status: 'error', message: '無法連線到伺服器' };
    case 'disconnected':
      // 已經是錯誤狀態時保留原因，否則回到連線中（socket.io 會自動重連）
      return state.status === 'error' ? state : { status: 'connecting' };
  }
}
