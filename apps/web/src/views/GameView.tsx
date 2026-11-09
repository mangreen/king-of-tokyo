import { lazy, Suspense, useMemo, useState } from 'react';
import type { Action, CardDef, Monster } from '@kot/rules';
import type { GameActionInput, GameUpdateMessage, RoomSnapshot } from '@kot/protocol';
import { envOf, groupActions, labelAction, myActions, toIntent } from '../actions.js';
import { Countdown } from './Countdown.js';
import { Die3D } from '../scene/Die3D.js';
import { nextSpins } from '../scene/dice.js';
import { loadPrefs, savePrefs, seedFromCode, webglAvailable } from '../scene/prefs.js';
import { toSnapshot } from '../scene/snapshot.js';
import type { EventBatch } from '../state.js';

// 3D 場景（Three.js）動態載入：大廳與房間不必下載它
const Scene3D = lazy(() => import('../scene/Scene3D.js'));

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
  cards: CardDef[] | null;
  log: string[];
  feed: EventBatch[];
  onAct: (action: GameActionInput) => void;
  onLeave: () => void;
}

export function GameView({
  room,
  game,
  deadlineAt,
  selfId,
  cards,
  log,
  feed,
  onAct,
  onLeave,
}: Props) {
  const { state } = game;
  const [prefs, setPrefs] = useState(loadPrefs);
  // 每顆骰子的轉動次數：新的一批事件有重擲／改骰時加一（render 期間依 version 推導，不用 effect）
  const [spins, setSpins] = useState<{ version: number; counts: number[] }>(() => ({
    version: game.version,
    counts: [],
  }));
  if (spins.version !== game.version) {
    setSpins({ version: game.version, counts: nextSpins(spins.counts, game.events) });
  }
  const [canGL] = useState(() => webglAvailable());
  const snapshot = useMemo(
    () => toSnapshot(room, state, game.actorSeat, selfId),
    [room, state, game.actorSeat, selfId],
  );
  const seed = useMemo(() => seedFromCode(room.code), [room.code]);
  const mySeat = room.players.find((p) => p.id === selfId)?.seat ?? null;
  const nameOf = (seat: number): string =>
    room.players.find((p) => p.seat === seat)?.nickname ?? `座位 ${String(seat)}`;
  const infoOf = (seat: number) => room.players.find((p) => p.seat === seat);

  const env = envOf(cards);
  const cardName = (id: string): string => env.cards[id]?.name ?? id;
  const labelCtx = { cardName, nameOf };
  const myTurn = mySeat !== null && game.actorSeat === mySeat;
  const actions = myActions(state, env, mySeat);
  // 商店牌的購買按鈕直接掛在牌上；其他動作（牌庫頂、向別人買、使用能力、提示回應…）列在動作區
  const isMarketBuy = (a: Action): a is Extract<Action, { type: 'buy' }> =>
    a.type === 'buy' && a.from === undefined;
  const marketBuys = actions.filter(isMarketBuy);
  const otherActions = actions.filter((a) => !isMarketBuy(a));
  const groups = groupActions(otherActions, labelCtx);
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

      {canGL && prefs.enabled ? (
        <Suspense fallback={<p className="muted scene-loading">載入 3D 場景…</p>}>
          <Scene3D snapshot={snapshot} feed={feed} prefs={prefs} onPrefs={setPrefs} seed={seed} />
        </Suspense>
      ) : (
        <p className="muted">
          {canGL ? '3D 場景已關閉。' : '這個瀏覽器不支援 WebGL，已使用純文字介面。'}{' '}
          {canGL && (
            <button
              className="link"
              onClick={() => {
                const next = { ...prefs, enabled: true };
                savePrefs(next);
                setPrefs(next);
              }}
            >
              開啟 3D
            </button>
          )}
        </p>
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
            <th>卡牌</th>
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
                <td className="owned">
                  {m.cards.length === 0 && m.tokens.poison + m.tokens.shrink === 0 && '—'}
                  {m.cards.map((id) => (
                    <span key={id} className="tag" title={env.cards[id]?.text ?? ''}>
                      {cardName(id)}
                    </span>
                  ))}
                  {m.tokens.poison > 0 && <span className="tag warn">毒 ×{m.tokens.poison}</span>}
                  {m.tokens.shrink > 0 && <span className="tag warn">縮小 ×{m.tokens.shrink}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {state.market && (
        <section className="card market" aria-label="商店">
          <h3>
            商店 <span className="muted">（牌庫 {state.market.deck.length} 張）</span>
          </h3>
          <div className="market-cards">
            {state.market.faceUp.map((id) => {
              const def = env.cards[id];
              const buys = marketBuys.filter((a) => a.cardId === id);
              return (
                <div key={id} className="market-card">
                  <strong>{def?.name ?? id}</strong>
                  <span className="cost">⚡{def?.cost ?? '?'}</span>
                  <span className="muted">{def?.kind === 'discard' ? '一次性' : '持續'}</span>
                  <p>{def?.text ?? ''}</p>
                  {buys.map((a) => (
                    <button
                      key={labelAction(a, labelCtx)}
                      className="primary"
                      onClick={() => {
                        onAct(toIntent(a));
                      }}
                    >
                      {labelAction(a, labelCtx)}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {state.phase !== 'over' && (
        <section className="card">
          <p>
            {game.actorSeat === null
              ? ''
              : myTurn
                ? promptText(state)
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
                  <Die3D face={face} spin={spins.counts[i] ?? 0} />
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
          </div>
          {groups.length > 0 && (
            <div className="actions">
              {groups.map((g) =>
                g.title === null ? (
                  g.actions.map((a) => (
                    <button
                      key={g.key}
                      className={
                        a.type === 'endTurn' || a.type === 'yieldDecision' ? 'primary' : undefined
                      }
                      onClick={() => {
                        onAct(toIntent(a));
                      }}
                    >
                      {labelAction(a, labelCtx)}
                    </button>
                  ))
                ) : (
                  <details key={g.key} className="use-group">
                    <summary>使用 {g.title}</summary>
                    <div className="row">
                      {g.actions.map((a) => (
                        <button
                          key={labelAction(a, labelCtx)}
                          onClick={() => {
                            onAct(toIntent(a));
                          }}
                        >
                          {labelAction(a, labelCtx).replace(/^使用 [^：]+：?/, '') || '使用'}
                        </button>
                      ))}
                    </div>
                  </details>
                ),
              )}
            </div>
          )}
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

/** 輪到我時的提示文字。 */
function promptText(state: GameUpdateMessage['state']): string {
  if (state.phase === 'prompt') {
    switch (state.pending?.kind) {
      case 'yield':
        return '你被攻擊了，要讓出東京嗎？';
      case 'react':
        return '你即將受到傷害，要使用防禦能力嗎？';
      case 'hearts':
        return `你擲出 ${String(state.pending.hearts)} 個治療，要怎麼分配？`;
      case 'probe':
        return '要重擲別人的一顆骰子嗎？';
      case 'opportunity':
        return '剛翻開的牌可以立即購買。';
      case undefined:
        return '輪到你了';
    }
  }
  if (state.phase === 'buy') return '買牌階段：可以買牌、清掉商店，或結束回合。';
  return '輪到你了';
}
