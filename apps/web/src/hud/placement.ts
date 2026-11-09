/** 彈出說明的定位：盡量放在觸發元素下方；放不下就翻到上方；最後夾進視窗內。純函式，方便測試。 */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  side: 'below' | 'above';
}

export function placePopover(
  anchor: Box,
  pop: { width: number; height: number },
  view: { width: number; height: number },
  gap = 8,
  margin = 8,
): Placement {
  const room = {
    below: view.height - (anchor.top + anchor.height) - gap - margin,
    above: anchor.top - gap - margin,
  };
  // 下方放得下就放下方；否則取空間較大的一側
  const side: 'below' | 'above' =
    room.below >= pop.height || room.below >= room.above ? 'below' : 'above';
  const rawTop =
    side === 'below' ? anchor.top + anchor.height + gap : anchor.top - gap - pop.height;
  const top = clamp(rawTop, margin, Math.max(margin, view.height - pop.height - margin));
  const center = anchor.left + anchor.width / 2 - pop.width / 2;
  const left = clamp(center, margin, Math.max(margin, view.width - pop.width - margin));
  return { left, top, side };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
