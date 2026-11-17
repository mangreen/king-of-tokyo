import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToastRoot } from './Toasts.js';
import type { Hint, Slide } from './tutorial.js';

interface Props {
  introOpen: boolean;
  /** 現在是我的回合（回合計時仍在走）。 */
  timerRunning?: boolean;
  slides: readonly Slide[];
  /** 看完或跳過；disable＝連之後的教學提示一起關掉。 */
  onFinishIntro: (disable: boolean) => void;
  hint: Hint | null;
  onDismissHint: () => void;
  onDisable: () => void;
}

function Intro({
  slides,
  timerRunning,
  onFinish,
}: {
  slides: readonly Slide[];
  timerRunning: boolean;
  onFinish: (disable: boolean) => void;
}) {
  const [i, setI] = useState(0);
  const [never, setNever] = useState(false);
  const next = useRef<HTMLButtonElement>(null);
  const slide = slides[i];
  const last = i === slides.length - 1;

  useEffect(() => {
    next.current?.focus();
  }, [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onFinish(never);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onFinish, never]);

  if (!slide) return null;
  return (
    <div className="tutorial-backdrop">
      <div className="tutorial-card" role="dialog" aria-modal="true" aria-label="快速規則">
        <div className="tutorial-head">
          <span className="tutorial-icon" aria-hidden="true">
            {slide.icon}
          </span>
          <h2>{slide.title}</h2>
          <span className="tutorial-step">
            {i + 1} / {slides.length}
          </span>
        </div>
        {timerRunning && (
          <p className="tutorial-warn" role="note">
            ⏱ 輪到你了，回合倒數仍在進行。想先玩可以按「跳過」，之後在「⚙ 設定」重看。
          </p>
        )}
        <ul>
          {slide.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <div className="tutorial-dots" aria-hidden="true">
          {slides.map((s, k) => (
            <span key={s.title} className={k === i ? 'on' : ''} />
          ))}
        </div>
        <label className="tutorial-never">
          <input
            type="checkbox"
            checked={never}
            onChange={(e) => {
              setNever(e.target.checked);
            }}
          />{' '}
          之後不再顯示新手教學
        </label>
        <div className="tutorial-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => {
              onFinish(never);
            }}
          >
            跳過
          </button>
          <span className="tutorial-spacer" />
          {i > 0 && (
            <button
              type="button"
              onClick={() => {
                setI(i - 1);
              }}
            >
              上一步
            </button>
          )}
          <button
            type="button"
            ref={next}
            className="primary"
            onClick={() => {
              if (last) onFinish(never);
              else setI(i + 1);
            }}
          >
            {last ? '開始遊戲' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 新手教學的畫面：快速規則（置中的對話框）與情境提示（頂端的小卡）。
 * 掛在 body；全螢幕時掛進全螢幕元素，否則全螢幕下看不到。
 */
export function TutorialLayer({
  introOpen,
  timerRunning = false,
  slides,
  onFinishIntro,
  hint,
  onDismissHint,
  onDisable,
}: Props) {
  const root = useToastRoot();
  if (!root || (!introOpen && !hint)) return null;
  return createPortal(
    <>
      {introOpen && <Intro slides={slides} timerRunning={timerRunning} onFinish={onFinishIntro} />}
      {!introOpen && hint && (
        <aside className="tutorial-hint" role="status" aria-live="polite">
          <span className="tutorial-icon" aria-hidden="true">
            {hint.icon}
          </span>
          <div className="tutorial-hint-body">
            <b>{hint.title}</b>
            <p>{hint.text}</p>
            <div className="tutorial-actions">
              <button type="button" className="primary" onClick={onDismissHint}>
                知道了
              </button>
              <button type="button" className="ghost" onClick={onDisable}>
                不再顯示教學
              </button>
            </div>
          </div>
        </aside>
      )}
    </>,
    root,
  );
}
