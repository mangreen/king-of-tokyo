import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { rollLimit, type Action, type CardDef } from '@kot/rules';
import type { GameActionInput, GameUpdateMessage, RoomSnapshot } from '@kot/protocol';
import { envOf, groupActions, myActions } from '../actions.js';
import { ChatPanel } from '../hud/ChatPanel.js';
import { GameHud, type HudTab } from '../hud/GameHud.js';
import { ruleConfigOf } from '../hud/Panels.js';
import { TutorialLayer } from '../hud/TutorialLayer.js';
import { hintFor, introSlides, nextHint } from '../hud/tutorial.js';
import { useTutorial } from '../hud/useTutorial.js';
import { SettingsPanel } from '../hud/SettingsPanel.js';
import { nextSpins } from '../scene/dice.js';
import {
  loadPrefs,
  prefersReducedMotion,
  savePrefs,
  seedFromCode,
  watchReducedMotion,
  webglAvailable,
  type ScenePrefs,
} from '../scene/prefs.js';
import type { QualityTier } from '../scene/quality.js';
import { seatColor } from '../scene/layout.js';
import { shopStatus, toSnapshot } from '../scene/snapshot.js';
import type { ChatEntry, EventBatch } from '../state.js';

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
  chat: ChatEntry[];
  onChat: (text: string) => void;
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
  chat,
  onChat,
  onAct,
  onLeave,
}: Props) {
  const { state } = game;
  const [prefs, setPrefs] = useState(loadPrefs);
  const [tier, setTier] = useState<QualityTier | null>(null);
  const [hudTab, setHudTab] = useState<HudTab>('players');
  const [danmakuProbe, setDanmakuProbe] = useState(0);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => watchReducedMotion(setReduced), []);
  const updatePrefs = (patch: Partial<ScenePrefs>): void => {
    const next = { ...prefs, ...patch };
    savePrefs(next);
    setPrefs(next);
  };
  // 每顆骰子的轉動次數：新的一批事件有重擲／改骰時加一（render 期間依 version 推導，不用 effect）
  const [spins, setSpins] = useState<{ version: number; counts: number[] }>(() => ({
    version: game.version,
    counts: [],
  }));
  if (spins.version !== game.version) {
    setSpins({ version: game.version, counts: nextSpins(spins.counts, game.events) });
  }
  const [canGL] = useState(() => webglAvailable());
  const env = useMemo(() => envOf(cards), [cards]);
  const snapshot = useMemo(() => {
    return toSnapshot(room, state, game.actorSeat, selfId, shopStatus(state, env));
  }, [room, state, env, game.actorSeat, selfId]);
  const seed = useMemo(() => seedFromCode(room.code), [room.code]);
  const mySeat = room.players.find((p) => p.id === selfId)?.seat ?? null;
  const nameOf = (seat: number): string =>
    room.players.find((p) => p.seat === seat)?.nickname ?? `座位 ${String(seat)}`;

  const outcomeText =
    state.phase === 'over' && state.outcome
      ? `${
          state.outcome.winners.length > 0
            ? `勝者：${state.outcome.winners.map(nameOf).join('、')}`
            : '全員淘汰，沒有勝者'
        }（${REASON_TEXT[state.outcome.reason]}）`
      : null;

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
  // 擲骰次數上限要含煙霧彈／能量重擲的額外重擲與加擲卡，不能只看基本規則的次數
  const rollMax = rollLimit(state, env);
  const regularRerolls = rollsUsed < rollMax;
  // 次數用完但持有「只重擲 3」的卡且還有 3：引擎只允許這一種擲法（保留所有非 3 的骰子）
  const threesKeep =
    myTurn && inRolling && !regularRerolls
      ? (actions.find((a): a is Extract<Action, { type: 'roll' }> => a.type === 'roll')?.keep ??
        null)
      : null;
  const canToggle = myTurn && inRolling && rollsUsed >= 1 && regularRerolls;
  const canRoll =
    myTurn &&
    inRolling &&
    ((regularRerolls && (rollsUsed === 0 || kept.size < dice.length)) || threesKeep !== null);
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

  const leaveLabel = state.phase === 'over' ? '返回大廳' : '離開對局';
  const leaveButton = <button onClick={onLeave}>{leaveLabel}</button>;

  // 新手教學：快速規則（第一次進遊戲）與情境提示（第一次遇到某個時機）
  const tutorial = useTutorial();
  const ruleCfg = ruleConfigOf(state);
  // 快速規則是對話框，開著時回合計時仍在走：第一次進遊戲若正好輪到我，先不要擋住，
  // 等到不是我的回合再跳出（情境提示照常先教擲骰）；從設定按「重看」則馬上顯示
  const [introLive, setIntroLive] = useState(false);
  if (tutorial.introOpen && !myTurn && !introLive) setIntroLive(true);
  if (!tutorial.introOpen && introLive) setIntroLive(false);
  const introShowing = tutorial.introOpen && introLive;
  const hintId = nextHint(tutorial.state, introShowing, {
    phase: state.phase,
    myTurn,
    actionTypes: new Set(actions.map((a) => a.type)),
  });

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
      feed={feed}
      kept={kept}
      spins={spins.counts}
      canToggle={canToggle}
      canRoll={canRoll}
      rollMax={rollMax}
      threesKeep={threesKeep}
      canStop={canStop}
      onToggle={toggle}
      marketBuys={marketBuys}
      sweep={sweep}
      groups={hudGroups}
      onAct={onAct}
      chat={
        <ChatPanel
          entries={chat}
          selfId={selfId}
          onSend={onChat}
          {...(canGL && prefs.enabled && prefs.danmaku
            ? {}
            : { danmakuNote: '彈幕目前沒有顯示（3D 或彈幕已關閉，可在「⚙ 設定」開啟）。' })}
        />
      }
      chatLatest={chat.at(-1)?.id ?? 0}
      initialTab={hudTab}
      onTabChange={setHudTab}
      settings={
        <SettingsPanel
          prefs={prefs}
          onChange={updatePrefs}
          canGL={canGL}
          reduced={reduced}
          tier={tier}
          tutorial={{
            enabled: tutorial.state.enabled,
            onEnabled: tutorial.setEnabled,
            onReplay: () => {
              tutorial.replayIntro();
              setIntroLive(true);
            },
            onReset: tutorial.reset,
          }}
          {...(canGL && prefs.enabled
            ? {
                onPreviewDanmaku: () => {
                  setDanmakuProbe((n) => n + 1);
                },
              }
            : {})}
        />
      }
    />
  );

  return (
    <div className="game">
      <TutorialLayer
        introOpen={introShowing}
        timerRunning={myTurn}
        slides={introSlides(ruleCfg)}
        onFinishIntro={tutorial.finishIntro}
        hint={hintId === null ? null : hintFor(hintId, ruleCfg)}
        onDismissHint={() => {
          if (hintId !== null) tutorial.dismissHint(hintId);
        }}
        onDisable={() => {
          tutorial.setEnabled(false);
        }}
      />
      {outcomeText !== null && (
        <div className="banner" role="status">
          🏆 {outcomeText}
        </div>
      )}

      {canGL && prefs.enabled ? (
        <Suspense
          fallback={
            <>
              <div className="leave-top">{leaveButton}</div>
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
            corner={leaveButton}
            cards={cards}
            onTier={setTier}
            chat={chat}
            danmakuProbe={danmakuProbe}
            selfColor={seatColor(mySeat ?? 0)}
            outcome={outcomeText}
          />
        </Suspense>
      ) : (
        <>
          <div className="leave-top">{leaveButton}</div>
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
