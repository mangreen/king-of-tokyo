import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CardDef } from '@kot/rules';
import type { ChatEntry } from '../state.js';
import { DanmakuLayer } from './DanmakuLayer.js';
import { cardLookup } from './cardFx.js';
import { latestVersion, takeNew, type FeedBatch } from './feed.js';
import { prefersReducedMotion, savePrefs, watchReducedMotion, type ScenePrefs } from './prefs.js';
import { followClick, followTitle, followUi } from './followState.js';
import { SceneRenderer, type SceneSnapshot } from './SceneRenderer.js';
import type { QualityTier } from './quality.js';

const EMPTY_CHAT: readonly ChatEntry[] = [];

interface Props {
  snapshot: SceneSnapshot;
  feed: readonly FeedBatch[];
  prefs: ScenePrefs;
  onPrefs: (prefs: ScenePrefs) => void;
  /** 城市外觀種子（房間代碼）。 */
  seed: number;
  /** 疊在場景上的遊戲 HUD（玩家、骰子、商店、事件、規則…）。 */
  hud?: ReactNode;
  /** 讓 demo／測試拿到渲染器。 */
  onReady?: (renderer: SceneRenderer | null) => void;
  /** 放在場景左上角的按鈕（離開對局／返回大廳）；3D 開著時不必捲到頁面底部。 */
  corner?: ReactNode;
  /** 卡牌資料：卡面與特效主題用（還沒載入時為 null，先演通用特效）。 */
  cards?: readonly CardDef[] | null;
  /** 自動畫質目前降到哪一級（設定面板顯示用）。 */
  onTier?: (tier: QualityTier | null) => void;
  /** 聊天訊息與彈幕預覽（設定面板的按鈕）；彈幕只在 3D 開著時顯示。 */
  chat?: readonly ChatEntry[];
  danmakuProbe?: number;
  /** 預覽彈幕用的顏色（自己的座位色）。 */
  selfColor?: string;
  /** 勝負已分時的結果文字（全螢幕看不到頁面上的橫幅，所以場景裡也要有）。 */
  outcome?: string | null;
}

/**
 * 3D 場景（Three.js）。動態載入，所以不會拖慢大廳；遊戲邏輯與操作仍在 DOM 裡，
 * 場景只是把伺服器事件「演出來」。場景壞掉或沒有 WebGL 時整個遊戲仍可玩。
 */
export default function Scene3D({
  snapshot,
  feed,
  prefs,
  onPrefs,
  seed,
  hud,
  onReady,
  corner,
  cards,
  onTier,
  chat,
  danmakuProbe,
  selfColor,
  outcome,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [customView, setCustomView] = useState(false);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const lookup = useMemo(
    () => (cards === undefined || cards === null ? undefined : cardLookup(cards)),
    [cards],
  );
  const lookupRef = useRef(lookup);
  const snapshotRef = useRef(snapshot);
  const feedRef = useRef(feed);
  const lastPlayed = useRef<number | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [tier, setTier] = useState<QualityTier | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  // 系統要求減少動態時一律不做鏡頭運動／震動／停頓（即使偏好勾選了）
  const motion = prefs.cameraMotion && !reduced;
  const follow = prefs.follow && motion;
  // 手動拖曳／縮放後自動鏡頭暫停：UI 要反映「實際」狀態
  const followState = followUi(prefs.follow, motion, customView);

  useEffect(() => watchReducedMotion(setReduced), []);
  useEffect(() => {
    onTier?.(tier);
  }, [tier, onTier]);

  // 重建渲染器時要讀「最新的」快照與事件，所以放在 ref 裡（在 effect 中更新，不在 render 中）
  useEffect(() => {
    snapshotRef.current = snapshot;
    feedRef.current = feed;
  });

  // 建立／重建渲染器（畫質設定或種子改變、或從錯誤重試時）
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    let renderer: SceneRenderer;
    try {
      renderer = new SceneRenderer({
        canvas,
        overlay,
        quality: prefs.quality,
        cameraMotion: motion,
        follow,
        attackFx: prefs.attackFx,
        cardFx: prefs.cardFx,
        cards: lookupRef.current,
        seed,
        onTierChange: setTier,
        onFatal: (reason) => {
          setFatal(reason);
        },
        onViewChange: setCustomView,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'init-failed';
      const id = window.setTimeout(() => {
        setFatal(reason);
      }, 0);
      return () => {
        window.clearTimeout(id);
      };
    }
    rendererRef.current = renderer;
    // 重新建立後不重播歷史，只套用目前狀態
    lastPlayed.current = latestVersion(feedRef.current);
    renderer.setSnapshot(snapshotRef.current);
    onReady?.(renderer);
    return () => {
      onReady?.(null);
      rendererRef.current = null;
      renderer.dispose();
    };
    // motion 由下方 effect 即時更新，不需要重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.quality, seed, attempt]);

  useEffect(() => {
    rendererRef.current?.setCameraMotion(motion);
  }, [motion]);

  useEffect(() => {
    rendererRef.current?.setFollow(follow);
  }, [follow]);

  useEffect(() => {
    rendererRef.current?.setAttackFx(prefs.attackFx);
  }, [prefs.attackFx]);

  useEffect(() => {
    rendererRef.current?.setCardFx(prefs.cardFx);
  }, [prefs.cardFx]);

  // 卡牌組通常在場景之後才到：到了就更新卡面與特效主題
  useEffect(() => {
    lookupRef.current = lookup;
    rendererRef.current?.setCards(lookup);
  }, [lookup]);

  // 先登記新事件（play 會加上 hold），再套用快照：這樣快照裡「結算後」的狀態
  // 會被 hold 擋住，等對應的演出播到才更新畫面。
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    const start = lastPlayed.current ?? latestVersion(feed);
    const { batches, lastPlayed: next } = takeNew(feed, start);
    lastPlayed.current = next;
    for (const b of batches) r.play(b.events);
    r.setSnapshot(snapshot);
  }, [snapshot, feed]);

  useEffect(() => {
    const onChange = (): void => {
      setFullscreen(document.fullscreenElement === wrapRef.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = (): void => {
    const el = wrapRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void el.requestFullscreen();
    } catch {
      // 不支援就算了
    }
  };

  // 「跳過動畫」按鈕只在有演出時顯示
  useEffect(() => {
    const id = window.setInterval(() => {
      setBusy(rendererRef.current?.busy ?? false);
    }, 250);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  const update = (patch: Partial<ScenePrefs>): void => {
    const next = { ...prefs, ...patch };
    savePrefs(next);
    onPrefs(next);
  };

  const toggleFollow = (): void => {
    const c = followClick(prefs.follow, customView);
    if (c.resetView) rendererRef.current?.resetView();
    if (c.pref !== prefs.follow) update({ follow: c.pref });
  };

  return (
    <section className="scene" aria-label="3D 戰場與遊戲操作">
      <div
        className={`scene-wrap${hud ? ' has-hud' : ''}${fullscreen ? ' is-fullscreen' : ''}`}
        ref={wrapRef}
      >
        <div className="scene-view">
          <canvas
            key={`${String(attempt)}-${prefs.quality}-${String(seed)}`}
            ref={canvasRef}
            className="scene-canvas"
            tabIndex={0}
            aria-label="3D 地圖。拖曳移動，滾輪或雙指縮放，方向鍵移動、加減號縮放、0 重置"
          />
          <div ref={overlayRef} className="kot-overlay" aria-hidden="true" />
          {fullscreen && (outcome ?? '') !== '' && (
            <div className="scene-winner" role="status">
              <span className="scene-winner-crown" aria-hidden="true">
                👑
              </span>
              {outcome}
            </div>
          )}
          {fatal !== null && (
            <div className="scene-fallback" role="alert">
              <p>3D 場景無法顯示（{fatal}）。不影響遊戲，操作與資訊仍可正常使用。</p>
              <button
                onClick={() => {
                  setFatal(null);
                  setAttempt((n) => n + 1);
                }}
              >
                重試
              </button>
            </div>
          )}
          <DanmakuLayer
            enabled={prefs.danmaku}
            opacity={prefs.danmakuOpacity}
            size={prefs.danmakuSize}
            speed={prefs.danmakuSpeed}
            chat={chat ?? EMPTY_CHAT}
            probe={danmakuProbe ?? 0}
            probeColor={selfColor ?? '#ffffff'}
          />
          {corner && <div className="scene-corner">{corner}</div>}
          <div className="map-controls" role="group" aria-label="地圖視角">
            <button
              aria-label="放大"
              onClick={() => {
                rendererRef.current?.zoomBy(1.35);
              }}
            >
              ＋
            </button>
            <button
              aria-label="縮小"
              onClick={() => {
                rendererRef.current?.zoomBy(1 / 1.35);
              }}
            >
              －
            </button>
            <button
              aria-label="鏡頭跟隨行動中的怪獸"
              title={followTitle(followState)}
              aria-pressed={followState.active}
              disabled={!motion}
              className={`follow-btn ${followState.active ? 'on' : followState.paused ? 'paused' : 'off'}`}
              onClick={() => {
                toggleFollow();
              }}
            >
              🎥
            </button>
            {customView && (
              <button
                className="reset"
                aria-label="重置視角並恢復自動鏡頭"
                onClick={() => {
                  rendererRef.current?.resetView();
                }}
              >
                ↺
              </button>
            )}
          </div>
          <div className="scene-actions" role="group" aria-label="3D 場景">
            {typeof document !== 'undefined' && document.fullscreenEnabled && (
              <button
                className="wide"
                aria-label={fullscreen ? '離開全螢幕' : '全螢幕'}
                onClick={toggleFullscreen}
              >
                {fullscreen ? '離開全螢幕' : '全螢幕'}
              </button>
            )}
            <button
              className="wide"
              aria-label="關閉 3D"
              onClick={() => {
                update({ enabled: false });
              }}
            >
              關閉 3D
            </button>
          </div>
          <p className="map-hint" aria-hidden="true">
            拖曳移動 · 滾輪／雙指縮放
          </p>
          {busy && (
            <button
              className="scene-skip"
              onClick={() => {
                rendererRef.current?.skip();
              }}
            >
              跳過動畫 ⏭
            </button>
          )}
        </div>
        {hud}
      </div>
    </section>
  );
}
