import { useEffect, useRef } from 'react';
import type { ChatEntry } from '../state.js';
import { estimateWidth, LanePlanner, layoutFor } from './danmaku.js';
import { seatColor } from './layout.js';

interface Props {
  enabled: boolean;
  opacity: number;
  size: number;
  /** 聊天訊息（id 遞增）。只播放「掛載之後新到的」，換頁或重開 3D 不會重播歷史。 */
  chat: readonly ChatEntry[];
  /** 設定面板的「預覽」按鈕每按一次加一：飛過一則範例彈幕。 */
  probe: number;
  /** 範例彈幕用的顏色（自己的座位色）。 */
  probeColor: string;
}

const PROBE_TEXT = '這是彈幕預覽 💬';

/**
 * 3D 場景上的聊天彈幕：從右上進、向左飛出，文字是發話玩家的顏色（半透明）。
 * 直接操作 DOM（不經過 React 狀態），因為它只是一層會自己消失的動畫；
 * 軌道安排見 danmaku.ts（同一軌道等速、不重疊）。
 */
export function Danmaku({ enabled, opacity, size, chat, probe, probeColor }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const planner = useRef<{ key: string; planner: LanePlanner } | null>(null);
  const seen = useRef<number>(chat.at(-1)?.id ?? 0);
  const lastProbe = useRef(probe);
  const latest = useRef({ size, probeColor });
  useEffect(() => {
    latest.current = { size, probeColor };
  });

  // 透明度即時生效（飛行中的也會變）
  useEffect(() => {
    layerRef.current?.style.setProperty('--dm-opacity', String(opacity));
  }, [opacity]);

  // 關閉時立刻清掉畫面上的彈幕
  useEffect(() => {
    if (!enabled) layerRef.current?.replaceChildren();
  }, [enabled]);

  useEffect(() => {
    const layer = layerRef.current;
    const fresh = chat.filter((m) => m.id > seen.current);
    const newest = chat.at(-1)?.id;
    if (newest !== undefined) seen.current = Math.max(seen.current, newest);
    const probed = probe !== lastProbe.current;
    lastProbe.current = probe;
    if (!layer || !enabled) return;

    const launch = (text: string, color: string): void => {
      const fontSize = latest.current.size;
      const width = layer.clientWidth;
      const height = layer.clientHeight;
      if (width === 0 || height === 0) return;
      const layout = layoutFor(width, height, fontSize);
      const key = `${String(layout.lanes)}:${String(fontSize)}:${String(Math.round(layout.speed * 1000))}`;
      if (planner.current?.key !== key)
        planner.current = { key, planner: new LanePlanner(layout.lanes) };
      const textWidth = estimateWidth(text, fontSize);
      const now = performance.now();
      const placed = planner.current.planner.place(now, textWidth, layout.speed);
      if (!placed) return;
      const el = document.createElement('span');
      el.className = 'danmaku-item';
      el.textContent = text;
      el.style.top = `${String(layout.top + placed.lane * layout.laneHeight)}px`;
      el.style.fontSize = `${String(fontSize)}px`;
      el.style.color = color;
      el.style.setProperty('--dm-from', `${String(width)}px`);
      el.style.setProperty('--dm-to', `${String(-textWidth - 40)}px`);
      el.style.animationDuration = `${String(Math.round((width + textWidth + 40) / layout.speed))}ms`;
      el.style.animationDelay = `${String(Math.round(placed.startAt - now))}ms`;
      el.addEventListener('animationend', () => {
        el.remove();
      });
      layer.append(el);
    };

    for (const m of fresh) launch(m.text, m.seat === null ? '#ffffff' : seatColor(m.seat));
    if (probed) launch(PROBE_TEXT, latest.current.probeColor);
  }, [chat, probe, enabled]);

  return <div ref={layerRef} className="danmaku-layer" aria-hidden="true" data-testid="danmaku" />;
}
