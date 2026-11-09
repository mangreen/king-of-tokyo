import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { CELL } from './cityPlan.js';

/**
 * 程序化紋理（用 Canvas 2D 現場畫，不需要任何外部圖檔）。
 * 紋理都很小，總量遠低於 ADR-0003 的 64MB 預算。
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeat: boolean): CanvasTexture {
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  tex.generateMipmaps = repeat;
  tex.minFilter = repeat ? LinearMipmapLinearFilter : LinearFilter;
  tex.anisotropy = repeat ? 4 : 1;
  return tex;
}

/** 立面磚：1.2 × 1.2 單位 = 2 層 × 2 欄窗。牆面接近白色，由實例顏色上色。 */
export function makeFacadeTexture(): CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#e9e4da';
  g.fillRect(0, 0, 128, 128);
  // 樓板線
  g.fillStyle = '#c9c2b4';
  g.fillRect(0, 0, 128, 5);
  g.fillRect(0, 64, 128, 4);
  const lit = ['#ffe9a8', '#ffd98a', '#9fc6dc'];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const x = 12 + col * 64;
      const y = 14 + row * 64;
      const on = (row * 2 + col + 1) % 3 === 0;
      g.fillStyle = on ? (lit[(row + col) % lit.length] ?? '#ffe9a8') : '#4f6a82';
      g.fillRect(x, y, 40, 36);
      // 窗櫺與反光
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x, y, 40, 8);
      g.fillStyle = 'rgba(30,40,60,0.55)';
      g.fillRect(x + 19, y, 2, 36);
    }
  }
  return finish(c, true);
}

/** 地面：一個街區週期（5 格）的柏油路＋街廓。對應 cityPlan 的「每 5 格一條街」。 */
export function makeGroundTexture(): { texture: CanvasTexture; period: number } {
  const size = 1024;
  const [c, g] = canvas(size, size);
  const period = CELL * 5; // 世界單位
  const px = size / period;
  const cell = CELL * px;
  g.fillStyle = '#4a4a4f'; // 先整面鋪柏油，再蓋上街廓
  g.fillRect(0, 0, size, size);
  // 街廓：index 0 是街道，1–4 是街廓格（與 cityPlan 的 i % 5 === 0 一致）；
  // 紋理邊緣（0 與 size）是街道中線，所以街廓從 cell/2 開始
  const tones = ['#b9b2a3', '#a9a597', '#c4bca9', '#b0a893', '#9fae8d'];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const x = cell / 2 + i * cell;
      const y = cell / 2 + j * cell;
      const tone = tones[(i * 3 + j * 5 + ((i * j) % 3)) % tones.length] ?? '#b9b2a3';
      g.fillStyle = '#d9d4c4'; // 人行道
      g.fillRect(x + 2, y + 2, cell - 4, cell - 4);
      g.fillStyle = tone;
      g.fillRect(x + 8, y + 8, cell - 16, cell - 16);
    }
  }
  // 路面標線：中線與邊線
  g.lineWidth = 3;
  g.setLineDash([22, 18]);
  g.strokeStyle = '#e8c547';
  g.beginPath();
  g.moveTo(0, 1);
  g.lineTo(size, 1);
  g.moveTo(1, 0);
  g.lineTo(1, size);
  g.moveTo(0, size - 1);
  g.lineTo(size, size - 1);
  g.moveTo(size - 1, 0);
  g.lineTo(size - 1, size);
  g.stroke();
  g.setLineDash([]);
  // 雜訊顆粒讓地面不那麼平
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(${i % 2 === 0 ? '255,255,255' : '0,0,0'},${(0.02 + (i % 7) * 0.006).toFixed(3)})`;
    g.fillRect((i * 97) % size, (i * 53) % size, 2, 2);
  }
  return { texture: finish(c, true), period };
}

/** 東京中央廣場：同心圓與放射線的石板地。 */
export function makePlazaTexture(): CanvasTexture {
  const [c, g] = canvas(256, 256);
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, '#f1e3b8');
  grad.addColorStop(1, '#cdbb8a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(120,90,40,0.55)';
  g.lineWidth = 4;
  for (const r of [38, 78, 118]) {
    g.beginPath();
    g.arc(128, 128, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 38, 128 + Math.sin(a) * 38);
    g.lineTo(128 + Math.cos(a) * 118, 128 + Math.sin(a) * 118);
    g.stroke();
  }
  g.fillStyle = 'rgba(176, 56, 36, 0.78)';
  g.font =
    '900 96px "Noto Sans CJK TC","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('東京', 128, 132);
  return finish(c, false);
}

/** 台場（東京灣）圓形地面：深色圓環與「東京灣」。 */
export function makeIslandTexture(): CanvasTexture {
  const [c, g] = canvas(256, 256);
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, '#c9c2b0');
  grad.addColorStop(1, '#a9a290');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(40, 52, 66, 0.7)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.arc(128, 128, 96, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(38, 56, 76, 0.85)';
  g.font =
    '900 56px "Noto Sans CJK TC","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('東京灣', 128, 132);
  return finish(c, false);
}

/** 皇居：護城河圍著的綠地與石牆。 */
export function makePalaceTexture(): CanvasTexture {
  const [c, g] = canvas(256, 192);
  g.fillStyle = '#4f95bd';
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#d9d2bf';
  g.fillRect(14, 14, 228, 164);
  g.fillStyle = '#6fae5a';
  g.fillRect(22, 22, 212, 148);
  g.fillStyle = '#89c46f';
  for (let i = 0; i < 40; i++) g.fillRect(28 + ((i * 37) % 196), 28 + ((i * 53) % 130), 18, 12);
  g.strokeStyle = '#e8dfc4';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(40, 150);
  g.quadraticCurveTo(128, 60, 220, 120);
  g.stroke();
  return finish(c, false);
}

/** 水面：柔和的條紋波光，會以 UV 位移做出流動感。 */
export function makeWaterTexture(): CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#2f7fa8';
  g.fillRect(0, 0, 256, 256);
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = (i * 83) % 256;
    const y = (i * 151) % 256;
    g.strokeStyle = `rgba(210,240,255,${(0.1 + (i % 5) * 0.05).toFixed(2)})`;
    g.lineWidth = 2 + (i % 3);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + 12, y - 4, x + 26, y);
    g.stroke();
  }
  return finish(c, true);
}

/** 天空漸層（暖色地平線 → 藍天），當作 scene.background。 */
export function makeSkyTexture(): CanvasTexture {
  const [c, g] = canvas(8, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5aa3e0');
  grad.addColorStop(0.55, '#a9d1ee');
  grad.addColorStop(0.85, '#f3dcb2');
  grad.addColorStop(1, '#f1c98f');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  return finish(c, false);
}

/** 柔邊圓點（煙塵粒子、假陰影）。 */
export function makeSoftDotTexture(): CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return finish(c, false);
}

/** 地面裂痕貼花。 */
export function makeCrackTexture(): CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.strokeStyle = 'rgba(20,16,12,0.9)';
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + (i % 2) * 0.2;
    let x = 64;
    let y = 64;
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += Math.cos(a + (s % 2 === 0 ? 0.35 : -0.35)) * 14;
      y += Math.sin(a + (s % 2 === 0 ? 0.35 : -0.35)) * 14;
      g.lineTo(x, y);
      g.lineWidth = Math.max(1, 3.5 - s);
    }
    g.stroke();
  }
  return finish(c, false);
}
