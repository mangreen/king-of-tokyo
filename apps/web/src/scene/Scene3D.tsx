import { useEffect, useRef, useState } from 'react';
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
export default function Scene3D({ snapshot, feed, prefs, onPrefs, seed, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
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
        seed,
        onTierChange: setTier,
        onFatal: (reason) => {
          setFatal(reason);
        },
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
    <section className="scene" aria-label="3D 戰場（輔助視覺，遊戲操作在下方）">
      <div className="scene-wrap">
        <canvas
          key={`${String(attempt)}-${prefs.quality}-${String(seed)}`}
          ref={canvasRef}
          className="scene-canvas"
        />
        <div ref={overlayRef} className="kot-overlay" aria-hidden="true" />
        {fatal !== null && (
          <div className="scene-fallback" role="alert">
            <p>3D 場景無法顯示（{fatal}）。不影響遊戲，下方仍可正常操作。</p>
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
