import type { RoomSnapshot } from '@kot/protocol';
import { MAX_PLAYERS, MIN_PLAYERS } from '@kot/protocol';
import { ShareLink } from './ShareLink.js';

interface Props {
  room: RoomSnapshot;
  selfId: string;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onAddBot: () => void;
  onRemoveBot: (id: string) => void;
  onLeave: () => void;
}

export function RoomView({
  room,
  selfId,
  onReady,
  onStart,
  onAddBot,
  onRemoveBot,
  onLeave,
}: Props) {
  const isHost = room.hostId === selfId;
  const me = room.players.find((p) => p.id === selfId);
  const others = room.players.filter((p) => p.id !== room.hostId);
  const allReady = others.every((p) => p.ready);
  const canAddBot = isHost && room.players.length < MAX_PLAYERS;
  const canStart = room.players.length >= MIN_PLAYERS && allReady;

  return (
    <div className="card">
      <h2>
        房間 <span className="room-code">{room.code}</span>
      </h2>
      <p>
        卡牌組：<strong>{room.cardSet.name}</strong>（{room.cardSet.cardCount} 張）
      </p>
      <ShareLink code={room.code} />
      <ul className="players">
        {room.players.map((p) => (
          <li key={p.id}>
            <span>
              {p.nickname}
              {p.id === selfId && '（你）'}
              {p.id === room.hostId && ' 👑'}
            </span>
            {p.bot ? (
              <span className="tag bot-tag">🤖 電腦</span>
            ) : (
              <span className={p.ready ? 'tag ok' : 'tag'}>{p.ready ? '已準備' : '未準備'}</span>
            )}
            {!p.bot && !p.connected && <span className="tag warn">離線</span>}
            {isHost && p.bot && (
              <button
                type="button"
                className="bot-remove"
                aria-label={`移除 ${p.nickname}`}
                onClick={() => {
                  onRemoveBot(p.id);
                }}
              >
                移除
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="row">
        {isHost ? (
          <button className="primary" disabled={!canStart} onClick={onStart}>
            開始遊戲
          </button>
        ) : (
          <button className="primary" onClick={() => onReady(!(me?.ready ?? false))}>
            {me?.ready ? '取消準備' : '準備'}
          </button>
        )}
        {isHost && (
          <button type="button" disabled={!canAddBot} onClick={onAddBot}>
            🤖 加入電腦
          </button>
        )}
        <button onClick={onLeave}>離開房間</button>
      </div>
      {isHost && (
        <p className="muted">
          電腦玩家用專門設計的策略出手（比一般代管強），不受逾時代管限制；真人與電腦合計最多{' '}
          {MAX_PLAYERS} 位。
        </p>
      )}
      {isHost && !canStart && (
        <p className="muted">
          {room.players.length < MIN_PLAYERS
            ? '至少需要 2 位玩家：可以邀請朋友，或按「加入電腦」。'
            : '等待其他玩家按下「準備」。'}
        </p>
      )}
    </div>
  );
}
