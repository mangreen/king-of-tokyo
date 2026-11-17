import type { Object3D, PerspectiveCamera } from 'three';
import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  MeshStandardMaterial,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { disposeCardMesh, makeCardMesh, type CardFaces } from './cardShow.js';

/**
 * 商店飛碟（原創造型：淡紫色碟身、藍色玻璃罩、黃色圓燈、碟身側面的閃電徽章）。
 * 演出（跟著「商店能不能買」走，不是等買了才出現）：輪到某人的買牌階段、商店有東西可買時，
 * 飛碟從畫面右上飛入，停在城市上空打出黃色光束，光束裡飄著商店翻開的牌；
 * 買到的那張飛向買家，商店補進新牌時新牌滑進光束；清商店時舊牌被吸回碟身、換上新牌；
 * 買牌階段結束（或什麼都做不了）飛碟往左上飛走。
 * 買不起任何牌、但付得起清商店時，飛碟照樣入場，光束裡改飄一個 ♻ 更新圖示（不是卡片），
 * 提醒「可以花 2 能量清商店」。
 * 純視覺；牌的飛行只看進度（秒數由演出時間軸給，事件多時整段會等比例變快）。
 */

/**
 * 飛碟以「鏡頭空間」定位：不管鏡頭跟著哪隻怪獸、玩家怎麼拖曳縮放，飛碟都會出現在畫面上半部。
 * 座標是螢幕上的位置（NDC，-1..1）與離鏡頭的距離。
 */
export const HOVER_NDC = { x: 0.34, y: 0.6 } as const;
const ENTER_NDC = { x: 1.5, y: 1.1 } as const;
const EXIT_NDC = { x: -1.6, y: 1.2 } as const;
const DIST = 42;
const BEAM_LENGTH = 9;
const UFO_SCALE = 1.25;
const CARD_SCALE = 0.95;
/** 牌在光束裡的位置（世界單位，沿螢幕左右）。 */
const SLOT_X = [-4.2, 0, 4.2] as const;
/** 牌離飛碟的垂直距離（沿螢幕往下）。 */
const CARD_DROP = 8.6;
/** ♻ 更新圖示的大小（世界單位）與淡入／淡出秒數。 */
const ICON_SIZE = 6.4;
const ICON_FADE_S = 0.4;

const easeOut = (k: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
const easeIn = (k: number): number => Math.pow(Math.min(1, Math.max(0, k)), 2.2);
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const seg = (p: number, a: number, b: number): number =>
  Math.min(1, Math.max(0, (p - a) / (b - a)));

export interface UfoDelivery {
  /** 買到的牌（要飛向買家）。 */
  picked: string;
  /** 買家頭上的位置（牌飛去的終點）。 */
  target: { x: number; y: number; z: number };
  /** 牌飛行的秒數。 */
  dur: number;
}

/** 飛入、飛走的秒數；牌淡入、被吸回的秒數。 */
const ENTER_S = 0.9;
const LEAVE_S = 0.7;
const CARD_IN_S = 0.4;
const CARD_OUT_S = 0.4;

interface Slot {
  id: string;
  mesh: Mesh;
  /** 目前（平滑移動中）與目標的左右位置。 */
  x: number;
  toX: number;
  phase: number;
  /** 0→1 淡入。 */
  appear: number;
  /** 被移出商店：吸回碟身的進度（0–1）；null＝還在商店裡。 */
  removing: number | null;
  /** 買到：飛向買家。 */
  flight: { t: number; dur: number; target: { x: number; y: number; z: number } } | null;
}

/**
 * ♻ 更新圖示：兩支首尾相接的圓弧箭頭（畫在 canvas，不靠字型，各平台長得一樣）。
 * 黃色帶淡光暈，與光束同色系。
 */
export function makeRefreshTexture(): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) {
    const mid = size / 2;
    const r = size * 0.3;
    g.clearRect(0, 0, size, size);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // 兩段弧，各約 140 度，中間留缺口放箭頭
    for (const base of [Math.PI * 0.08, Math.PI * 1.08]) {
      const from = base + 0.25;
      const to = base + Math.PI - 0.5;
      g.shadowColor = 'rgba(255, 233, 122, 0.95)';
      g.shadowBlur = 22;
      g.strokeStyle = '#fff3b0';
      g.lineWidth = 26;
      g.beginPath();
      g.arc(mid, mid, r, from, to);
      g.stroke();
      // 箭頭：在弧的終點、沿切線方向
      const ex = mid + Math.cos(to) * r;
      const ey = mid + Math.sin(to) * r;
      const tx = -Math.sin(to);
      const ty = Math.cos(to);
      const nx = Math.cos(to);
      const ny = Math.sin(to);
      const tip = { x: ex + tx * 38, y: ey + ty * 38 };
      const wing = 34;
      g.fillStyle = '#fff3b0';
      g.beginPath();
      g.moveTo(tip.x, tip.y);
      g.lineTo(ex + nx * wing, ey + ny * wing);
      g.lineTo(ex - nx * wing, ey - ny * wing);
      g.closePath();
      g.fill();
    }
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = 'srgb';
  return tex;
}

/** 閃電徽章的外形。 */
export function boltShape(): Shape {
  const s = new Shape();
  s.moveTo(0.22, 1);
  s.lineTo(-0.5, -0.1);
  s.lineTo(-0.08, -0.1);
  s.lineTo(-0.3, -1);
  s.lineTo(0.5, 0.2);
  s.lineTo(0.08, 0.2);
  s.closePath();
  return s;
}

export class UfoShow {
  private readonly root = new Group();
  /** 傾斜整台飛碟（讓鏡頭看到碟面）；badge 不跟著旋轉。 */
  private readonly body = new Group();
  private readonly spin = new Group();
  private readonly badge = new Group();
  private readonly beam: Mesh;
  private readonly lights: Mesh[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private want = false;
  /** 飛入進度（秒）與飛走進度（秒）。 */
  private enterT = 0;
  private leaveT = 0;
  private readonly leaveFrom = new Vector2(HOVER_NDC.x, HOVER_NDC.y);
  private readonly ndc = new Vector2(ENTER_NDC.x, ENTER_NDC.y);
  private cards: string[] = [];
  /** 光束裡飄的是 ♻ 更新圖示（買不起、但清得起商店），不是卡片。 */
  private refresh = false;
  private iconAppear = 0;
  private readonly icon: Mesh;
  private readonly slots: Slot[] = [];
  private readonly tmp = new Vector3();
  private readonly home = new Vector3();
  private readonly right = new Vector3();
  private readonly upv = new Vector3();
  private readonly fwd = new Vector3();

  constructor(
    private readonly parent: Object3D,
    private readonly faces: CardFaces,
  ) {
    this.root.visible = false;
    this.root.scale.setScalar(UFO_SCALE);
    const own = <T extends { dispose(): void }>(x: T): T => {
      this.owned.push(x);
      return x;
    };

    // 碟身（旋轉體）
    const profile = [
      [0.01, -0.6],
      [1.5, -0.5],
      [3.1, -0.2],
      [3.9, 0.04],
      [3.5, 0.3],
      [2.0, 0.55],
      [0.01, 0.62],
    ]
      .reverse()
      .map(([x, y]) => new Vector2(x, y));
    const saucerMat = own(
      new MeshStandardMaterial({
        color: '#c3b3ee',
        roughness: 0.45,
        metalness: 0.25,
        emissive: '#6a5aa8',
        emissiveIntensity: 0.35,
        side: DoubleSide,
      }),
    );
    const saucer = new Mesh(own(new LatheGeometry(profile, 36)), saucerMat);
    // 紫色條紋
    const stripe = new Mesh(
      own(new TorusGeometry(3.62, 0.2, 8, 48)),
      own(new MeshStandardMaterial({ color: '#7b4fd1', roughness: 0.5 })),
    );
    stripe.rotation.x = Math.PI / 2;
    stripe.position.y = 0.06;
    // 玻璃罩
    const dome = new Mesh(
      own(new SphereGeometry(1.9, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2)),
      own(
        new MeshStandardMaterial({
          color: '#7fd3ff',
          transparent: true,
          opacity: 0.62,
          roughness: 0.1,
          metalness: 0.1,
          emissive: '#2a7fb8',
          emissiveIntensity: 0.35,
        }),
      ),
    );
    dome.position.y = 0.55;
    dome.scale.y = 0.95;
    // 黃色圓燈（碟身上緣一圈）
    const lightGeo = own(new SphereGeometry(0.3, 10, 8));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const lamp = new Mesh(
        lightGeo,
        own(new MeshBasicMaterial({ color: '#ffd23f', toneMapped: false })),
      );
      lamp.position.set(Math.cos(a) * 3.05, 0.2, Math.sin(a) * 3.05);
      lamp.scale.set(1.2, 0.8, 1.2);
      this.lights.push(lamp);
      this.spin.add(lamp);
    }
    // 底部發光盤
    const under = new Mesh(
      own(new CircleGeometry(1.3, 24)),
      own(new MeshBasicMaterial({ color: '#fff3a8', toneMapped: false, side: DoubleSide })),
    );
    under.rotation.x = Math.PI / 2;
    under.position.y = -0.62;
    this.spin.add(saucer, stripe, dome, under);

    // 閃電徽章：永遠面向鏡頭，貼在碟身前緣
    const disc = new Mesh(
      own(new CircleGeometry(1.05, 28)),
      own(new MeshBasicMaterial({ color: '#2a1a5e', toneMapped: false })),
    );
    const ring = new Mesh(
      own(new TorusGeometry(1.0, 0.1, 6, 32)),
      own(new MeshBasicMaterial({ color: '#ffd23f', toneMapped: false })),
    );
    const bolt = new Mesh(
      own(new ShapeGeometry(boltShape())),
      own(new MeshBasicMaterial({ color: '#ffe14d', toneMapped: false })),
    );
    bolt.scale.setScalar(0.62);
    bolt.position.z = 0.02;
    ring.position.z = 0.01;
    this.badge.add(disc, ring, bolt);
    // 徽章平貼在碟面前緣（不跟著旋轉，鏡頭永遠看得到）
    this.badge.rotation.x = -Math.PI / 2;
    this.badge.position.set(0, 0.5, 2.75);
    this.badge.scale.setScalar(0.95);

    // 光束（上窄下寬、往下漸淡；不蓋到地面的怪獸）
    const beamGeo = own(new CylinderGeometry(1.4, 5.4, BEAM_LENGTH, 40, 1, true));
    beamGeo.translate(0, -BEAM_LENGTH / 2, 0);
    const beamMat = own(
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color('#ffe97a') }, uOpacity: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
          void main(){ float a = uOpacity * (0.06 + 0.5 * vUv.y); gl_FragColor = vec4(uColor, a); }`,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    );
    this.beam = new Mesh(beamGeo, beamMat);
    this.beam.position.y = -0.55;
    this.beam.renderOrder = 5;

    // ♻ 更新圖示（與卡牌一樣疊在最上層、面向鏡頭）
    const iconMat = own(
      new MeshBasicMaterial({
        map: own(makeRefreshTexture()),
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    );
    this.icon = new Mesh(own(new PlaneGeometry(1, 1)), iconMat);
    this.icon.renderOrder = 8;
    this.icon.visible = false;
    parent.add(this.icon);

    this.body.add(this.spin, this.badge);
    this.root.add(this.body, this.beam);
    parent.add(this.root);
  }

  /** 飛碟（或飛行中的牌）還在畫面上。 */
  get playing(): boolean {
    return this.root.visible;
  }

  /** 飛碟已經（或正在）入場。 */
  get docked(): boolean {
    return this.want;
  }

  /** 有牌正飛向買家（這時商店的牌不要先換掉）。 */
  get delivering(): boolean {
    return this.slots.some((s) => s.flight !== null);
  }

  /**
   * 商店開著：飛碟入場（已在場就只更新光束裡的內容）。
   * cards＝商店翻開的牌，最多三張；refresh＝買不起任何牌、但清得起商店，光束裡改飄 ♻ 圖示（cards 應為空）。
   */
  dock(cards: readonly string[], refresh = false): void {
    if (
      this.want &&
      refresh === this.refresh &&
      cards.length === this.cards.length &&
      cards.every((c, i) => c === this.cards[i])
    ) {
      return;
    }
    if (!this.want) {
      this.want = true;
      // 飛走到一半又開了：跳過大半的飛入動畫直接接回來
      this.enterT = this.leaveT > 0 ? ENTER_S * 0.7 : 0;
      this.leaveT = 0;
      this.root.visible = true;
    }
    this.refresh = refresh;
    this.setCards(cards.slice(0, 3));
  }

  /** 商店關了：牌被吸回碟身，飛碟往左上飛走。 */
  undock(): void {
    if (!this.want) return;
    this.want = false;
    this.leaveT = 0.0001;
    this.leaveFrom.copy(this.ndc);
  }

  /** 商店的牌換了（買走、補牌、清商店）：舊牌吸回碟身、新牌滑進光束。 */
  private setCards(next: readonly string[]): void {
    this.cards = [...next];
    const xs = next.length === 3 ? SLOT_X : next.length === 2 ? [-1.8, 1.8] : [0];
    for (const s of this.slots) {
      if (s.flight === null && s.removing === null && !next.includes(s.id)) s.removing = 0;
    }
    next.forEach((id, i) => {
      const toX = xs[i] ?? 0;
      const have = this.slots.find((s) => s.id === id && s.removing === null && s.flight === null);
      if (have) {
        have.toX = toX;
        return;
      }
      const mesh = makeCardMesh(this.faces.texture(id));
      mesh.visible = false;
      this.parent.add(mesh);
      this.slots.push({
        id,
        mesh,
        x: toX,
        toX,
        phase: i * 1.7,
        appear: 0,
        removing: null,
        flight: null,
      });
    });
  }

  /** 買到一張牌：牌從光束飛向買家（牌不在光束裡時，從光束中央出發）。 */
  deliver(opts: UfoDelivery): void {
    if (!this.root.visible) return;
    let slot = this.slots.find((s) => s.id === opts.picked && s.flight === null);
    if (!slot) {
      const mesh = makeCardMesh(this.faces.texture(opts.picked));
      mesh.visible = false;
      this.parent.add(mesh);
      slot = {
        id: opts.picked,
        mesh,
        x: 0,
        toX: 0,
        phase: 0,
        appear: 1,
        removing: null,
        flight: null,
      };
      this.slots.push(slot);
    }
    slot.removing = null;
    slot.appear = 1;
    slot.flight = { t: 0, dur: Math.max(0.2, opts.dur), target: opts.target };
  }

  /** 立即結束（跳過演出、關閉特效）。 */
  clear(): void {
    this.want = false;
    this.refresh = false;
    this.iconAppear = 0;
    this.icon.visible = false;
    this.enterT = 0;
    this.leaveT = 0;
    this.root.visible = false;
    this.beam.visible = false;
    this.clearSlots();
  }

  private clearSlots(): void {
    for (const s of this.slots) {
      this.parent.remove(s.mesh);
      disposeCardMesh(s.mesh);
    }
    this.slots.length = 0;
  }

  update(dt: number, camera: PerspectiveCamera, time: number): void {
    if (!this.root.visible) return;
    if (this.want) this.enterT = Math.min(ENTER_S, this.enterT + dt);
    else this.leaveT += dt;
    const enter = easeOut(this.enterT / ENTER_S);
    const leave = this.want ? 0 : easeIn(this.leaveT / LEAVE_S);
    if (!this.want && this.leaveT >= LEAVE_S && !this.delivering) {
      this.clear();
      return;
    }
    camera.updateMatrixWorld();
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.upv.setFromMatrixColumn(camera.matrixWorld, 1);
    this.fwd.setFromMatrixColumn(camera.matrixWorld, 2).negate();

    // ── 飛碟本體（鏡頭空間：飛入 → 停住 → 飛走） ──
    const hover = enter >= 1 && leave === 0 ? Math.sin(time * 2.4) * 0.02 : 0;
    // 飛走時從「離開那一刻的位置」出發（飛入到一半被收回也不會瞬移）
    const fx = this.want
      ? lerp(ENTER_NDC.x, HOVER_NDC.x, enter)
      : lerp(this.leaveFrom.x, EXIT_NDC.x, leave);
    const fy = this.want
      ? lerp(ENTER_NDC.y, HOVER_NDC.y, enter) + hover
      : lerp(this.leaveFrom.y, EXIT_NDC.y, leave);
    this.ndc.set(fx, fy);
    this.placeAt(camera, fx, fy, this.root.position);
    this.root.quaternion.copy(camera.quaternion);
    this.spin.rotation.y = time * 1.6;
    this.body.rotation.x = 0.95 + Math.sin(time * 1.3) * 0.03;
    this.body.rotation.z = (1 - enter) * -0.45 + leave * 0.45 + Math.sin(time * 1.8) * 0.04;
    this.lights.forEach((l, i) => {
      const on = Math.sin(time * 7 + i * 0.9) > -0.2;
      (l.material as MeshBasicMaterial).color.set(on ? '#ffd23f' : '#a8761a');
    });

    // ── 光束 ──
    const beamOn =
      easeOut(seg(this.enterT / ENTER_S, 0.25, 0.6)) * (1 - easeIn(seg(leave, 0, 0.5)));
    this.beam.visible = beamOn > 0.01;
    this.beam.scale.set(0.35 + 0.65 * beamOn, beamOn, 0.35 + 0.65 * beamOn);
    (this.beam.material as ShaderMaterial).uniforms['uOpacity']!.value = 0.55 * beamOn;

    this.placeIcon(dt, time, camera, enter, leave);

    // ── 卡牌 ──
    for (let i = this.slots.length - 1; i >= 0; i -= 1) {
      const s = this.slots[i];
      if (!s) continue;
      if (!this.stepSlot(s, dt)) {
        this.parent.remove(s.mesh);
        disposeCardMesh(s.mesh);
        this.slots.splice(i, 1);
        continue;
      }
      this.placeCard(s, time, camera, enter, leave);
    }
  }

  /** ♻ 更新圖示：待在光束中央慢慢旋轉、上下飄，淡入淡出；飛碟離場時一起被吸回碟身。 */
  private placeIcon(
    dt: number,
    time: number,
    camera: PerspectiveCamera,
    enter: number,
    leave: number,
  ): void {
    const target = this.want && this.refresh ? 1 : 0;
    this.iconAppear +=
      Math.sign(target - this.iconAppear) *
      Math.min(Math.abs(target - this.iconAppear), dt / ICON_FADE_S);
    const present = easeOut(seg(enter, 0.3, 0.6)) * (1 - easeIn(seg(leave, 0, 0.55)));
    const k = easeOut(this.iconAppear);
    const alpha = k * present;
    const bob = Math.sin(time * 2.2) * 0.35;
    this.icon.position.copy(this.root.position).addScaledVector(this.upv, -CARD_DROP + bob);
    if (leave > 0) this.icon.position.lerp(this.root.position, easeIn(seg(leave, 0, 0.55)));
    this.icon.quaternion.copy(camera.quaternion);
    this.icon.rotateZ(-time * 0.9);
    this.icon.scale.setScalar(
      Math.max(0.001, ICON_SIZE * (0.6 + 0.4 * k) * (1 + 0.04 * Math.sin(time * 3))),
    );
    (this.icon.material as MeshBasicMaterial).opacity = alpha;
    this.icon.visible = alpha > 0.01;
  }

  /** 推進一張牌的動畫；回傳 false＝這張牌演完了，可以移除。 */
  private stepSlot(s: Slot, dt: number): boolean {
    s.x += (s.toX - s.x) * Math.min(1, dt * 7);
    if (s.removing !== null) {
      s.removing += dt / CARD_OUT_S;
      return s.removing < 1;
    }
    if (s.flight) {
      s.flight.t += dt;
      return s.flight.t < s.flight.dur;
    }
    s.appear = Math.min(1, s.appear + dt / CARD_IN_S);
    return true;
  }

  /** 螢幕上的位置（NDC）＋固定距離 → 世界座標。 */
  private placeAt(camera: PerspectiveCamera, nx: number, ny: number, out: Vector3): Vector3 {
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * DIST;
    const halfW = halfH * camera.aspect;
    return out
      .copy(camera.position)
      .addScaledVector(this.fwd, DIST)
      .addScaledVector(this.right, nx * halfW)
      .addScaledVector(this.upv, ny * halfH);
  }

  private placeCard(
    s: Slot,
    time: number,
    camera: PerspectiveCamera,
    enter: number,
    leave: number,
  ): void {
    const present = easeOut(seg(enter, 0.3, 0.6)) * (1 - easeIn(seg(leave, 0, 0.55)));
    const bob = Math.sin(time * 2.2 + s.phase) * 0.35;
    // 待在光束裡的位置（跟著飛碟，沿螢幕左右／往下排開）
    this.home
      .copy(this.root.position)
      .addScaledVector(this.right, s.x)
      .addScaledVector(this.upv, -CARD_DROP + bob);
    let scale = CARD_SCALE * easeOut(s.appear) * (s.flight ? 1 : present);
    let alpha = s.flight ? 1 : Math.max(easeOut(s.appear), 0) * present;
    this.tmp.copy(this.home);

    if (s.flight) {
      // 飛向買家頭上（弧線上拋）
      const k = Math.min(1, s.flight.t / s.flight.dur);
      const e = easeIn(k);
      this.tmp.set(s.flight.target.x, s.flight.target.y, s.flight.target.z).lerp(this.home, 1 - e);
      this.tmp.addScaledVector(this.upv, Math.sin(Math.PI * e) * 3.2);
      scale = CARD_SCALE * (1 - 0.55 * e);
      alpha = k > 0.94 ? (1 - k) / 0.06 : 1;
    } else if (s.removing !== null) {
      // 被移出商店：吸回碟身
      const k = easeIn(Math.min(1, s.removing));
      this.tmp.lerp(this.root.position, k);
      scale *= 1 - k;
    } else if (leave > 0) {
      this.tmp.lerp(this.root.position, easeIn(seg(leave, 0, 0.55)));
    }
    s.mesh.visible = alpha > 0.01 && scale > 0.02;
    s.mesh.position.copy(this.tmp);
    s.mesh.scale.setScalar(Math.max(0.001, scale));
    s.mesh.quaternion.copy(camera.quaternion);
    (s.mesh.material as MeshBasicMaterial).opacity = alpha;
  }

  dispose(): void {
    this.clear();
    this.parent.remove(this.root);
    this.parent.remove(this.icon);
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
  }
}
