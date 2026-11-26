import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent } from '@kot/rules';
import { SettingsPanel } from '../hud/SettingsPanel.js';
import { defaultPrefs, prefersReducedMotion, savePrefs, type ScenePrefs } from './prefs.js';
import Scene3D from './Scene3D.js';
import type { CardDef } from '@kot/rules';
import originalCardSet from '../../../../card-sets/original/set.json';
import { THEME_STYLE, themeOf, type CardTheme } from './cardFx.js';
import type { SceneRenderer, SceneSnapshot } from './SceneRenderer.js';
import type { FeedBatch } from './feed.js';

/**
 * 離線展示頁（網址加 ?scene-demo）：不連伺服器，用假狀態與假事件測試 3D 場景。
 * 給開發與截圖驗證用，不影響正式遊戲。
 */

declare global {
  interface Window {
    __kotScene?: SceneRenderer | null;
  }
}

const NAMES = ['小蜥', '大猿', '機甲', '章魚', '巨蟹', '飛龍'];

const CARDS = (originalCardSet as { cards: CardDef[] }).cards;
/** 每種特效主題挑一張代表牌（展示頁用）。 */
const SAMPLE_BY_THEME = new Map<CardTheme, CardDef>();
for (const c of CARDS) if (!SAMPLE_BY_THEME.has(themeOf(c))) SAMPLE_BY_THEME.set(themeOf(c), c);
const MARKET = CARDS.slice(0, 3).map((c) => c.id);

function initial(players: number, kinds: number[]): SceneSnapshot {
  return {
    playerCount: players,
    bayOpen: players >= 5,
    activeSeat: 0,
    mySeat: 0,
    shop: MARKET,
    monsters: Array.from({ length: players }, (_, seat) => ({
      seat,
      name: NAMES[seat] ?? `座位 ${String(seat)}`,
      kind: kinds[seat] ?? seat,
      alive: true,
      hp: 10,
      maxHp: 10,
      vp: seat,
      energy: 2,
      location:
        seat === 1 ? ('city' as const) : players >= 5 && seat === 2 ? ('bay' as const) : null,
    })),
  };
}

export default function Demo() {
  const params = new URLSearchParams(window.location.search);
  const players = Math.max(2, Math.min(6, Number(params.get('players') ?? 6)));
  const [snap, setSnap] = useState<SceneSnapshot>(() =>
    initial(
      players,
      (params.get('kinds') ?? '')
        .split(',')
        .filter((x) => x !== '')
        .map(Number),
    ),
  );
  const [feed, setFeed] = useState<FeedBatch[]>([]);
  const [prefs, setPrefs] = useState<ScenePrefs>(() => ({
    ...defaultPrefs(prefersReducedMotion()),
    quality: (params.get('quality') as ScenePrefs['quality'] | null) ?? 'auto',
  }));
  const version = useRef(1);
  const snapRef = useRef(snap);
  useEffect(() => {
    snapRef.current = snap;
  });

  const push = (events: GameEvent[], next?: (s: SceneSnapshot) => SceneSnapshot): void => {
    if (next) setSnap((s) => next(s));
    setFeed((f) => [...f, { version: version.current++, events }]);
  };
  const patch =
    (seat: number, p: Partial<SceneSnapshot['monsters'][number]>) =>
    (s: SceneSnapshot): SceneSnapshot => ({
      ...s,
      monsters: s.monsters.map((m) => (m.seat === seat ? { ...m, ...p } : m)),
    });
  const hpOf = (seat: number): number =>
    snapRef.current.monsters.find((m) => m.seat === seat)?.hp ?? 10;

  const actions: [string, () => void][] = [
    [
      '輕擊（2）',
      () => {
        push(
          [
            { type: 'smash', attacker: 0, damage: 2, targets: [1] },
            { type: 'damage_taken', seat: 1, amount: 2, hp: hpOf(1) - 2, source: 0 },
          ],
          patch(1, { hp: Math.max(1, hpOf(1) - 2) }),
        );
      },
    ],
    [
      '重擊（6）',
      () => {
        push(
          [
            { type: 'smash', attacker: 3 % players, damage: 6, targets: [1] },
            {
              type: 'damage_taken',
              seat: 1,
              amount: 6,
              hp: Math.max(1, hpOf(1) - 6),
              source: 3 % players,
            },
          ],
          patch(1, { hp: Math.max(1, hpOf(1) - 6) }),
        );
      },
    ],
    [
      '毒傷',
      () => {
        push(
          [
            {
              type: 'damage_taken',
              seat: 1,
              amount: 1,
              hp: Math.max(1, hpOf(1) - 1),
              source: null,
              cause: 'poison',
            },
          ],
          patch(1, { hp: Math.max(1, hpOf(1) - 1) }),
        );
      },
    ],
    [
      '讓位＋進東京',
      () => {
        push(
          [
            { type: 'yielded', seat: 1, location: 'city' },
            { type: 'entered_tokyo', seat: 0, location: 'city' },
          ],
          (s) => ({
            ...s,
            monsters: s.monsters.map((m) =>
              m.seat === 1
                ? { ...m, location: null }
                : m.seat === 0
                  ? { ...m, location: 'city' }
                  : m,
            ),
          }),
        );
      },
    ],
    [
      '拾取＋護盾',
      () => {
        push([
          { type: 'energy_gained', seat: 0, amount: 2 },
          { type: 'healed', seat: 0, amount: 1 },
          { type: 'damage_prevented', seat: 0, amount: 1, cardId: 'x' },
        ]);
      },
    ],
    [
      '淘汰',
      () => {
        push([{ type: 'eliminated', seat: 1, by: 0 }], patch(1, { alive: false, hp: 0 }));
      },
    ],
    [
      '勝利',
      () => {
        push([{ type: 'game_over', winners: [0], reason: 'turnEnd' } as GameEvent]);
      },
    ],
    [
      '連續戰鬥',
      () => {
        const ev: GameEvent[] = [];
        for (const t of [1, 2 % players, 3 % players]) {
          ev.push({ type: 'smash', attacker: 0, damage: 3, targets: [t] });
          ev.push({ type: 'damage_taken', seat: t, amount: 3, hp: 5, source: 0 });
        }
        push(ev);
      },
    ],
    [
      '買牌（飛碟）',
      () => {
        const bought = MARKET[1] ?? '';
        const fresh = CARDS[10]?.id ?? '';
        push(
          [
            { type: 'card_bought', seat: 0, cardId: bought, cost: 3, from: null },
            { type: 'card_revealed', cardId: fresh },
          ],
          (s) => ({ ...s, shop: [MARKET[0] ?? '', fresh, MARKET[2] ?? ''] }),
        );
      },
    ],
    [
      '商店開／關（飛碟入場／離場）',
      () => {
        setSnap((s) => ({ ...s, shop: s.shop ? null : MARKET, shopRefresh: false }));
      },
    ],
    [
      '買不起但清得起（飛碟＋♻）',
      () => {
        setSnap((s) => ({ ...s, shop: null, shopRefresh: !s.shopRefresh }));
      },
    ],
    ...(['poison', 'shrink'] as const).map((kind): [string, () => void] => [
      kind === 'poison' ? '☠ 座位 0 中毒 +1（3 次後清除）' : '🤏 座位 0 縮小 +1（3 次後清除）',
      () => {
        setSnap((s) => ({
          ...s,
          monsters: s.monsters.map((m) => {
            if (m.seat !== 0) return m;
            const t = m.tokens ?? { poison: 0, shrink: 0 };
            return { ...m, tokens: { ...t, [kind]: t[kind] >= 3 ? 0 : t[kind] + 1 } };
          }),
        }));
      },
    ]),
    [
      '🥴 震地暈眩 開／關（全部怪獸）',
      () => {
        setSnap((s) => {
          const on = s.monsters.some((m) => (m.dizzy ?? 0) > 0);
          return {
            ...s,
            monsters: s.monsters.map((m) => ({ ...m, dizzy: on ? 0 : 1 })),
          };
        });
      },
    ],
    [
      '🎡 東京灣 開放／關閉（摩天輪立起／倒塌）',
      () => {
        setSnap((s) => ({ ...s, bayOpen: s.bayOpen === false }));
      },
    ],
    [
      '清商店（飛碟）',
      () => {
        const old = snapRef.current.shop ?? MARKET;
        const fresh = CARDS.slice(20, 23).map((c) => c.id);
        push(
          [
            { type: 'market_swept', seat: 0, discarded: [...old] },
            ...fresh.map((cardId) => ({ type: 'card_revealed' as const, cardId })),
          ],
          (s) => ({ ...s, shop: fresh }),
        );
      },
    ],
    [
      '勝利（座位 0）',
      () => {
        push([{ type: 'game_over', winners: [0], reason: 'turnEnd' }], (s) => ({
          ...s,
          winners: [0],
        }));
      },
    ],
    [
      '雙勝者（0、1）',
      () => {
        push([{ type: 'game_over', winners: [0, 1], reason: 'roundEnd' }], (s) => ({
          ...s,
          winners: [0, 1],
        }));
      },
    ],
    [
      '被動發動（銳爪）',
      () => {
        push([{ type: 'card_triggered', seat: 0, cardId: 'o-razor-claw' }]);
      },
    ],
    ...[...SAMPLE_BY_THEME.entries()].map(([theme, card]): [string, () => void] => [
      `${THEME_STYLE[theme].icon}${card.name}`,
      () => {
        push([{ type: 'card_used', seat: 0, cardId: card.id }]);
      },
    ]),
    [
      '重置',
      () => {
        setSnap(
          initial(
            players,
            snapRef.current.monsters.map((m) => m.kind),
          ),
        );
        setFeed([]);
        version.current = 1;
      },
    ],
  ];

  const scene = useMemo(
    () => (
      <Scene3D
        snapshot={snap}
        outcome={
          (snap.winners?.length ?? 0) > 0
            ? `勝者：${(snap.winners ?? []).map((w) => NAMES[w] ?? w).join('、')}`
            : null
        }
        feed={feed}
        prefs={prefs}
        onPrefs={(p) => {
          savePrefs(p);
          setPrefs(p);
        }}
        seed={12345}
        cards={CARDS}
        onReady={(r) => {
          window.__kotScene = r;
        }}
      />
    ),
    [snap, feed, prefs],
  );

  const [stats, setStats] = useState('');
  useEffect(() => {
    const id = window.setInterval(() => {
      const st = window.__kotScene?.getStats();
      setStats(
        st
          ? `FPS ${String(st.fps)}｜畫質 ${st.tier}｜draw calls ${String(st.drawCalls)}｜三角面 ${String(st.triangles)}｜建築 ${String(st.buildings)}`
          : '',
      );
    }, 500);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="game">
      <h2 style={{ textAlign: 'center' }}>3D 場景展示（離線）</h2>
      {scene}
      <p className="muted" style={{ textAlign: 'center' }}>
        {stats}
      </p>
      <SettingsPanel
        prefs={prefs}
        onChange={(patch) => {
          const next = { ...prefs, ...patch };
          savePrefs(next);
          setPrefs(next);
        }}
        canGL
        reduced={prefersReducedMotion()}
        tier={null}
      />
      <div className="row" style={{ justifyContent: 'center' }}>
        {actions.map(([label, run]) => (
          <button key={label} onClick={run}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
