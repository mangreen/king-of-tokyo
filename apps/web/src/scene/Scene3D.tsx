import { useEffect, useRef, useState, type ReactNode } from 'react';
import { latestVersion, takeNew, type FeedBatch } from './feed.js';
import { prefersReducedMotion, savePrefs, watchReducedMotion, type ScenePrefs } from './prefs.js';
import { SceneRenderer, type SceneSnapshot } from './SceneRenderer.js';
import type { QualitySetting, QualityTier } from './quality.js';

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
}

const QUALITY_LABEL: Record<QualitySetting, string> = {
  auto: '自動',
  high: '高',
  medium: '中',
  low: '低',
};

/**
 * 3D 場景（Three.js）。動態載入，所以不會拖慢大廳；遊戲邏輯與操作仍在 DOM 裡，
 * 場景只是把伺服器事件「演出來」。場景壞掉或沒有 WebGL 時整個遊戲仍可玩。
 */
export default function Scene3D({ snapshot, feed, prefs, onPrefs, seed, hud, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [customView, setCustomView] = useState(false);
  const rendererRef = useRef<SceneRenderer | null>(null);
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

  useEffect(() => watchReducedMotion(setReduced), []);

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
              title={follow ? '鏡頭跟隨：開' : '鏡頭跟隨：關'}
              aria-pressed={follow}
              disabled={!motion}
              className={`follow-btn ${follow ? 'on' : 'off'}`}
              onClick={() => {
                update({ follow: !prefs.follow });
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
      <div className="scene-controls">
        <label>
          畫質{' '}
          <select
            value={prefs.quality}
            onChange={(e) => {
              update({ quality: e.target.value as QualitySetting });
            }}
          >
            {(Object.keys(QUALITY_LABEL) as QualitySetting[]).map((q) => (
              <option key={q} value={q}>
                {QUALITY_LABEL[q]}
              </option>
            ))}
          </select>
          {prefs.quality === 'auto' && tier !== null && (
            <span className="muted">（已降為{QUALITY_LABEL[tier]}）</span>
          )}
        </label>
        <label>
          <input
            type="checkbox"
            checked={motion}
            disabled={reduced}
            onChange={(e) => {
              update({ cameraMotion: e.target.checked });
            }}
          />{' '}
          鏡頭動態與震動{reduced ? '（系統已要求減少動態）' : ''}
        </label>
        <label>
          <input
            type="checkbox"
            checked={follow}
            disabled={!motion}
            onChange={(e) => {
              update({ follow: e.target.checked });
            }}
          />{' '}
          鏡頭跟隨行動中的怪獸
        </label>
        <label>
          <input
            type="checkbox"
            checked={prefs.attackFx}
            onChange={(e) => {
              update({ attackFx: e.target.checked });
            }}
          />{' '}
          怪獸招式特效（吐息、雷射、噴火…）
        </label>
        {typeof document !== 'undefined' && document.fullscreenEnabled && (
          <button className="link" onClick={toggleFullscreen}>
            {fullscreen ? '離開全螢幕' : '全螢幕'}
          </button>
        )}
        <button
          className="link"
          onClick={() => {
            update({ enabled: false });
          }}
        >
          關閉 3D
        </button>
      </div>
    </section>
  );
}
