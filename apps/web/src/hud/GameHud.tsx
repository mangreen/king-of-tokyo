import { useState, type ReactNode } from 'react';
import type { Action, GameState, Monster, RulesEnv } from '@kot/rules';
import type { GameActionInput, RoomSnapshot } from '@kot/protocol';
import type { ActionGroup, LabelContext } from '../actions.js';
import { Countdown } from '../views/Countdown.js';
import { Tip } from './Tip.js';
import {
  ActionPanel,
  LogPanel,
  MyCardsPanel,
  PlayersPanel,
  RulesPanel,
  ruleConfigOf,
  ShopPanel,
} from './Panels.js';
import { endRules } from './rulesText.js';

export type HudTab = 'players' | 'shop' | 'log' | 'rules' | 'mine';

const TABS: { key: HudTab; label: string }[] = [
  { key: 'players', label: '👥 玩家' },
  { key: 'shop', label: '🛒 商店' },
  { key: 'log', label: '📜 事件' },
  { key: 'rules', label: '📖 規則' },
  { key: 'mine', label: '🃏 我的卡牌' },
];

export interface HudProps {
  /** overlay：疊在 3D 場景上（寬螢幕）；flat：沒有 3D 時放在頁面裡。窄螢幕兩者排版相同。 */
  mode: 'overlay' | 'flat';
  room: RoomSnapshot;
  state: GameState;
  actorSeat: number | null;
  mySeat: number | null;
  myTurn: boolean;
  deadlineAt: number | null;
  env: RulesEnv;
  nameOf: (seat: number) => string;
  labelCtx: LabelContext;
  prompt: string;
  log: string[];
  // 骰子
  kept: ReadonlySet<number>;
  spins: number[];
  canToggle: boolean;
  canRoll: boolean;
  canStop: boolean;
  onToggle: (i: number) => void;
  // 動作
  marketBuys: Extract<Action, { type: 'buy' }>[];
  sweep: Action | undefined;
  groups: ActionGroup[];
  onAct: (a: GameActionInput) => void;
  /** 工具列右側的額外按鈕（例如全螢幕、離開）。 */
  tools?: ReactNode;
}

/**
 * 遊戲 HUD：狀態列、玩家、骰子與操作、商店／事件／規則／我的卡牌。
 * 疊在 3D 場景上時，玩家與操作固定在畫面上，其餘用分頁抽屜開關；
 * 窄螢幕（或沒有 3D）時改成直向排列，同一份內容、同樣的操作。
 */
export function GameHud(p: HudProps) {
  const { state } = p;
  const [tab, setTab] = useState<HudTab>('players');
  // 輪到我買牌時自動打開商店一次；離開買牌階段時若是自動打開的就收起來
  const [auto, setAuto] = useState<{ key: string | null; opened: boolean }>({
    key: null,
    opened: false,
  });
  const buyKey =
    state.phase === 'buy' && p.myTurn ? `${String(state.round)}-${String(p.actorSeat)}` : null;
  if (buyKey !== null && buyKey !== auto.key) {
    setAuto({ key: buyKey, opened: true });
    setTab('shop');
  } else if (buyKey === null && auto.opened) {
    setAuto({ key: auto.key, opened: false });
    if (tab === 'shop') setTab('players');
  }

  const me: Monster | undefined = state.monsters.find((m) => m.seat === p.mySeat);
  const rules = ruleConfigOf(state);
  const goal = rules.victoryPoints;
  const actor = p.actorSeat === null ? null : p.nameOf(p.actorSeat);

  const tabLabel = TABS.find((t) => t.key === tab)?.label;

  return (
    <div className={`hud ${p.mode}`}>
      <div className="hud-top hud-pop">
        <span className="hud-status">
          房間 <span className="room-code">{p.room.code}</span> · 第 {state.round} 輪
          {actor !== null && state.phase !== 'over' && (
            <>
              {' '}
              · <strong>{p.myTurn ? '你的回合' : `${actor} 的回合`}</strong>
            </>
          )}{' '}
          <Countdown deadlineAt={p.deadlineAt} />
        </span>
        <Tip
          label={`勝利條件：${String(goal)} VP`}
          className="goal-chip"
          content={
            <div className="rule-tip">
              {endRules(rules).map((s) => (
                <section key={s.title} className="rule-block">
                  <h4>{s.title}</h4>
                  <ul>
                    {s.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          }
        >
          🏁 {goal} VP
        </Tip>
      </div>

      {state.phase !== 'over' && (
        <div className="hud-actions hud-pop">
          <ActionPanel
            state={state}
            actorSeat={p.actorSeat}
            myTurn={p.myTurn}
            me={me}
            nameOf={p.nameOf}
            prompt={p.prompt}
            kept={p.kept}
            spins={p.spins}
            canToggle={p.canToggle}
            canRoll={p.canRoll}
            canStop={p.canStop}
            onToggle={p.onToggle}
            groups={p.groups}
            labelCtx={p.labelCtx}
            onAct={p.onAct}
          />
        </div>
      )}

      <div className="hud-info hud-pop">
        <nav className="hud-tabs" aria-label="遊戲資訊">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'on' : undefined}
              aria-pressed={tab === t.key}
              onClick={() => {
                setTab(t.key);
              }}
            >
              {t.label}
              {t.key === 'shop' && p.marketBuys.length > 0 && (
                <span className="badge">{p.marketBuys.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="hud-info-body" role="region" aria-label={tabLabel}>
          {tab === 'players' && (
            <PlayersPanel
              state={state}
              room={p.room}
              actorSeat={p.actorSeat}
              mySeat={p.mySeat}
              nameOf={p.nameOf}
              env={p.env}
            />
          )}
          {tab === 'shop' && (
            <ShopPanel
              state={state}
              env={p.env}
              buys={p.marketBuys}
              sweep={p.sweep}
              labelCtx={p.labelCtx}
              onAct={p.onAct}
            />
          )}
          {tab === 'log' && <LogPanel log={p.log} rules={rules} />}
          {tab === 'rules' && <RulesPanel state={state} nameOf={p.nameOf} />}
          {tab === 'mine' && <MyCardsPanel monster={me} env={p.env} />}
        </div>
      </div>
      {p.tools}
    </div>
  );
}
