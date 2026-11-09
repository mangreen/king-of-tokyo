import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { placePopover, type Placement } from './placement.js';

const LONG_PRESS_MS = 450;

interface Props {
  /** 彈出的說明內容。 */
  content: ReactNode;
  /** 無障礙名稱（讀屏會唸「{label}，說明」）。 */
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * 通用的「說明提示」，所有裝置都能開關：
 * - 滑鼠：移上去顯示、移開隱藏；點一下可以固定（再點取消）。
 * - 觸控：點一下開／關，或長按開啟；點別處關閉。
 * - 鍵盤：Tab 聚焦即顯示，Enter／空白鍵固定，Esc 關閉。
 * 彈出框掛在 document.body（fixed 定位），所以不會被 3D 區的 overflow 裁掉。
 */
export function Tip({ content, label, className, children }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [place, setPlace] = useState<Placement | null>(null);
  const press = useRef<{ timer: number | null; fired: boolean }>({ timer: null, fired: false });
  const open = hover || focus || pinned;

  const reposition = useCallback(() => {
    const t = trigger.current;
    const p = pop.current;
    if (!t || !p) return;
    const a = t.getBoundingClientRect();
    const b = p.getBoundingClientRect();
    setPlace(
      placePopover(
        { left: a.left, top: a.top, width: a.width, height: a.height },
        { width: b.width, height: b.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, content, reposition]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: PointerEvent): void => {
      if (trigger.current?.contains(e.target as Node)) return;
      setPinned(false);
      setHover(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setPinned(false);
        setHover(false);
        setFocus(false);
      }
    };
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    const p = press.current;
    return () => {
      if (p.timer !== null) window.clearTimeout(p.timer);
    };
  }, []);

  const clearPress = (): void => {
    if (press.current.timer !== null) window.clearTimeout(press.current.timer);
    press.current.timer = null;
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`tip-trigger${className ? ` ${className}` : ''}`}
        aria-label={`${label}，說明`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'touch') setHover(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'touch') setHover(false);
          clearPress();
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== 'touch') return;
          press.current.fired = false;
          clearPress();
          press.current.timer = window.setTimeout(() => {
            press.current.fired = true;
            setPinned(true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onContextMenu={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          // 長按已經開啟時，放開手指產生的 click 不再切換（否則會立刻關掉）
          if (press.current.fired) {
            press.current.fired = false;
            return;
          }
          setPinned((v) => !v);
        }}
        onFocus={(e) => {
          try {
            if (e.currentTarget.matches(':focus-visible')) setFocus(true);
          } catch {
            // 舊瀏覽器不支援 :focus-visible：只靠點擊與 Enter 切換
          }
        }}
        onBlur={() => {
          setFocus(false);
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            id={id}
            role="tooltip"
            className="tip-pop"
            style={{
              left: place?.left ?? 0,
              top: place?.top ?? 0,
              visibility: place ? 'visible' : 'hidden',
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
