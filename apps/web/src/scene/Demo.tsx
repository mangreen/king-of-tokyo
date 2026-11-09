import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent } from '@kot/rules';
import { defaultPrefs, prefersReducedMotion, savePrefs, type ScenePrefs } from './prefs.js';
import Scene3D from './Scene3D.js';
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

function initial(players: number): SceneSnapshot {
  return {
    playerCount: players,
    activeSeat: 0,
    mySeat: 0,
    monsters: Array.from({ length: players }, (_, seat) => ({
      seat,
      name: NAMES[seat] ?? `座位 ${String(seat)}`,
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
  const [snap, setSnap] = useState<SceneSnapshot>(() => initial(players));
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
      '重置',
      () => {
        setSnap(initial(players));
        setFeed([]);
        version.current = 1;
      },
    ],
  ];

  const scene = useMemo(
    () => (
      <Scene3D
        snapshot={snap}
        feed={feed}
        prefs={prefs}
        onPrefs={(p) => {
          savePrefs(p);
          setPrefs(p);
        }}
        seed={12345}
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
