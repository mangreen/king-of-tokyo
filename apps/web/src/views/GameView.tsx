import { lazy, Suspense, useMemo, useState } from 'react';
import type { Action, CardDef } from '@kot/rules';
import type { GameActionInput, GameUpdateMessage, RoomSnapshot } from '@kot/protocol';
import { envOf, groupActions, myActions } from '../actions.js';
import { GameHud } from '../hud/GameHud.js';
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

  const sweep = otherActions.find((x) => x.type === 'sweep');
  const hudGroups = groupActions(
    otherActions.filter((x) => x.type !== 'sweep'),
    labelCtx,
  );
  const prompt = promptText(state);

  const renderHud = (mode: 'overlay' | 'flat') => (
    <GameHud
      mode={mode}
      room={room}
      state={state}
      actorSeat={game.actorSeat}
      mySeat={mySeat}
      myTurn={myTurn}
      deadlineAt={deadlineAt}
      env={env}
      nameOf={nameOf}
      labelCtx={labelCtx}
      prompt={prompt}
      log={log}
      kept={kept}
      spins={spins.counts}
      canToggle={canToggle}
      canRoll={canRoll}
      canStop={canStop}
      onToggle={toggle}
      marketBuys={marketBuys}
      sweep={sweep}
      groups={hudGroups}
      onAct={onAct}
    />
  );

  return (
    <div className="game">
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
        <Suspense
          fallback={
            <>
              <p className="muted scene-loading">載入 3D 場景…（操作可先使用）</p>
              {renderHud('flat')}
            </>
          }
        >
          <Scene3D
            snapshot={snapshot}
            feed={feed}
            prefs={prefs}
            onPrefs={setPrefs}
            seed={seed}
            hud={renderHud('overlay')}
          />
        </Suspense>
      ) : (
        <>
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
          {renderHud('flat')}
        </>
      )}

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
