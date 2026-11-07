import { useState } from 'react';
import type { Face, Monster } from '@kot/rules';
import type { GameActionInput, GameUpdateMessage, RoomSnapshot } from '@kot/protocol';
import { Countdown } from './Countdown.js';

const FACE_TEXT: Record<string, string> = { energy: '⚡', attack: '💥', heal: '❤️' };
const faceText = (face: Face): string => FACE_TEXT[String(face)] ?? String(face);

const EMPTY_SET: ReadonlySet<number> = new Set();

const REASON_TEXT = {
  lastStanding: '最後一位存活',
  turnEnd: '回合結束時達標',
  roundEnd: '整輪結算',
  allEliminated: '全員淘汰',
} as const;

interface Props {
  room: RoomSnapshot;
  game: GameUpdateMessage;
  deadlineAt: number | null;
  selfId: string;
  log: string[];
  onAct: (action: GameActionInput) => void;
  onLeave: () => void;
}

export function GameView({ room, game, deadlineAt, selfId, log, onAct, onLeave }: Props) {
  const { state } = game;
  const mySeat = room.players.find((p) => p.id === selfId)?.seat ?? null;
  const nameOf = (seat: number): string =>
    room.players.find((p) => p.seat === seat)?.nickname ?? `座位 ${String(seat)}`;
  const infoOf = (seat: number) => room.players.find((p) => p.seat === seat);

  const myTurn = mySeat !== null && game.actorSeat === mySeat;
  // 保留的骰子只對「同一個狀態版本」有效：有新的擲骰結果（版本改變）就自動視為沒有保留
  const [keptState, setKeptState] = useState<{ version: number; indexes: Set<number> }>({
    version: state.version,
    indexes: new Set(),
  });
  const kept = keptState.version === state.version ? keptState.indexes : EMPTY_SET;

  const inRolling = state.phase === 'roll';
  const { rollsUsed, dice } = state.turn;
  const maxRolls = state.config.maxRolls;
  const canToggle = myTurn && inRolling && rollsUsed >= 1 && rollsUsed < maxRolls;
  const canRoll =
    myTurn && inRolling && rollsUsed < maxRolls && (rollsUsed === 0 || kept.size < dice.length);
  const canStop = myTurn && inRolling && rollsUsed >= 1;

  function toggle(index: number): void {
    if (!canToggle) return;
    const next = new Set(kept);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setKeptState({ version: state.version, indexes: next });
  }

  const city = state.monsters.find((m) => m.alive && m.location === 'city');
  const bay = state.monsters.find((m) => m.alive && m.location === 'bay');
  const showBay = state.config.playerCount >= 5;

  const describeMonster = (m: Monster | undefined): string =>
    m ? `${nameOf(m.seat)}（HP ${String(m.hp)}）` : '空';

  return (
    <div className="game">
      <header className="game-head">
        <span>
          房間 <span className="room-code">{room.code}</span> · 第 {state.round} 輪
        </span>
        <Countdown deadlineAt={deadlineAt} />
      </header>

      {state.phase === 'over' && state.outcome && (
        <div className="banner" role="status">
          🏆{' '}
          {state.outcome.winners.length > 0
            ? `勝者：${state.outcome.winners.map(nameOf).join('、')}`
            : '全員淘汰，沒有勝者'}
          （{REASON_TEXT[state.outcome.reason]}）
        </div>
      )}

      <section className="tokyo">
        <div className="slot">
          <h3>東京市</h3>
          <p>{describeMonster(city)}</p>
        </div>
        {showBay && (
          <div className="slot">
            <h3>東京灣</h3>
            <p>{describeMonster(bay)}</p>
          </div>
        )}
      </section>

      <table className="monsters">
        <thead>
          <tr>
            <th>玩家</th>
            <th>HP</th>
            <th>VP</th>
            <th>能量</th>
            <th>位置</th>
          </tr>
        </thead>
        <tbody>
          {state.monsters.map((m) => {
            const info = infoOf(m.seat);
            return (
              <tr
                key={m.seat}
                className={[
                  m.alive ? '' : 'dead',
                  game.actorSeat === m.seat ? 'active' : '',
                  m.seat === mySeat ? 'me' : '',
                ].join(' ')}
              >
                <td>
                  {nameOf(m.seat)}
                  {m.seat === mySeat && '（你）'}
                  {info && !info.connected && <span className="tag warn">離線</span>}
                  {info?.away && <span className="tag warn">代打中</span>}
                  {!m.alive && <span className="tag">淘汰</span>}
                </td>
                <td>{m.hp}</td>
                <td>{m.vp}</td>
                <td>{m.energy}</td>
                <td>{m.location === 'city' ? '東京市' : m.location === 'bay' ? '東京灣' : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {state.phase !== 'over' && (
        <section className="card">
          <p>
            {game.actorSeat === null
              ? ''
              : myTurn
                ? state.phase === 'yield'
                  ? '你被攻擊了，要讓出東京嗎？'
                  : '輪到你了'
                : `等待 ${nameOf(game.actorSeat)}…`}
          </p>
          <div className="dice" aria-label="骰子">
            {dice.length === 0 ? (
              <span className="muted">尚未擲骰</span>
            ) : (
              dice.map((face, i) => (
                <button
                  key={i}
                  className={kept.has(i) ? 'die kept' : 'die'}
                  disabled={!canToggle}
                  onClick={() => {
                    toggle(i);
                  }}
                  aria-pressed={kept.has(i)}
                >
                  {faceText(face)}
                </button>
              ))
            )}
          </div>
          {state.phase === 'roll' && (
            <p className="muted">
              已擲 {rollsUsed} / {maxRolls} 次{canToggle && '；點骰子可「保留」，其餘會重擲'}
            </p>
          )}
          <div className="row">
            {state.phase === 'roll' && (
              <>
                <button
                  className="primary"
                  disabled={!canRoll}
                  onClick={() => {
                    onAct({ type: 'roll', keep: rollsUsed === 0 ? [] : [...kept] });
                  }}
                >
                  {rollsUsed === 0 ? '擲骰' : '重擲'}
                </button>
                <button
                  disabled={!canStop}
                  onClick={() => {
                    onAct({ type: 'endRolling' });
                  }}
                >
                  結算
                </button>
              </>
            )}
            {state.phase === 'yield' && myTurnYield(game, mySeat) && (
              <>
                <button
                  className="primary"
                  onClick={() => {
                    onAct({ type: 'yieldDecision', leave: true });
                  }}
                >
                  讓位
                </button>
                <button
                  onClick={() => {
                    onAct({ type: 'yieldDecision', leave: false });
                  }}
                >
                  留下
                </button>
              </>
            )}
          </div>
        </section>
      )}

      <section className="card log">
        <h3>事件</h3>
        <ol>
          {log.slice(-40).map((line, i) => (
            <li key={`${String(i)}-${line}`}>{line}</li>
          ))}
        </ol>
      </section>

      <p>
        <button onClick={onLeave}>{state.phase === 'over' ? '返回大廳' : '離開對局'}</button>
      </p>
    </div>
  );
}

/** 讓位階段由 actorSeat（佇列第一位）決定。 */
function myTurnYield(game: GameUpdateMessage, mySeat: number | null): boolean {
  return mySeat !== null && game.actorSeat === mySeat;
}
