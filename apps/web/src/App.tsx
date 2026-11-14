import { useEffect, useRef, useState } from 'react';
import { parseInvite, withoutInvite } from './invite.js';
import { GameView } from './views/GameView.js';
import { Lobby } from './views/Lobby.js';
import { Login } from './views/Login.js';
import { RoomView } from './views/RoomView.js';
import { createClientOptions } from './net/config.js';
import { describePath, usePathStatus } from './net/pathStatus.js';
import { describeQuality, useQuality } from './net/quality.js';
import { setRestoreStatus, useRestoreStatus } from './net/restoreStatus.js';
import { roleChangeNotice, useRoleStatus, type RoleStatus } from './net/roleStatus.js';
import { AuditPanel } from './views/AuditPanel.js';
import { RolePanel } from './views/RolePanel.js';
import { session } from './session.js';
import { useGameClient } from './useGameClient.js';
import { useWakeLock } from './useWakeLock.js';

// 連線方式在載入時決定一次（伺服器或離線），之後不變
const clientOptions = createClientOptions(
  window.location,
  import.meta.env.VITE_SERVER_URL as string | undefined,
);

export function App() {
  const client = useGameClient(clientOptions);
  const path = usePathStatus();
  const restored = useRestoreStatus();
  const quality = useQuality();
  const role = useRoleStatus();
  const [roleNotice, setRoleNotice] = useState<string | null>(null);
  const previousRole = useRef<RoleStatus>(null);
  useEffect(() => {
    if (role === null) return;
    const message = roleChangeNotice(previousRole.current, role);
    previousRole.current = role;
    if (message !== null) setRoleNotice(message);
  }, [role]);
  const { state } = client;
  const { connection, room, game } = state;

  // 邀請連結：登入完成後自動加入一次，然後把網址上的邀請參數拿掉
  const [invite, setInvite] = useState(() => parseInvite(window.location.search));
  const inviteHandled = useRef(false);
  useEffect(() => {
    if (invite === null || inviteHandled.current || connection.status !== 'online') return;
    inviteHandled.current = true;
    if (room === null) client.joinRoom(invite);
    window.history.replaceState(null, '', withoutInvite(window.location.href));
  }, [invite, connection.status, room, client]);

  const p2p = clientOptions.mode === 'p2p';

  // 房主模式：記住目前所在的房間（重新整理後據此接回）；離開或房間結束時忘掉
  const inRoom = useRef(false);
  const roomCode = room?.code ?? null;
  useEffect(() => {
    if (!p2p) return;
    if (roomCode !== null) {
      inRoom.current = true;
      session.setP2pRoom({
        // 房主換人後以目前的角色為準（接手的客人重新整理時要從存檔還原成房主）
        role: role !== null ? role.role : clientOptions.target.code === null ? 'host' : 'guest',
        code: roomCode,
      });
    } else if (inRoom.current) {
      inRoom.current = false;
      session.setP2pRoom(null);
    }
  }, [p2p, roomCode, role]);

  // 房主重新整理但存檔不能用：忘掉舊房間，當作全新的房主（畫面會顯示原因）
  useEffect(() => {
    if (restored !== null && !restored.ok) session.setP2pRoom(null);
  }, [restored]);

  // 房主模式：連線方式在登入時才決定——有房號就是客人（經中繼連到房主），沒有就是自己當房主
  function login(nickname: string, roomCode?: string): void {
    if (p2p) {
      clientOptions.target.code = roomCode ?? null;
      if (roomCode !== undefined && invite === null) setInvite(roomCode);
    }
    client.login(nickname);
  }

  // 房主模式沒有「回大廳再開一間」：房間跟著房主的分頁走，離開就是整個結束
  function leave(): void {
    client.leaveRoom();
    if (p2p) client.logout();
  }

  let body;
  if (connection.status === 'idle') {
    body = <Login onLogin={login} inviteCode={invite} hostMode={p2p} />;
  } else if (connection.status === 'error') {
    body = (
      <div className="card">
        <p className="error" data-testid="connection-status">
          連線失敗：{connection.message}
        </p>
        <button onClick={client.logout}>放棄並重新開始</button>
      </div>
    );
  } else if (connection.status === 'timed-out') {
    body = (
      <div className="card" data-testid="idle-timeout">
        <p aria-live="polite">{connection.message}</p>
        <button onClick={client.reconnect}>重新連線</button>
        <button onClick={client.logout}>登出</button>
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
        feed={state.feed}
        onAct={client.act}
        onLeave={leave}
      />
    );
  } else if (room) {
    body = (
      <RoomView
        room={room}
        selfId={connection.playerId}
        onReady={client.setReady}
        onStart={client.startGame}
        onAddBot={client.addBot}
        onRemoveBot={client.removeBot}
        onLeave={leave}
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

  const inGame = Boolean(room && game && room.phase !== 'lobby');
  // 對局中保持螢幕開啟（房主螢幕休眠會讓房間停擺）
  const wakeLock = useWakeLock(inGame && room?.phase === 'playing');
  const hostPage = p2p && clientOptions.target.code === null;
  return (
    <main className={inGame ? 'wide' : undefined}>
      <h1>東京之王 King of Tokyo</h1>
      {clientOptions.mode === 'offline' && (
        <div className="notice" role="status" data-testid="offline-banner">
          離線模式：遊戲在這個分頁裡執行，不連伺服器。重新整理頁面會結束這局。可以加入電腦玩家對戰。
        </div>
      )}
      {p2p && (
        <div className="notice" role="status" data-testid="p2p-banner">
          房主模式：房間在房主的瀏覽器裡執行，伺服器負責登記房號、協助玩家建立直連，直連不通時轉送訊息。房主重新整理頁面時會從瀏覽器存檔接回同一局；關閉分頁或主動離開，這局才會結束。
          {role !== null && room !== null && 'playerId' in connection && (
            <RolePanel role={role} room={room} selfId={connection.playerId} />
          )}
          {path !== null && <div data-testid="path-status">{describePath(path)}</div>}
          <AuditPanel phase={room?.phase ?? null} isHost={role?.role === 'host'} />
        </div>
      )}
      {hostPage && inGame && (wakeLock === 'unsupported' || wakeLock === 'denied') && (
        <div className="notice" role="status" data-testid="wake-lock-hint">
          這個瀏覽器無法保持螢幕開啟。你是房主，請避免讓螢幕休眠或切到其他分頁，否則其他玩家會卡住。
        </div>
      )}
      {!hostPage && connection.status === 'online' && quality !== null && (
        <div className={`quality quality-${quality.level}`} role="status" data-testid="quality">
          {describeQuality(quality)}
        </div>
      )}
      {connection.status === 'reconnecting' && (
        <div className="notice" role="status">
          連線中斷，重新連線中…（對局由系統暫時代打，連上後會接回你的座位）
        </div>
      )}
      {roleNotice !== null && (
        <div className="notice" role="alert" data-testid="role-notice">
          {roleNotice}{' '}
          <button
            className="link"
            onClick={() => {
              setRoleNotice(null);
            }}
          >
            關閉
          </button>
        </div>
      )}
      {restored !== null && !restored.ok && (
        <div className="notice" role="alert" data-testid="restore-failed">
          原本的房間無法還原（{restored.reason}），已回到大廳，請重新開房。{' '}
          <button
            className="link"
            onClick={() => {
              setRestoreStatus(null);
            }}
          >
            關閉
          </button>
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
