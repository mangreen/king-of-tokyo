import { monsterKindOf, monsterName } from '../scene/roster.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Action, Face, GameState, Monster, RulesEnv } from '@kot/rules';
import type { GameActionInput, RoomSnapshot } from '@kot/protocol';
import { labelAction, toIntent, type ActionGroup, type LabelContext } from '../actions.js';
import { Die3D } from '../scene/Die3D.js';
import { seatColor } from '../scene/layout.js';
import { CardBody, CardChip } from './CardChip.js';
import { diceRules, diceSummary, endRules, tokyoRules, type RuleConfig } from './rulesText.js';

type Env = RulesEnv;
type Act = (a: GameActionInput) => void;

export function ruleConfigOf(state: GameState): RuleConfig {
  const c = state.config;
  return {
    victoryPoints: c.victoryPoints,
    startingHp: c.startingHp,
    maxRolls: c.maxRolls,
    diceCount: c.diceCount,
    playerCount: c.playerCount,
  };
}

function RuleBlocks({ sections }: { sections: { title: string; lines: string[] }[] }) {
  return (
    <>
      {sections.map((s) => (
        <section key={s.title} className="rule-block">
          <h4>{s.title}</h4>
          <ul>
            {s.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

// ── 玩家 ──────────────────────────────────────────

interface PlayersProps {
  state: GameState;
  room: RoomSnapshot;
  actorSeat: number | null;
  mySeat: number | null;
  nameOf: (seat: number) => string;
  env: Env;
}

export function PlayersPanel({ state, room, actorSeat, mySeat, nameOf, env }: PlayersProps) {
  const city = state.monsters.find((m) => m.alive && m.location === 'city');
  const bay = state.monsters.find((m) => m.alive && m.location === 'bay');
  const where = (m: Monster | undefined): string => (m ? nameOf(m.seat) : '空');
  return (
    <div className="players-panel">
      <p className="muted tokyo-line">
        東京市：{where(city)}
        {state.config.playerCount >= 5 && ` · 東京灣：${where(bay)}`}
      </p>
      <ul className="p-list">
        {state.monsters.map((m) => {
          const info = room.players.find((p) => p.seat === m.seat);
          const cls = [
            'p-row',
            m.alive ? '' : 'dead',
            actorSeat === m.seat ? 'active' : '',
            m.seat === mySeat ? 'me' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={m.seat} className={cls} style={{ '--seat': seatColor(m.seat) } as never}>
              <div className="p-line">
                <span className="p-name">
                  {nameOf(m.seat)}
                  {m.seat === mySeat && '（你）'}
                </span>
                <span className="tag monster-tag">
                  {monsterName(monsterKindOf(m.seat, info?.monster))}
                </span>
                {info && !info.connected && <span className="tag warn">離線</span>}
                {info?.away && <span className="tag warn">代打中</span>}
                {!m.alive && <span className="tag">淘汰</span>}
                {m.alive && m.location && (
                  <span className="tag">{m.location === 'city' ? '東京市' : '東京灣'}</span>
                )}
              </div>
              <div className="p-stats" aria-label="生命、勝利點、能量">
                <span>❤ {m.hp}</span>
                <span>★ {m.vp}</span>
                <span>⚡ {m.energy}</span>
              </div>
              {(m.cards.length > 0 || m.tokens.poison + m.tokens.shrink > 0) && (
                <div className="p-cards">
                  {m.cards.map((id) => (
                    <CardChip key={id} id={id} def={env.cards[id]} />
                  ))}
                  {m.tokens.poison > 0 && <span className="tag warn">毒 ×{m.tokens.poison}</span>}
                  {m.tokens.shrink > 0 && <span className="tag warn">縮小 ×{m.tokens.shrink}</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── 商店 ──────────────────────────────────────────

interface ShopProps {
  state: GameState;
  env: Env;
  buys: Extract<Action, { type: 'buy' }>[];
  sweep: Action | undefined;
  labelCtx: LabelContext;
  onAct: Act;
}

export function ShopPanel({ state, env, buys, sweep, labelCtx, onAct }: ShopProps) {
  if (!state.market) return <p className="muted">這個牌組沒有商店。</p>;
  return (
    <div className="shop">
      <p className="muted">
        牌庫剩 {state.market.deck.length} 張 · 買牌階段才能購買（結算骰子之後）
      </p>
      <div className="shop-cards">
        {state.market.faceUp.map((id) => {
          const def = env.cards[id];
          const mine = buys.filter((a) => a.cardId === id);
          return (
            <div key={id} className="shop-card">
              {def ? <CardBody def={def} /> : <strong>{id}</strong>}
              {mine.map((a) => (
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
      {sweep && (
        <button
          onClick={() => {
            onAct(toIntent(sweep));
          }}
        >
          {labelAction(sweep, labelCtx)}
        </button>
      )}
    </div>
  );
}

// ── 我的卡牌 ───────────────────────────────────────

export function MyCardsPanel({ monster, env }: { monster: Monster | undefined; env: Env }) {
  if (!monster) return <p className="muted">你不在這局裡。</p>;
  if (monster.cards.length === 0 && monster.tokens.poison + monster.tokens.shrink === 0) {
    return <p className="muted">還沒有持有的卡牌。到商店買牌吧。</p>;
  }
  return (
    <div className="shop-cards">
      {monster.cards.map((id) => {
        const def = env.cards[id];
        return (
          <div key={id} className="shop-card">
            {def ? <CardBody def={def} /> : <strong>{id}</strong>}
          </div>
        );
      })}
      {monster.tokens.poison > 0 && <p className="tag warn">毒 ×{monster.tokens.poison}</p>}
      {monster.tokens.shrink > 0 && <p className="tag warn">縮小 ×{monster.tokens.shrink}</p>}
    </div>
  );
}

// ── 事件 ──────────────────────────────────────────

export function LogPanel({ log, rules }: { log: string[]; rules: RuleConfig }) {
  const [showEnd, setShowEnd] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  return (
    <div className="log-panel">
      <button
        className="rule-toggle"
        aria-expanded={showEnd}
        onClick={() => {
          setShowEnd((v) => !v);
        }}
      >
        🏁 勝利條件 {showEnd ? '▴' : '▾'}
      </button>
      {showEnd && (
        <div className="rule-pop">
          <RuleBlocks sections={endRules(rules)} />
        </div>
      )}
      <ol ref={list} className="log-list">
        {log.slice(-60).map((line, i) => (
          <li key={`${String(i)}-${line}`}>{line}</li>
        ))}
      </ol>
    </div>
  );
}

// ── 規則 ──────────────────────────────────────────

export function RulesPanel({ state, nameOf }: { state: GameState; nameOf: (s: number) => string }) {
  const rules = ruleConfigOf(state);
  const goal = rules.victoryPoints;
  return (
    <div className="rules-panel">
      <section className="rule-block">
        <h4>目前進度（目標 {goal} VP）</h4>
        <ul className="progress">
          {state.monsters.map((m) => (
            <li key={m.seat} className={m.alive ? '' : 'dead'}>
              <span>{nameOf(m.seat)}</span>
              <meter
                min={0}
                max={goal}
                value={Math.min(goal, m.vp)}
                aria-label={`${nameOf(m.seat)} 的 VP`}
              />
              <span>
                {m.vp}/{goal}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <RuleBlocks sections={endRules(rules)} />
      <RuleBlocks sections={diceRules(rules)} />
      <RuleBlocks sections={tokyoRules(rules)} />
    </div>
  );
}

// ── 骰子與操作 ─────────────────────────────────────

interface ActionProps {
  state: GameState;
  actorSeat: number | null;
  myTurn: boolean;
  me: Monster | undefined;
  nameOf: (s: number) => string;
  prompt: string;
  kept: ReadonlySet<number>;
  spins: number[];
  canToggle: boolean;
  canRoll: boolean;
  canStop: boolean;
  onToggle: (i: number) => void;
  groups: ActionGroup[];
  labelCtx: LabelContext;
  onAct: Act;
  extra?: ReactNode;
  /** 商店還有買得起的牌、玩家也還沒按「離開商店」：結束回合的按鈕先換成「離開商店」。 */
  holdEndTurn?: boolean;
  onLeaveShop?: () => void;
}

export function ActionPanel(p: ActionProps) {
  const { state, myTurn, kept } = p;
  const [help, setHelp] = useState(false);
  const { rollsUsed, dice } = state.turn;
  const maxRolls = state.config.maxRolls;
  const rules = ruleConfigOf(state);
  const actorMonster = state.monsters.find((m) => m.seat === p.actorSeat);
  const inTokyo = actorMonster ? actorMonster.location !== null : null;
  const summary = diceSummary(dice as readonly Face[], inTokyo);
  return (
    <div className="action-panel">
      <p className="prompt">
        {p.actorSeat === null ? '' : myTurn ? p.prompt : `等待 ${p.nameOf(p.actorSeat)}…`}
      </p>
      <div className="dice" aria-label="骰子">
        {dice.length === 0 ? (
          <span className="muted">尚未擲骰</span>
        ) : (
          dice.map((face, i) => (
            <button
              key={i}
              className={kept.has(i) ? 'die kept' : 'die'}
              disabled={!p.canToggle}
              onClick={() => {
                p.onToggle(i);
              }}
              aria-pressed={kept.has(i)}
            >
              <Die3D face={face} spin={p.spins[i] ?? 0} />
            </button>
          ))
        )}
      </div>
      {state.phase === 'roll' && (
        <p className="muted small">
          已擲 {rollsUsed} / {maxRolls} 次{p.canToggle && '；點骰子可「保留」，其餘會重擲'}
        </p>
      )}
      <div className="row">
        {state.phase === 'roll' && (
          <>
            <button
              className="primary"
              disabled={!p.canRoll}
              onClick={() => {
                p.onAct({ type: 'roll', keep: rollsUsed === 0 ? [] : [...kept] });
              }}
            >
              {rollsUsed === 0 ? '擲骰' : '重擲'}
            </button>
            <button
              disabled={!p.canStop}
              onClick={() => {
                p.onAct({ type: 'endRolling' });
              }}
            >
              結算
            </button>
          </>
        )}
        <button
          className="rule-toggle"
          aria-expanded={help}
          onClick={() => {
            setHelp((v) => !v);
          }}
        >
          ❓ 結算規則 {help ? '▴' : '▾'}
        </button>
      </div>
      {summary.length > 0 && (
        <ul className="dice-summary" aria-label="目前骰子的結算預覽">
          {summary.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {help && (
        <div className="rule-pop">
          <RuleBlocks sections={diceRules(rules)} />
        </div>
      )}
      {p.groups.length > 0 && (
        <div className="actions">
          {p.groups.map((g) =>
            g.title === null ? (
              g.actions.map((a) =>
                a.type === 'endTurn' && p.holdEndTurn ? (
                  <button
                    key={g.key}
                    className="leave-shop"
                    onClick={() => {
                      p.onLeaveShop?.();
                    }}
                  >
                    🚪 離開商店
                  </button>
                ) : (
                  <button
                    key={g.key}
                    className={
                      a.type === 'endTurn' || a.type === 'yieldDecision' ? 'primary' : undefined
                    }
                    onClick={() => {
                      p.onAct(toIntent(a));
                    }}
                  >
                    {labelAction(a, p.labelCtx)}
                  </button>
                ),
              )
            ) : (
              <details key={g.key} className="use-group">
                <summary>使用 {g.title}</summary>
                <div className="row">
                  {g.actions.map((a) => (
                    <button
                      key={labelAction(a, p.labelCtx)}
                      onClick={() => {
                        p.onAct(toIntent(a));
                      }}
                    >
                      {labelAction(a, p.labelCtx).replace(/^使用 [^：]+：?/, '') || '使用'}
                    </button>
                  ))}
                </div>
              </details>
            ),
          )}
        </div>
      )}
      {p.extra}
    </div>
  );
}
