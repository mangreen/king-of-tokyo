import {
  AdditiveBlending,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Camera,
  type Group,
  type Material,
} from 'three';
import type { CardDef } from '@kot/rules';
import { THEME_STYLE, themeOf, type CardTheme } from './cardFx.js';
import type { DebrisSystem, DustSystem, ShieldSystem, ShockwaveSystem } from './effects.js';
import { CITY_SPOT } from './layout.js';

/** 3D 卡牌的尺寸（世界單位）。 */
export const CARD_W = 2.5;
export const CARD_H = 3.5;

const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei","Heiti TC",system-ui,sans-serif';

/** 把文字依寬度折行（中日韓文字逐字折，英文單字也逐字處理，簡單但夠用）。 */
export function wrapText(
  measure: (s: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    if (measure(line + ch) > maxWidth && line !== '') {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines && line !== '') lines.push(line);
  if (lines.length === maxLines && text.length > lines.join('').length) {
    const last = lines[maxLines - 1] ?? '';
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`;
  }
  return lines;
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 畫一張卡面：名字、費用、類型、效果文字，邊框與插圖顏色依特效主題。 */
export function drawCardFace(
  canvas: HTMLCanvasElement,
  id: string,
  def: CardDef | undefined,
  theme: CardTheme,
): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const W = canvas.width;
  const H = canvas.height;
  const style = THEME_STYLE[theme];
  g.clearRect(0, 0, W, H);
  // 外框
  roundRect(g, 4, 4, W - 8, H - 8, 26);
  g.fillStyle = '#1d1b16';
  g.fill();
  roundRect(g, 12, 12, W - 24, H - 24, 20);
  g.fillStyle = '#fff8e6';
  g.fill();
  // 標題帶
  g.save();
  roundRect(g, 12, 12, W - 24, 64, 20);
  g.clip();
  g.fillStyle = style.color;
  g.fillRect(12, 12, W - 24, 64);
  g.restore();
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(12, 70, W - 24, 6);
  // 費用
  g.beginPath();
  g.arc(48, 44, 24, 0, Math.PI * 2);
  g.fillStyle = '#1d1b16';
  g.fill();
  g.fillStyle = '#ffd23f';
  g.font = `900 26px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(def ? String(def.cost) : '?', 48, 46);
  // 名字（太長就縮小）
  const name = def?.name ?? id;
  let size = 30;
  g.font = `900 ${String(size)}px ${FONT}`;
  while (g.measureText(name).width > W - 120 && size > 16) {
    size -= 2;
    g.font = `900 ${String(size)}px ${FONT}`;
  }
  g.fillStyle = '#1d1b16';
  g.textAlign = 'left';
  g.fillText(name, 86, 46);
  // 插圖區
  g.fillStyle = `${style.color}33`;
  roundRect(g, 28, 92, W - 56, 150, 14);
  g.fill();
  g.strokeStyle = style.color;
  g.lineWidth = 3;
  g.stroke();
  g.font = `96px ${FONT}`;
  g.textAlign = 'center';
  g.fillStyle = '#000';
  g.fillText(style.icon, W / 2, 168);
  // 類型
  g.font = `800 20px ${FONT}`;
  g.fillStyle = def?.kind === 'keep' ? '#2b7a4b' : '#b3361f';
  g.fillText(def?.kind === 'keep' ? '持續' : def?.kind === 'discard' ? '即時' : '', W / 2, 262);
  // 效果文字
  g.font = `600 21px ${FONT}`;
  g.fillStyle = '#2b2820';
  g.textAlign = 'left';
  const lines = wrapText((s) => g.measureText(s).width, def?.text ?? '', W - 60, 5);
  lines.forEach((l, i) => {
    g.fillText(l, 30, 296 + i * 28);
  });
}

/** 卡面貼圖快取（每張牌只畫一次）。 */
export class CardFaces {
  private readonly cache = new Map<string, CanvasTexture>();

  constructor(private lookup: (id: string) => CardDef | undefined = () => undefined) {}

  setLookup(lookup: (id: string) => CardDef | undefined): void {
    this.lookup = lookup;
    // 卡牌組晚於場景載入時，之前畫的「只有 id」的牌要重畫
    this.dispose();
  }

  texture(id: string): CanvasTexture {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 358;
    const def = this.lookup(id);
    drawCardFace(c, id, def, themeOf(def));
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    this.cache.set(id, tex);
    return tex;
  }

  dispose(): void {
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
  }
}

const cardGeometry = new PlaneGeometry(CARD_W, CARD_H);

/** 一張面向鏡頭的 3D 卡牌（不吃光照，永遠清楚）。 */
export function makeCardMesh(tex: CanvasTexture): Mesh {
  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const mesh = new Mesh(cardGeometry, mat);
  mesh.renderOrder = 8;
  return mesh;
}

export function disposeCardMesh(mesh: Mesh): void {
  (mesh.material as Material).dispose();
}

// ── 卡牌使用特效 ───────────────────────────────────

interface Falling {
  mesh: Mesh;
  from: Vector3;
  to: Vector3;
  t: number;
  dur: number;
  delay: number;
  onLand: (() => void) | null;
  active: boolean;
}

interface Column {
  mesh: Mesh;
  t: number;
  dur: number;
  delay: number;
  active: boolean;
  peak: number;
}

interface Pop {
  mesh: Mesh;
  t: number;
  dur: number;
  x: number;
  y: number;
  z: number;
  big: boolean;
  active: boolean;
}

export interface Spot2 {
  x: number;
  z: number;
}

export interface CardFxDeps {
  dust: DustSystem;
  debris: DebrisSystem;
  waves: ShockwaveSystem;
  shields: ShieldSystem;
  faces: CardFaces;
  /** 目前畫質對粒子數的倍率（0–1）。 */
  scale: () => number;
  shake: (amount: number) => void;
}

const STAR_COLORS = ['#ffd23f', '#fff3a8', '#ffb347'] as const;
const DICE_COLORS = ['#ffffff', '#f2e9d0', '#d9d2c3'] as const;
const UP = new Vector3(0, 1, 0);

/**
 * 卡牌使用特效：依卡牌內容（主題）演出——流星雨、酸雨、閃電、治療光柱…
 * 全部是純視覺：傷害／回復的數字與血量仍由事件決定。粒子與碎片重用場景既有的系統（受畫質上限控制），
 * 這裡只額外有少量墜落物、光柱與卡牌圖。
 */
export class CardFxSystem {
  private readonly falls: Falling[] = [];
  private readonly columns: Column[] = [];
  private readonly pops: Pop[] = [];
  private readonly tailGeo = new ConeGeometry(0.5, 4, 10);
  private readonly columnGeo = new CylinderGeometry(1, 1, 1, 14, 1, true);
  private readonly dir = new Vector3();
  private readonly q = new Quaternion();
  private readonly side = new Vector3();
  private enabled = true;

  constructor(
    private readonly parent: Group,
    private readonly deps: CardFxDeps,
  ) {
    this.tailGeo.translate(0, -1.4, 0);
    this.columnGeo.translate(0, 0.5, 0);
    const additive = (color: string): MeshBasicMaterial =>
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
    for (let i = 0; i < 14; i++) {
      const mesh = new Mesh(this.tailGeo, additive('#ff7a2f'));
      mesh.visible = false;
      mesh.renderOrder = 6;
      parent.add(mesh);
      this.falls.push({
        mesh,
        from: new Vector3(),
        to: new Vector3(),
        t: 0,
        dur: 1,
        delay: 0,
        onLand: null,
        active: false,
      });
    }
    for (let i = 0; i < 6; i++) {
      const mesh = new Mesh(this.columnGeo, additive('#ffe14d'));
      mesh.visible = false;
      mesh.renderOrder = 6;
      parent.add(mesh);
      this.columns.push({ mesh, t: 0, dur: 1, delay: 0, active: false, peak: 0.8 });
    }
    for (let i = 0; i < 3; i++) {
      const mesh = new Mesh(cardGeometry, new MeshBasicMaterial({ transparent: true }));
      mesh.visible = false;
      mesh.renderOrder = 9;
      parent.add(mesh);
      this.pops.push({ mesh, t: 0, dur: 1, x: 0, y: 0, z: 0, big: false, active: false });
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.clear();
  }

  clear(): void {
    for (const f of this.falls) {
      f.active = false;
      f.mesh.visible = false;
      f.onLand = null;
    }
    for (const c of this.columns) {
      c.active = false;
      c.mesh.visible = false;
    }
    for (const p of this.pops) {
      p.active = false;
      p.mesh.visible = false;
    }
  }

  private fall(
    from: Vector3,
    to: Vector3,
    color: string,
    dur: number,
    delay: number,
    onLand: () => void,
  ): void {
    const f = this.falls.find((x) => !x.active);
    if (!f) {
      onLand();
      return;
    }
    f.from.copy(from);
    f.to.copy(to);
    f.t = 0;
    f.dur = dur;
    f.delay = delay;
    f.onLand = onLand;
    f.active = true;
    (f.mesh.material as MeshBasicMaterial).color.set(color);
  }

  private column(
    x: number,
    z: number,
    radius: number,
    height: number,
    color: string,
    dur: number,
    delay = 0,
    peak = 0.8,
  ): void {
    const c = this.columns.find((k) => !k.active);
    if (!c) return;
    c.mesh.position.set(x, 0, z);
    c.mesh.scale.set(radius, height, radius);
    (c.mesh.material as MeshBasicMaterial).color.set(color);
    c.t = 0;
    c.dur = dur;
    c.delay = delay;
    c.peak = peak;
    c.active = true;
  }

  /** 卡牌飄在怪獸頭上一會兒（使用＝大一點停久一點；收下＝小一點）。 */
  pop(cardId: string, x: number, z: number, height: number, big: boolean): void {
    if (!this.enabled) return;
    const p = this.pops.find((k) => !k.active) ?? this.pops[0];
    if (!p) return;
    const old = p.mesh.material as MeshBasicMaterial;
    old.dispose();
    p.mesh.material = new MeshBasicMaterial({
      map: this.deps.faces.texture(cardId),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      side: DoubleSide,
    });
    p.x = x;
    p.y = height;
    p.z = z;
    p.t = 0;
    p.dur = big ? 1.9 : 1.1;
    p.big = big;
    p.active = true;
  }

  /** 播主題特效。subject＝使用者；others＝其他存活怪獸；all＝所有存活怪獸。 */
  play(theme: CardTheme, subject: Spot2, others: readonly Spot2[], all: readonly Spot2[]): void {
    if (!this.enabled) return;
    const k = this.deps.scale();
    const n = (base: number): number => Math.max(2, Math.round(base * k));
    const { dust, debris, waves, shields, shake } = this.deps;
    const style = THEME_STYLE[theme];
    const sky = (x: number, z: number): Vector3 => new Vector3(x + 9, 28, z - 7);
    const ground = (x: number, z: number): Vector3 => new Vector3(x, 0.4, z);

    switch (theme) {
      case 'meteor':
        all.forEach((s, i) => {
          this.fall(sky(s.x, s.z), ground(s.x, s.z), '#ff7a2f', 0.55, i * 0.14, () => {
            debris.burst(s.x, 0.8, s.z, n(10), 6, ['#b8b2a5', '#ff7a2f', '#ffd23f']);
            dust.emit(s.x, 0.3, s.z, {
              count: n(14),
              spread: 3,
              up: 2,
              size: 2.6,
              color: '#ffb066',
            });
            waves.fire(s.x, s.z, 4.5, '#ff9a4d', 0.5);
            shake(0.4);
          });
        });
        break;
      case 'acid':
        others.forEach((s, i) => {
          for (let d = 0; d < 3; d++) {
            const ox = (d - 1) * 1.1;
            this.fall(
              new Vector3(s.x + ox, 20, s.z),
              ground(s.x + ox, s.z),
              '#8be04e',
              0.5,
              i * 0.1 + d * 0.08,
              () => {
                dust.emit(s.x + ox, 0.3, s.z, {
                  count: n(6),
                  spread: 1.6,
                  up: 1.6,
                  size: 1.5,
                  color: '#8be04e',
                  life: 1,
                });
              },
            );
          }
        });
        break;
      case 'blast':
        waves.fire(subject.x, subject.z, 6, '#ff4d4d', 0.5);
        waves.fire(subject.x, subject.z, 3.5, '#ffd23f', 0.35);
        debris.burst(subject.x, 1.5, subject.z, n(14), 7, ['#ff4d4d', '#ffd23f', '#ff7a2f']);
        dust.emit(subject.x, 1, subject.z, {
          count: n(16),
          spread: 4,
          up: 1.5,
          size: 2.4,
          color: '#ff6a5a',
        });
        shake(0.5);
        break;
      case 'stars':
        debris.burst(subject.x, 3.5, subject.z, n(16), 6, STAR_COLORS);
        dust.emit(subject.x, 2.5, subject.z, {
          count: n(12),
          spread: 1.8,
          up: 3.4,
          size: 1.5,
          color: '#ffd23f',
          life: 1.1,
        });
        this.column(subject.x, subject.z, 1.1, 14, '#ffd23f', 0.9, 0, 0.35);
        break;
      case 'bolt':
        this.column(subject.x, subject.z, 0.35, 28, '#ffe14d', 0.5, 0, 0.95);
        this.column(subject.x + 0.5, subject.z, 0.14, 28, '#ffffff', 0.22, 0.06, 0.95);
        dust.emit(subject.x, 1.2, subject.z, {
          count: n(14),
          spread: 3,
          up: 2,
          size: 1.3,
          color: '#ffe14d',
          life: 0.8,
        });
        waves.fire(subject.x, subject.z, 4.2, '#ffe14d', 0.45);
        break;
      case 'heal':
        this.column(subject.x, subject.z, 1.6, 9, '#4be08b', 1.2, 0, 0.45);
        dust.emit(subject.x, 0.6, subject.z, {
          count: n(18),
          spread: 1.4,
          up: 3.2,
          size: 1.4,
          color: '#4be08b',
          life: 1.3,
          radius: 1.2,
        });
        waves.fire(subject.x, subject.z, 3.5, '#4be08b', 0.7);
        break;
      case 'drain':
        for (const s of others) {
          dust.emit(s.x, 1.8, s.z, {
            count: n(8),
            spread: 0.6,
            up: 1.2,
            size: 1.5,
            color: '#b565e6',
            life: 1.2,
            drift: { x: (subject.x - s.x) * 0.9, z: (subject.z - s.z) * 0.9 },
          });
          waves.fire(s.x, s.z, 2.6, '#b565e6', 0.5);
        }
        waves.fire(subject.x, subject.z, 4, '#b565e6', 0.8);
        break;
      case 'tokyo':
        this.column(CITY_SPOT.x, CITY_SPOT.z, 2.4, 26, '#7de3ff', 0.9, 0, 0.6);
        waves.fire(CITY_SPOT.x, CITY_SPOT.z, 7, '#7de3ff', 0.7);
        dust.emit(CITY_SPOT.x, 0.4, CITY_SPOT.z, { count: n(18), spread: 4.5, up: 1.6, size: 2.6 });
        shake(0.4);
        break;
      case 'extra':
        waves.fire(subject.x, subject.z, 3, '#ffb347', 0.5);
        waves.fire(subject.x, subject.z, 5, '#ffb347', 0.8);
        dust.emit(subject.x, 2, subject.z, {
          count: n(12),
          spread: 2.4,
          up: 1.6,
          size: 1.3,
          color: '#ffb347',
        });
        break;
      case 'shield':
        shields.pop(subject.x, subject.z, 3.4);
        waves.fire(subject.x, subject.z, 3.6, '#7de3ff', 0.5);
        break;
      case 'dice':
        debris.burst(subject.x, 3, subject.z, n(10), 5, DICE_COLORS);
        dust.emit(subject.x, 2, subject.z, {
          count: n(8),
          spread: 1.8,
          up: 2,
          size: 1.2,
          color: '#ffffff',
        });
        break;
      case 'wings':
        dust.emit(subject.x, 1.5, subject.z, {
          count: n(18),
          spread: 2.6,
          up: 3.2,
          size: 1.6,
          color: '#dff3ff',
          life: 1.4,
          radius: 1.4,
        });
        waves.fire(subject.x, subject.z, 3.2, '#dff3ff', 0.6);
        break;
      case 'revive':
        this.column(subject.x, subject.z, 1.5, 22, '#fff3a8', 1.4, 0, 0.7);
        dust.emit(subject.x, 0.5, subject.z, {
          count: n(24),
          spread: 1.6,
          up: 3.6,
          size: 1.5,
          color: '#fff3a8',
          life: 1.5,
          radius: 1.5,
        });
        waves.fire(subject.x, subject.z, 5, '#fff3a8', 0.9);
        break;
      case 'generic':
        dust.emit(subject.x, 2.6, subject.z, {
          count: n(10),
          spread: 2.2,
          up: 2,
          size: 1.2,
          color: style.color,
          life: 0.9,
        });
        break;
    }
  }

  update(dt: number, camera: Camera): void {
    for (const f of this.falls) {
      if (!f.active) continue;
      if (f.delay > 0) {
        f.delay -= dt;
        f.mesh.visible = false;
        continue;
      }
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      f.mesh.visible = true;
      f.mesh.position.lerpVectors(f.from, f.to, k * k);
      this.dir.subVectors(f.to, f.from).normalize();
      f.mesh.quaternion.copy(this.q.setFromUnitVectors(UP, this.dir));
      (f.mesh.material as MeshBasicMaterial).opacity = 0.9;
      f.mesh.scale.setScalar(0.5 + 0.5 * k);
      if (k >= 1) {
        f.active = false;
        f.mesh.visible = false;
        const land = f.onLand;
        f.onLand = null;
        land?.();
      }
    }
    for (const c of this.columns) {
      if (!c.active) continue;
      if (c.delay > 0) {
        c.delay -= dt;
        c.mesh.visible = false;
        continue;
      }
      c.t += dt;
      const k = c.t / c.dur;
      if (k >= 1) {
        c.active = false;
        c.mesh.visible = false;
        continue;
      }
      c.mesh.visible = true;
      const flicker = 0.75 + 0.25 * Math.sin(c.t * 60);
      (c.mesh.material as MeshBasicMaterial).opacity = c.peak * (1 - k) * flicker;
    }
    for (const p of this.pops) {
      if (!p.active) continue;
      p.t += dt;
      const k = p.t / p.dur;
      if (k >= 1) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.mesh.visible = true;
      const inK = Math.min(1, k / 0.18);
      const outK = k > 0.75 ? (k - 0.75) / 0.25 : 0;
      const ease = 1 - (1 - inK) * (1 - inK);
      const base = p.big ? 1.05 : 0.7;
      p.mesh.scale.setScalar(base * (0.3 + 0.7 * ease) * (1 + 0.25 * outK));
      this.side.setFromMatrixColumn(camera.matrixWorld, 0);
      p.mesh.position
        .set(p.x, p.y + 0.9 * ease + 0.8 * outK, p.z)
        .addScaledVector(this.side, p.big ? 3.4 : 2.6);
      p.mesh.quaternion.copy(camera.quaternion);
      (p.mesh.material as MeshBasicMaterial).opacity = 1 - outK;
    }
  }

  dispose(): void {
    this.tailGeo.dispose();
    this.columnGeo.dispose();
    for (const f of this.falls) {
      (f.mesh.material as Material).dispose();
      this.parent.remove(f.mesh);
    }
    for (const c of this.columns) {
      (c.mesh.material as Material).dispose();
      this.parent.remove(c.mesh);
    }
    for (const p of this.pops) {
      (p.mesh.material as Material).dispose();
      this.parent.remove(p.mesh);
    }
  }
}
