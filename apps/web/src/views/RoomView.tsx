import type { RoomSnapshot } from '@kot/protocol';
import { MIN_PLAYERS } from '@kot/protocol';
import { ShareLink } from './ShareLink.js';

interface Props {
  room: RoomSnapshot;
  selfId: string;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
}

export function RoomView({ room, selfId, onReady, onStart, onLeave }: Props) {
  const isHost = room.hostId === selfId;
  const me = room.players.find((p) => p.id === selfId);
  const others = room.players.filter((p) => p.id !== room.hostId);
  const allReady = others.every((p) => p.ready);
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
            <span className={p.ready ? 'tag ok' : 'tag'}>{p.ready ? '已準備' : '未準備'}</span>
            {!p.connected && <span className="tag warn">離線</span>}
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
        <button onClick={onLeave}>離開房間</button>
      </div>
      {isHost && !canStart && (
        <p className="muted">
          {room.players.length < MIN_PLAYERS ? '至少需要 2 位玩家。' : '等待其他玩家按下「準備」。'}
        </p>
      )}
    </div>
  );
}
