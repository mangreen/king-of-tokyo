import { useServerConnection } from './useServerConnection.js';

// M0：固定訪客暱稱，之後由大廳（M2）讓玩家輸入
const GUEST_NICKNAME = '訪客';

export function App() {
  const connection = useServerConnection(GUEST_NICKNAME);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', textAlign: 'center' }}>
      <h1>東京之王 King of Tokyo</h1>
      <p aria-live="polite" data-testid="connection-status">
        {connection.status === 'connecting' && '連線中…'}
        {connection.status === 'connected' &&
          `已連線（連線 ID：${connection.connectionId.slice(0, 8)}）`}
        {connection.status === 'error' && `連線失敗：${connection.message}`}
      </p>
    </main>
  );
}
