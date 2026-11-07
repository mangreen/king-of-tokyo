import { GameView } from './views/GameView.js';
import { Lobby } from './views/Lobby.js';
import { Login } from './views/Login.js';
import { RoomView } from './views/RoomView.js';
import { useGameClient } from './useGameClient.js';

export function App() {
  const client = useGameClient();
  const { state } = client;
  const { connection, room, game } = state;

  let body;
  if (connection.status === 'idle') {
    body = <Login onLogin={client.login} />;
  } else if (connection.status === 'error') {
    body = (
      <div className="card">
        <p className="error" data-testid="connection-status">
          連線失敗：{connection.message}
        </p>
        <button onClick={client.logout}>放棄並重新開始</button>
      </div>
    );
  } else if (connection.status === 'connecting') {
    body = (
      <p aria-live="polite" data-testid="connection-status">
        連線中…
      </p>
    );
  } else if (room && game && room.phase !== 'lobby') {
    // online 與 reconnecting 都顯示原本的畫面（重連中另外有提示列）
    body = (
      <GameView
        room={room}
        game={game}
        deadlineAt={state.deadlineAt}
        selfId={connection.playerId}
        cards={state.cards}
        log={state.log}
        onAct={client.act}
        onLeave={client.leaveRoom}
      />
    );
  } else if (room) {
    body = (
      <RoomView
        room={room}
        selfId={connection.playerId}
        onReady={client.setReady}
        onStart={client.startGame}
        onLeave={client.leaveRoom}
      />
    );
  } else {
    body = (
      <Lobby
        nickname={connection.nickname}
        cardSets={state.cardSets}
        defaultCardSetId={state.defaultCardSetId}
        onCreate={client.createRoom}
        onJoin={client.joinRoom}
        onLogout={client.logout}
      />
    );
  }

  return (
    <main>
      <h1>東京之王 King of Tokyo</h1>
      {connection.status === 'reconnecting' && (
        <div className="notice" role="status">
          連線中斷，重新連線中…（對局由系統暫時代打，連上後會接回你的座位）
        </div>
      )}
      {state.notice && (
        <div className="notice" role="alert">
          {state.notice}{' '}
          <button className="link" onClick={client.dismissNotice}>
            關閉
          </button>
        </div>
      )}
      {body}
    </main>
  );
}
