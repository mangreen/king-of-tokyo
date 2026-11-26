import {
  AmbientLight,
  DirectionalLight,
  Fog,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import type { CardDef, GameEvent } from '@kot/rules';
import { MonsterActor } from './actor.js';
import { buildCity, type CityBuild } from './city.js';
import { CardFaces, CardFxSystem } from './cardShow.js';
import { THEME_STYLE } from './cardFx.js';
import { directEvents, UFO_DELIVER_AT, type Cue } from './director.js';
import { buildCrown, headBounds, type Crown } from './crown.js';
import { AttackFxSystem, attackStyleOf } from './attackFx.js';
import { CrackSystem, DebrisSystem, DustSystem, ShieldSystem, ShockwaveSystem } from './effects.js';
import { Holds } from './holds.js';
import { UfoShow } from './ufo.js';
import { StatusFxSystem, type StatusTarget } from './statusFx.js';
import {
  BAY_SPOT,
  CITY_SPOT,
  monsterSpot,
  seatColor,
  type SceneLocation,
  type Spot,
} from './layout.js';
import { buildMonster } from './monsters.js';
import {
  AutoDegrade,
  QUALITY,
  lowerTier,
  startTier,
  type QualitySetting,
  type QualityTier,
} from './quality.js';
import {
  MONSTER_SCALE,
  OVERVIEW_POSE,
  overviewPoseFor,
  VICTORY_SWITCH_MS,
  blendPose,
  poseFor,
  smoothstep,
  victoryPose,
  type CameraPose,
  type ShotSpec,
} from './shots.js';
import { makeSoftDotTexture } from './textures.js';
import {
  DEFAULT_VIEW,
  applyView,
  clampView,
  isDefaultView,
  followView,
  zoomAt,
  type UserView,
} from './view.js';

export interface SceneMonster {
  seat: number;
  name: string;
  /** 怪獸造型（0..11，見 roster.ts）；每場由伺服器隨機分配。 */
  kind: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  vp: number;
  energy: number;
  location: SceneLocation;
  /** 身上的指示物（中毒／縮小）；省略＝沒有。 */
  tokens?: { poison: number; shrink: number };
  /** 受到「全場少擲骰子」（震地步伐）影響的層數；省略或 0＝沒有。 */
  dizzy?: number;
}

export interface SceneSnapshot {
  playerCount: number;
  monsters: SceneMonster[];
  /** 目前行動中的座位（顯示腳下光環）。 */
  activeSeat: number | null;
  mySeat: number | null;
  /**
   * 商店開著（買牌階段、有東西可買）時翻開的牌；null／沒給＝商店沒開。
   * 飛碟跟著它入場、停留、離場，不是等買了牌才出現。
   */
  shop?: readonly string[] | null;
  /** 遊戲結束時的勝者座位（空或省略＝還在進行中）：戴皇冠、持續慶祝，鏡頭鎖定勝者。 */
  winners?: readonly number[];
  /**
   * 商店買不起任何牌、但付得起清商店：飛碟照樣入場，光束裡飄 ♻ 更新圖示（不是卡片）。
   * 與 shop 互斥（shop 有牌時為 false／省略）。
   */
  shopRefresh?: boolean;
}

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  /** 與 canvas 重疊的 DOM 層：名牌、傷害數字。 */
  overlay: HTMLElement;
  quality: QualitySetting;
  /** 鏡頭運動與震動（無障礙：prefers-reduced-motion 時預設關閉）。 */
  cameraMotion: boolean;
  /** 鏡頭跟隨行動中的怪獸（預設開）。 */
  follow?: boolean;
  /** 怪獸各自的攻擊特效（預設開）。 */
  attackFx?: boolean;
  /** 商店飛碟與卡牌特效（預設開）。 */
  cardFx?: boolean;
  /** 查卡牌資料（卡面與特效主題用）；卡牌組晚到時用 setCards 更新。 */
  cards?: ((id: string) => CardDef | undefined) | undefined;
  seed: number;
  onTierChange?: (tier: QualityTier) => void;
  onFatal?: (reason: string) => void;
  /** 玩家自己調整地圖視角（平移／縮放）時通知；true 表示目前不是預設視角。 */
  onViewChange?: (custom: boolean) => void;
}

export interface SceneStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  tier: QualityTier;
  buildings: number;
  dust: number;
  debris: number;
}

interface Playing {
  cues: Cue[];
  next: number;
  startAt: number;
  endAt: number;
}

const CONCRETE = ['#b8b2a5', '#8c8678', '#d9d2c3', '#6e7a86', '#a8564a'] as const;
const CONFETTI = ['#ff4d6d', '#ffd23f', '#3bceac', '#4cc9f0', '#b565e6'] as const;
/** 別人的買牌階段要連續開著這麼久，飛碟才入場（輪到自己則馬上）。 */
const SHOP_OTHERS_DEBOUNCE_MS = 1500;
const BACKLOG_LIMIT_MS = 9000;
const FLOAT_COLORS = {
  energy: '#ffd23f',
  heal: '#4be08b',
  vp: '#ffb347',
  hit: '#ff4d4d',
  poison: '#c37bff',
} as const;

export class SceneRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  /** 飛碟另外用一個場景疊在最上層（先清深度）：不被城市建築擋住。 */
  private readonly overlayScene = new Scene();
  private readonly camera = new PerspectiveCamera(OVERVIEW_POSE.fov, 1, 0.5, 240);
  private readonly world = new Group();
  private readonly fx = new Group();
  private readonly sun = new DirectionalLight('#fff0d4', 2.1);
  private readonly hemi = new HemisphereLight('#cfe6ff', '#b39a78', 1.25);
  private city: CityBuild | null = null;
  private actors = new Map<number, MonsterActor>();
  private dust: DustSystem;
  private debris: DebrisSystem;
  private waves: ShockwaveSystem;
  private cracks: CrackSystem;
  private attackFx!: AttackFxSystem;
  private shields: ShieldSystem;
  private readonly faces: CardFaces;
  private cardFx!: CardFxSystem;
  private statusFx!: StatusFxSystem;
  private ufo!: UfoShow;
  /** 商店開始連續開著的時間（模擬毫秒）；關著＝null。 */
  private shopSince: number | null = null;
  /** 勝利者頭上的皇冠（座位 → 皇冠）。 */
  private crowns = new Map<number, Crown>();
  private celebrate = { confetti: 0, wave: 0, spark: 0, roar: 0 };
  private cardFxOn: boolean;
  private cardOf: ((id: string) => CardDef | undefined) | undefined;
  private readonly blobTex: Texture = makeSoftDotTexture();
  private readonly blobs = new Map<number, Mesh>();
  /** 海上怪獸腳邊的水波（飛行怪獸不需要）。 */
  private readonly ripples = new Map<number, Mesh>();
  private readonly marker: Mesh;
  private readonly tags = new Map<number, HTMLElement>();
  private snapshot: SceneSnapshot | null = null;
  private displayedHp = new Map<number, number>();
  private readonly holds = new Holds();

  private tier: QualityTier;
  private readonly setting: QualitySetting;
  private readonly degrade = new AutoDegrade();
  private cameraMotion: boolean;

  private raf = 0;
  private lastFrame = 0;
  private simMs = 0;
  /** 命中停頓結束的「真實時間」（rAF 時間戳）；用真實時間才會真的只停 60–120 ms。 */
  private hitstopUntil = 0;
  private realNow = 0;
  private playing: Playing[] = [];
  private shotSpec: { spec: ShotSpec; start: number; dur: number } | null = null;
  private pose: CameraPose = structuredClone(OVERVIEW_POSE);
  private shake = 0;
  /** 玩家自己調的視角（平移／縮放）；非預設時暫停自動鏡頭，由玩家掌控。 */
  private view: UserView = DEFAULT_VIEW;
  private viewCustom = false;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private interacting = false;
  private follow = true;
  private disposed = false;
  private lost = false;
  private frames = 0;
  private fpsWindow: number[] = [];
  private visible = true;
  private readonly resizeObserver: ResizeObserver;
  private readonly io: IntersectionObserver | null;
  private readonly tmp = new Vector3();
  private readonly onVisibility = (): void => {
    this.lastFrame = 0;
    // 分頁在背景時時間不前進；回來時把積壓的演出直接收尾，不要讓畫面落後狀態
    if (!document.hidden && this.playing.length > 0) this.skip();
  };
  private ndcOf(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.opts.canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / Math.max(1, r.width)) * 2 - 1,
      y: -(((clientY - r.top) / Math.max(1, r.height)) * 2 - 1),
    };
  }
  private gesture(
    from: { x: number; y: number },
    to: { x: number; y: number },
    factor: number,
  ): void {
    this.view = zoomAt(this.overviewPose(), this.view, this.camera.aspect, from, to, factor);
    this.notifyView();
  }
  private notifyView(): void {
    const custom = !isDefaultView(this.view);
    if (custom !== this.viewCustom) {
      this.viewCustom = custom;
      this.opts.onViewChange?.(custom);
    }
  }
  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    try {
      this.opts.canvas.setPointerCapture(e.pointerId);
    } catch {
      // 合成事件沒有可捕捉的指標
    }
    this.pointers.set(e.pointerId, this.ndcOf(e.clientX, e.clientY));
    this.interacting = true;
  };
  private readonly onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const now = this.ndcOf(e.clientX, e.clientY);
    if (this.pointers.size === 1) {
      this.gesture(prev, now, 1);
    } else if (this.pointers.size === 2) {
      // 雙指：縮放比例 = 兩指距離變化；中心點的移動 = 平移
      const [a, b] = [...this.pointers.entries()];
      if (!a || !b) return;
      const other = a[0] === e.pointerId ? b[1] : a[1];
      const aspect = Math.max(0.1, this.camera.aspect);
      const dist = (p: { x: number; y: number }, q: { x: number; y: number }): number =>
        Math.hypot((p.x - q.x) * aspect, p.y - q.y);
      const before = dist(prev, other);
      const after = dist(now, other);
      const mid = (p: { x: number; y: number }): { x: number; y: number } => ({
        x: (p.x + other.x) / 2,
        y: (p.y + other.y) / 2,
      });
      this.gesture(mid(prev), mid(now), before > 1e-4 ? after / before : 1);
    }
    this.pointers.set(e.pointerId, now);
  };
  private readonly onPointerEnd = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.interacting = false;
  };
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const at = this.ndcOf(e.clientX, e.clientY);
    this.gesture(at, at, Math.exp(-e.deltaY * unit * 0.0015));
  };
  private readonly onDblClick = (): void => {
    this.resetView();
  };
  private readonly onKey = (e: KeyboardEvent): void => {
    const step = 0.12 / this.view.zoom;
    const c = { x: 0, y: 0 };
    const move = (dx: number, dy: number): void => {
      // 方向鍵：把地圖往按的方向「推」（內容跟著移動）
      this.gesture(c, { x: dx * step * 2, y: dy * step * 2 }, 1);
    };
    switch (e.key) {
      case 'ArrowLeft':
        move(-1, 0);
        break;
      case 'ArrowRight':
        move(1, 0);
        break;
      case 'ArrowUp':
        move(0, 1);
        break;
      case 'ArrowDown':
        move(0, -1);
        break;
      case '+':
      case '=':
        this.gesture(c, c, 1.25);
        break;
      case '-':
      case '_':
        this.gesture(c, c, 0.8);
        break;
      case '0':
      case 'Home':
        this.resetView();
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  /** 按鈕縮放（以畫面中心）。 */
  zoomBy(factor: number): void {
    this.gesture({ x: 0, y: 0 }, { x: 0, y: 0 }, factor);
  }
  /** 回到預設總覽並恢復自動鏡頭。 */
  resetView(): void {
    this.view = DEFAULT_VIEW;
    this.notifyView();
  }
  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    // 內容已失效：停掉繪製迴圈，交給 UI 顯示「重試」（重試會重建整個渲染器與 canvas）
    cancelAnimationFrame(this.raf);
    this.lost = true;
    this.opts.onFatal?.('webgl-context-lost');
  };

  constructor(private readonly opts: RendererOptions) {
    this.setting = opts.quality;
    this.tier = startTier(opts.quality);
    this.cameraMotion = opts.cameraMotion;
    this.follow = opts.follow ?? true;
    this.cardFxOn = opts.cardFx ?? true;
    this.cardOf = opts.cards;
    this.faces = new CardFaces((id) => this.cardOf?.(id));
    const q = QUALITY[this.tier];

    try {
      this.renderer = new WebGLRenderer({
        canvas: opts.canvas,
        antialias: q.antialias,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch (err) {
      opts.onFatal?.(err instanceof Error ? err.message : 'webgl-init-failed');
      throw err;
    }
    this.renderer.shadowMap.type = PCFShadowMap;
    opts.canvas.addEventListener('webglcontextlost', this.onContextLost);
    opts.canvas.addEventListener('pointerdown', this.onPointerDown);
    opts.canvas.addEventListener('pointermove', this.onPointerMove);
    opts.canvas.addEventListener('pointerup', this.onPointerEnd);
    opts.canvas.addEventListener('pointercancel', this.onPointerEnd);
    opts.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    opts.canvas.addEventListener('dblclick', this.onDblClick);
    opts.canvas.addEventListener('keydown', this.onKey);
    this.opts.onViewChange?.(false);

    this.scene.add(this.world, this.fx);
    this.scene.add(this.hemi, new AmbientLight('#ffffff', 0.15));
    this.sun.position.set(-22, 34, 16);
    this.sun.target.position.set(0, 0, 0);
    const cam = this.sun.shadow.camera;
    cam.left = -26;
    cam.right = 26;
    cam.top = 26;
    cam.bottom = -26;
    cam.near = 5;
    cam.far = 90;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun, this.sun.target);
    this.scene.fog = new Fog('#ecd6b0', 55, 135);

    this.dust = new DustSystem(QUALITY.high.dust);
    this.debris = new DebrisSystem(QUALITY.high.debris);
    this.waves = new ShockwaveSystem(this.fx);
    this.cracks = new CrackSystem(this.fx);
    this.shields = new ShieldSystem(this.fx);
    this.attackFx = new AttackFxSystem(
      this.fx,
      {
        dust: this.dust,
        debris: this.debris,
        waves: this.waves,
        cracks: this.cracks,
        dustScale: () => QUALITY[this.tier].dust / QUALITY.high.dust,
        shake: (amount) => {
          if (this.cameraMotion) this.shake = Math.max(this.shake, amount);
        },
      },
      opts.attackFx ?? true,
    );
    this.fx.add(this.dust.points, this.debris.mesh);
    this.statusFx = new StatusFxSystem();
    this.fx.add(this.statusFx.group);
    this.cardFx = new CardFxSystem(this.fx, {
      dust: this.dust,
      debris: this.debris,
      waves: this.waves,
      shields: this.shields,
      faces: this.faces,
      scale: () => QUALITY[this.tier].dust / QUALITY.high.dust,
      shake: (amount) => {
        if (this.cameraMotion) this.shake = Math.max(this.shake, amount);
      },
    });
    this.cardFx.setEnabled(this.cardFxOn);
    const ufoSun = new DirectionalLight('#fff6e0', 2.2);
    ufoSun.position.set(-6, 10, 14);
    this.overlayScene.add(new HemisphereLight('#e6f1ff', '#a69ac8', 1.5), ufoSun);
    this.ufo = new UfoShow(this.overlayScene, this.faces);

    const markerGeo = new RingGeometry(1.9, 2.3, 40);
    markerGeo.rotateX(-Math.PI / 2);
    this.marker = new Mesh(
      markerGeo,
      new MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    this.marker.position.y = 0.1;
    this.marker.visible = false;
    this.marker.renderOrder = 3;
    this.scene.add(this.marker);

    this.applyQuality(this.tier, true);

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(opts.canvas);
    this.io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            const was = this.visible;
            this.visible = entries.some((e) => e.isIntersecting);
            // 畫面外時不繪製、時間不前進；捲回來時把積壓的演出收尾，別讓場景落後狀態
            if (!was && this.visible && this.playing.length > 0) this.skip();
          });
    this.io?.observe(opts.canvas);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ── 對外介面 ─────────────────────────────────────

  /** 鏡頭是否跟隨行動中的怪獸（還需要鏡頭運動開啟）。 */
  setFollow(on: boolean): void {
    this.follow = on;
  }

  /** 開關怪獸各自的攻擊特效。 */
  setAttackFx(on: boolean): void {
    this.attackFx.setEnabled(on);
  }

  /** 開關商店飛碟與卡牌特效。 */
  setCardFx(on: boolean): void {
    this.cardFxOn = on;
    this.cardFx.setEnabled(on);
    if (!on) this.ufo.clear();
    for (const m of this.snapshot?.monsters ?? []) {
      const actor = this.actors.get(m.seat);
      if (actor) this.applyStatus(m, actor, false);
    }
  }

  /** 卡牌組載入後（或換卡牌組）更新卡面與特效主題。 */
  setCards(lookup: ((id: string) => CardDef | undefined) | undefined): void {
    this.cardOf = lookup;
    this.faces.setLookup((id) => this.cardOf?.(id));
  }

  setCameraMotion(on: boolean): void {
    this.cameraMotion = on;
    if (!on) {
      this.shotSpec = null;
      this.shake = 0;
    }
  }

  /** 以最新的遊戲狀態更新場景；演出中的事件會延後套用（見 holds.ts）。 */
  setSnapshot(snap: SceneSnapshot): void {
    const first = this.snapshot === null;
    // 人數改變，或同座位換了造型（新的一場）→ 整個場景重建
    const kindChanged = snap.monsters.some((m) => {
      const a = this.actors.get(m.seat);
      return a !== undefined && a.rig.archetype !== m.kind;
    });
    const rebuild = !this.snapshot || this.snapshot.playerCount !== snap.playerCount || kindChanged;
    this.snapshot = snap;
    if (rebuild) this.rebuildWorld(snap.playerCount);
    for (const m of snap.monsters) {
      // 新建立的演員（首次或重建場景後）直接就定位，不重播倒下／移動
      const fresh = !this.actors.has(m.seat);
      if (fresh) this.spawnActor(m, snap.playerCount);
      this.syncSeat(m.seat, first || fresh);
    }
    this.refreshTags();
  }

  /** 播放一批事件。回傳是否有演出（供 UI 顯示「跳過」）。 */
  play(events: readonly GameEvent[]): boolean {
    const { cues, duration } = directEvents(events, (id) => this.cardOf?.(id));
    if (cues.length === 0) return false;
    const tail = this.playing.reduce((m, p) => Math.max(m, p.endAt), this.simMs);
    const startAt = Math.max(this.simMs, tail);
    this.holds.add(cues);
    this.playing.push({ cues, next: 0, startAt, endAt: startAt + duration });
    if (startAt - this.simMs > BACKLOG_LIMIT_MS) this.skip();
    return true;
  }

  /** 跳過所有尚未播完的演出：直接套用最終狀態。 */
  skip(): void {
    const pending = this.playing;
    this.playing = [];
    for (const p of pending) {
      for (let i = p.next; i < p.cues.length; i++) {
        const c = p.cues[i];
        if (c) this.release(c);
      }
    }
    this.shotSpec = null;
    this.attackFx.clear();
    this.cardFx.clear();
    this.ufo.clear();
    this.holds.clear();
    if (this.snapshot) for (const m of this.snapshot.monsters) this.syncSeat(m.seat, true);
    this.refreshTags();
  }

  get busy(): boolean {
    return this.playing.length > 0;
  }

  getStats(): SceneStats {
    const info = this.renderer.info;
    const fps =
      this.fpsWindow.length === 0
        ? 0
        : 1000 / (this.fpsWindow.reduce((a, b) => a + b, 0) / this.fpsWindow.length);
    return {
      fps: Math.round(fps),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      tier: this.tier,
      buildings: this.city?.stats.buildings ?? 0,
      dust: this.dust.activeCount,
      debris: this.debris.activeCount,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearCrowns();
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.io?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.opts.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.opts.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.opts.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.opts.canvas.removeEventListener('pointerup', this.onPointerEnd);
    this.opts.canvas.removeEventListener('pointercancel', this.onPointerEnd);
    this.opts.canvas.removeEventListener('wheel', this.onWheel);
    this.opts.canvas.removeEventListener('dblclick', this.onDblClick);
    this.opts.canvas.removeEventListener('keydown', this.onKey);
    for (const a of this.actors.values()) a.dispose();
    this.actors.clear();
    this.city?.dispose();
    this.dust.dispose();
    this.debris.dispose();
    this.waves.dispose();
    this.cracks.dispose();
    this.attackFx.dispose();
    this.shields.dispose();
    this.cardFx.dispose();
    this.statusFx.dispose();
    this.ufo.dispose();
    this.faces.dispose();
    this.blobTex.dispose();
    this.marker.geometry.dispose();
    (this.marker.material as Material).dispose();
    for (const b of [...this.blobs.values(), ...this.ripples.values()]) {
      b.geometry.dispose();
      (b.material as Material).dispose();
    }
    this.blobs.clear();
    this.ripples.clear();
    for (const el of this.tags.values()) el.remove();
    this.tags.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // ── 世界建構 ─────────────────────────────────────

  private rebuildWorld(playerCount: number): void {
    this.clearCrowns();
    for (const a of this.actors.values()) {
      this.world.remove(a.rig.root);
      a.dispose();
    }
    this.actors.clear();
    for (const b of [...this.blobs.values(), ...this.ripples.values()]) {
      this.world.remove(b);
      b.geometry.dispose();
      (b.material as Material).dispose();
    }
    this.blobs.clear();
    this.ripples.clear();
    for (const el of this.tags.values()) el.remove();
    this.tags.clear();
    this.buildCity(playerCount);
  }

  private buildCity(playerCount: number): void {
    if (this.city) {
      this.world.remove(this.city.group);
      this.city.dispose();
    }
    this.city = buildCity({
      seed: this.opts.seed,
      playerCount,
      density: QUALITY[this.tier].buildingDensity,
      castShadows: this.tier === 'high',
    });
    this.world.add(this.city.group);
    this.scene.background = this.city.background;
    this.applyShadowFlags();
  }

  private spawnActor(m: SceneMonster, playerCount: number): void {
    const rig = buildMonster(m.kind, m.seat, QUALITY[this.tier].segments);
    const spot = monsterSpot(m.seat, playerCount, m.location);
    const actor = new MonsterActor(m.seat, rig, spot);
    actor.onLand = (a, s) => {
      this.landed(a, s);
    };
    this.world.add(rig.root);
    this.actors.set(m.seat, actor);
    rig.setShadows(QUALITY[this.tier].shadowMapSize > 0);

    const blob = new Mesh(
      new PlaneGeometry(5.2, 5.2),
      new MeshBasicMaterial({
        map: this.blobTex,
        color: '#000000',
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.08;
    blob.visible = QUALITY[this.tier].shadowMapSize === 0;
    this.world.add(blob);
    this.blobs.set(m.seat, blob);

    const ripple = new Mesh(
      new RingGeometry(1.9, 2.6, 40),
      new MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.y = 0.1;
    ripple.visible = false;
    this.world.add(ripple);
    this.ripples.set(m.seat, ripple);

    const tag = document.createElement('div');
    tag.className = 'kot-tag';
    tag.dataset['seat'] = String(m.seat);
    tag.style.setProperty('--seat', seatColor(m.seat));
    this.opts.overlay.appendChild(tag);
    this.tags.set(m.seat, tag);
    this.displayedHp.set(m.seat, m.hp);
  }

  /** 把最新狀態套用到某座位（扣掉仍在演出中的部分）。 */
  private syncSeat(seat: number, instant: boolean): void {
    const m = this.snapshot?.monsters.find((x) => x.seat === seat);
    const actor = this.actors.get(seat);
    if (!m || !actor || !this.snapshot) return;
    if (!this.holds.held(seat, 'move')) {
      actor.setSpot(monsterSpot(seat, this.snapshot.playerCount, m.location), instant);
    }
    if (!this.holds.held(seat, 'ko')) actor.setAlive(m.alive, instant);
    this.applyStatus(m, actor, instant);
    if (!this.holds.held(seat, 'hit')) this.displayedHp.set(seat, m.hp);
  }

  /** 持續狀態：中毒閃爍、縮小（演出關閉時不閃爍也不縮小，只留名牌上的圖示）。 */
  private applyStatus(m: SceneMonster, actor: MonsterActor, instant: boolean): void {
    const on = this.cardFxOn && m.alive;
    actor.setStatus(on ? (m.tokens?.poison ?? 0) : 0, on ? (m.tokens?.shrink ?? 0) : 0, instant);
    actor.setDizzy(on && (m.dizzy ?? 0) > 0);
  }

  private applyQuality(tier: QualityTier, initial = false): void {
    this.tier = tier;
    const q = QUALITY[tier];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dprCap));
    this.dust.setCapacity(q.dust);
    this.debris.setCapacity(q.debris);
    this.applyShadowFlags();
    if (!initial) {
      this.resize();
      if (this.snapshot) this.buildCity(this.snapshot.playerCount);
      for (const a of this.actors.values()) a.rig.setShadows(q.shadowMapSize > 0);
      this.opts.onTierChange?.(tier);
    }
  }

  private applyShadowFlags(): void {
    const size = QUALITY[this.tier].shadowMapSize;
    const on = size > 0;
    if (this.renderer.shadowMap.enabled !== on) {
      this.renderer.shadowMap.enabled = on;
      this.scene.traverse((o) => {
        const mat = (o as Mesh).material as Material | Material[] | undefined;
        if (Array.isArray(mat)) for (const m of mat) m.needsUpdate = true;
        else if (mat) mat.needsUpdate = true;
      });
    }
    this.sun.castShadow = on;
    if (on && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  private resize(): void {
    const { canvas } = this.opts;
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ── cue 執行 ─────────────────────────────────────

  private actor(seat: number): MonsterActor | undefined {
    return this.actors.get(seat);
  }

  private release(cue: Cue): void {
    const seat = this.holds.release(cue);
    if (seat !== null) this.syncSeat(seat, false);
  }

  private run(cue: Cue): void {
    const q = QUALITY[this.tier];
    switch (cue.kind) {
      case 'focus':
        break;
      case 'lunge': {
        const a = this.actor(cue.seat);
        if (!a) break;
        const ts = cue.targets
          .map((s) => this.actor(s))
          .filter((x): x is MonsterActor => x !== undefined);
        if (ts.length === 0) break;
        const cx = ts.reduce((s, t) => s + t.x, 0) / ts.length;
        const cz = ts.reduce((s, t) => s + t.z, 0) / ts.length;
        a.lunge(cx, cz, cue.power);
        this.attackFx.play(
          attackStyleOf(a.rig.archetype),
          { x: a.x, z: a.z },
          ts.map((t) => ({ x: t.x, z: t.z })),
          cue.power,
        );
        break;
      }
      case 'hit': {
        const a = this.actor(cue.seat);
        this.displayedHp.set(cue.seat, cue.hp);
        // 最後一筆 hit 播完後 release 會把血量對齊到伺服器狀態
        this.release(cue);
        this.refreshTag(cue.seat);
        if (!a) break;
        const by = cue.by === null ? undefined : this.actor(cue.by);
        a.flinch(by?.x ?? a.x, by?.z ?? a.z + 1, cue.power);
        const poison = cue.cause === 'poison';
        this.float(
          a,
          `-${String(cue.amount)}`,
          poison ? FLOAT_COLORS.poison : FLOAT_COLORS.hit,
          cue.power,
        );
        const n = cue.power === 'heavy' ? 14 : cue.power === 'medium' ? 8 : 4;
        this.dust.emit(a.x, 0.3, a.z, {
          count: Math.min(n * 2, q.dust / 4),
          spread: 2 + n * 0.25,
          up: 2,
          size: 2.4,
          color: poison ? '#9b6bd6' : '#d8cdb8',
        });
        this.debris.burst(a.x, 2, a.z, n, 5 + n * 0.4, poison ? ['#9b6bd6', '#6a3fb0'] : CONCRETE);
        this.waves.fire(a.x, a.z, 2 + n * 0.22, poison ? '#c9a2ff' : '#fff3c4');
        if (this.cameraMotion) {
          this.shake = Math.max(
            this.shake,
            cue.power === 'heavy' ? 0.9 : cue.power === 'medium' ? 0.5 : 0.25,
          );
        }
        break;
      }
      case 'hitstop':
        if (this.cameraMotion)
          this.hitstopUntil = Math.max(this.hitstopUntil, this.realNow + cue.dur);
        break;
      case 'stomp':
        // 解除「移動」保留：syncSeat 會讓怪獸跳向東京，落地時由 landed() 播踩踏特效
        this.release(cue);
        break;
      case 'leave': {
        this.release(cue);
        const a = this.actor(cue.seat);
        if (a) this.dust.emit(a.x, 0.3, a.z, { count: 14, spread: 3, up: 1.2, size: 2.2 });
        break;
      }
      case 'ko': {
        this.release(cue);
        const a = this.actor(cue.seat);
        if (!a) break;
        this.float(a, 'K.O.', '#ffffff', 'heavy');
        this.debris.burst(a.x, 2.5, a.z, 18, 8, [...CONCRETE, seatColor(cue.seat)]);
        this.dust.emit(a.x, 0.3, a.z, { count: 30, spread: 4.5, up: 2.4, size: 3, life: 1.6 });
        this.waves.fire(a.x, a.z, 5.5);
        if (this.cameraMotion) this.shake = Math.max(this.shake, 1);
        break;
      }
      case 'pickup': {
        const a = this.actor(cue.seat);
        if (!a) break;
        const sym = cue.what === 'energy' ? '⚡' : cue.what === 'heal' ? '❤' : '★';
        this.float(a, `+${String(cue.amount)}${sym}`, FLOAT_COLORS[cue.what], 'light');
        this.dust.emit(a.x, 2.4, a.z, {
          count: 6,
          spread: 1.6,
          up: 2.8,
          size: 1.1,
          color: FLOAT_COLORS[cue.what],
          life: 0.8,
        });
        break;
      }
      case 'shield': {
        const a = this.actor(cue.seat);
        if (!a) break;
        this.shields.pop(a.x, a.z);
        this.float(a, `🛡-${String(cue.amount)}`, '#7de3ff', 'medium');
        break;
      }
      case 'card':
        this.runCard(cue);
        break;
      case 'ufo':
        this.runUfo(cue);
        break;
      case 'victory': {
        for (const seat of cue.seats) {
          const a = this.actor(seat);
          if (!a) continue;
          a.roar();
          this.debris.burst(a.x, 4.5, a.z, q.debris, 7, CONFETTI);
          this.waves.fire(a.x, a.z, 7, '#ffe27a', 0.9);
        }
        break;
      }
      case 'shot':
        if (this.cameraMotion) this.shotSpec = { spec: cue.spec, start: this.simMs, dur: cue.dur };
        break;
    }
  }

  /**
   * 商店飛碟已經停在場上（跟著商店開著入場，見 syncShop）：買牌時牌從光束飛向買家；
   * 清商店時舊牌被吸回、新牌滑進來由光束裡的牌自己換，這裡不用再演。
   */
  private runUfo(cue: Extract<Cue, { kind: 'ufo' }>): void {
    if (!this.cardFxOn || cue.reason !== 'buy' || cue.picked === null) return;
    const buyer = this.actor(cue.seat);
    this.ufo.deliver({
      picked: cue.picked,
      target: buyer ? { x: buyer.x, y: buyer.rig.height + 1.2, z: buyer.z } : { x: 0, y: 4, z: 0 },
      dur: (cue.dur * UFO_DELIVER_AT) / 1000,
    });
  }

  /**
   * 飛碟跟著商店狀態：買牌階段、有東西可買 → 入場並停著；否則 → 離場。
   * 只在「買牌／清商店的飛碟演出還沒播、或牌還在飛」時先不動，才不會牌還沒送到就先被換掉；
   * 其他演出（骰子、攻擊、別人的回合…）不擋——不然電腦玩家連續演出時，商店關了飛碟還賴著、開了卻遲遲不來。
   */
  private syncShop(): void {
    if (!this.cardFxOn || this.ufo.delivering || this.hasPendingUfoCue()) return;
    const shop = this.snapshot?.shop ?? null;
    const refresh = !shop?.length && this.snapshot?.shopRefresh === true;
    if (!refresh && (!shop || shop.length === 0)) {
      this.shopSince = null;
      this.ufo.undock();
      return;
    }
    this.shopSince ??= this.simMs;
    // 輪到我：馬上入場。別人（電腦）的買牌階段常常一下就結束，要連續開著一小段時間才入場，
    // 否則飛碟會剛飛進來就飛走，光束與牌一閃一閃。
    const mySeat = this.snapshot?.mySeat;
    const mine = mySeat !== undefined && mySeat !== null && mySeat === this.snapshot?.activeSeat;
    if (mine || this.ufo.docked || this.simMs - this.shopSince >= SHOP_OTHERS_DEBOUNCE_MS) {
      this.ufo.dock(refresh ? [] : (shop ?? []), refresh);
    }
  }

  /** 佇列裡還有沒播的飛碟演出（買牌的牌要先送到、清商店要先演完）。 */
  private hasPendingUfoCue(): boolean {
    return this.playing.some((p) => p.cues.slice(p.next).some((c) => c.kind === 'ufo'));
  }

  /** 卡牌：使用＝依內容的 3D 特效（流星、閃電、治療光柱…）；收下＝亮一下。 */
  private runCard(cue: Extract<Cue, { kind: 'card' }>): void {
    const a = this.actor(cue.seat);
    if (!a) return;
    if (!this.cardFxOn || cue.mode === 'bought' || cue.mode === 'triggered') {
      // 買到手／被動發動：輕量演出（被動發動用卡牌主題色，讓人看得出是哪一類效果）
      this.dust.emit(a.x, 2.6, a.z, {
        count: cue.mode === 'triggered' ? 14 : 10,
        spread: 2.2,
        up: 2,
        size: 1.2,
        color: cue.mode === 'triggered' ? THEME_STYLE[cue.theme].color : seatColor(cue.seat),
        life: 0.9,
      });
      if (this.cardFxOn) this.cardFx.pop(cue.cardId, a.x, a.z, a.rig.height * 0.8, false);
      return;
    }
    const alive = [...this.actors.values()].filter((x) => x.alive);
    const spot = (x: MonsterActor): { x: number; z: number } => ({ x: x.x, z: x.z });
    this.cardFx.play(
      cue.theme,
      spot(a),
      alive.filter((x) => x.seat !== cue.seat).map(spot),
      alive.map(spot),
    );
    this.cardFx.pop(cue.cardId, a.x, a.z, a.rig.height * 0.9, true);
  }

  private landed(_actor: MonsterActor, spot: Spot): void {
    // monsterSpot 對東京回傳的是同一個常數物件，可以直接比對
    const big = spot === CITY_SPOT || spot === BAY_SPOT;
    this.dust.emit(spot.x, 0.2, spot.z, {
      count: big ? 28 : 10,
      spread: big ? 4.5 : 2.5,
      up: 1.4,
      size: 2.8,
    });
    if (big) {
      this.waves.fire(spot.x, spot.z, 6.5);
      this.cracks.stamp(spot.x, spot.z, 6);
      this.debris.burst(spot.x, 0.6, spot.z, 10, 6, CONCRETE);
      if (this.cameraMotion) this.shake = Math.max(this.shake, 0.55);
    }
  }

  // ── DOM 疊層（名牌、浮動數字） ─────────────────────

  private refreshTags(): void {
    for (const seat of this.tags.keys()) this.refreshTag(seat);
  }

  private refreshTag(seat: number): void {
    const el = this.tags.get(seat);
    const m = this.snapshot?.monsters.find((x) => x.seat === seat);
    if (!el || !m || !this.snapshot) return;
    const hp = this.displayedHp.get(seat) ?? m.hp;
    const active = this.snapshot.activeSeat === seat;
    const mine = this.snapshot.mySeat === seat;
    const poison = m.tokens?.poison ?? 0;
    const shrink = m.tokens?.shrink ?? 0;
    const dizzy = m.dizzy ?? 0;
    const key = `${m.name}|${String(hp)}|${String(m.maxHp)}|${String(m.vp)}|${String(m.energy)}|${String(m.alive)}|${String(active)}|${String(mine)}|${String(poison)}|${String(shrink)}|${String(dizzy)}`;
    if (el.dataset['key'] === key) return;
    el.dataset['key'] = key;
    el.className = `kot-tag${active ? ' active' : ''}${m.alive ? '' : ' dead'}${mine ? ' mine' : ''}`;
    el.replaceChildren();
    const name = document.createElement('span');
    name.className = 'kot-tag-name';
    name.textContent = mine ? `${m.name}（你）` : m.name;
    const bar = document.createElement('span');
    bar.className = 'kot-tag-hp';
    const fill = document.createElement('i');
    fill.style.width = `${String(Math.max(0, Math.min(100, (hp / Math.max(1, m.maxHp)) * 100)))}%`;
    bar.appendChild(fill);
    const stats = document.createElement('span');
    stats.className = 'kot-tag-stats';
    stats.textContent = `❤${String(hp)} ★${String(m.vp)} ⚡${String(m.energy)}`;
    el.append(name, bar, stats);
    // 持續狀態：名牌下方一排圖示（☠ 中毒、🤏 縮小），數字是指示物數量
    if (m.alive && poison + shrink + dizzy > 0) {
      const row = document.createElement('span');
      row.className = 'kot-tag-status';
      for (const [kind, icon, label, n] of [
        ['poison', '☠', '中毒', poison],
        ['shrink', '🤏', '縮小', shrink],
        ['dizzy', '🥴', '震地：少擲骰子', dizzy],
      ] as const) {
        if (n <= 0) continue;
        const chip = document.createElement('span');
        chip.className = `kot-status ${kind}`;
        chip.title = `${label} ×${String(n)}`;
        chip.textContent = kind === 'dizzy' ? icon : `${icon}×${String(n)}`;
        row.appendChild(chip);
      }
      el.appendChild(row);
    }
  }

  private project(x: number, y: number, z: number): { sx: number; sy: number; ok: boolean } {
    this.tmp.set(x, y, z).project(this.camera);
    const w = this.opts.canvas.clientWidth;
    const h = this.opts.canvas.clientHeight;
    return {
      sx: (this.tmp.x * 0.5 + 0.5) * w,
      sy: (-this.tmp.y * 0.5 + 0.5) * h,
      ok: this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.2 && Math.abs(this.tmp.y) < 1.2,
    };
  }

  private float(
    actor: MonsterActor,
    text: string,
    color: string,
    power: 'light' | 'medium' | 'heavy',
  ): void {
    const p = this.project(actor.x, actor.rig.height + 0.4, actor.z);
    if (!p.ok) return;
    const el = document.createElement('div');
    el.className = `kot-float ${power}`;
    el.textContent = text;
    el.style.left = `${String(p.sx)}px`;
    el.style.top = `${String(p.sy)}px`;
    el.style.color = color;
    this.opts.overlay.appendChild(el);
    const remove = (): void => {
      el.remove();
    };
    el.addEventListener('animationend', remove, { once: true });
    window.setTimeout(remove, 2000);
  }

  // ── 主迴圈 ───────────────────────────────────────

  private readonly frame = (now: number): void => {
    if (this.disposed || this.lost) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden || !this.visible) {
      this.lastFrame = 0;
      return;
    }
    // 低畫質上限 30 FPS，省電也省 CPU
    const minGap = this.tier === 'low' ? 30 : 0;
    if (this.lastFrame !== 0 && now - this.lastFrame < minGap) return;
    const rawMs = this.lastFrame === 0 ? 16 : now - this.lastFrame;
    this.lastFrame = now;
    const dt = Math.min(rawMs, 50) / 1000;

    this.fpsWindow.push(rawMs);
    if (this.fpsWindow.length > 60) this.fpsWindow.shift();
    if (this.setting === 'auto' && this.degrade.push(rawMs)) {
      const next = lowerTier(this.tier);
      if (next) this.applyQuality(next);
    }

    this.realNow = now;
    const scale = now < this.hitstopUntil ? 0.04 : 1;
    const sdt = dt * scale;
    this.simMs += sdt * 1000;
    this.stepCues();

    const time = this.simMs / 1000;
    for (const [seat, a] of this.actors) {
      a.update(sdt, time);
      const blob = this.blobs.get(seat);
      if (blob) {
        blob.position.set(a.x, 0.08, a.z);
        // 飛在海上的怪獸：水面上留一圈淡淡的影子（不論畫質，才看得出離水多高）
        const flyingOverSea = a.atSea && a.stance === 'fly' && a.alive;
        blob.visible = flyingOverSea || QUALITY[this.tier].shadowMapSize === 0;
        (blob.material as MeshBasicMaterial).opacity = flyingOverSea ? 0.28 : 0.4;
      }
      const ripple = this.ripples.get(seat);
      if (ripple) {
        const wading = a.atSea && a.stance !== 'fly';
        ripple.visible = wading;
        if (wading) {
          const w = Math.sin(time * 2.2 + seat * 1.3);
          ripple.position.set(a.x, 0.1, a.z);
          ripple.scale.setScalar(1 + 0.1 * w);
          (ripple.material as MeshBasicMaterial).opacity = (a.alive ? 0.4 : 0.25) + 0.12 * w;
        }
      }
    }
    this.dust.update(sdt);
    this.debris.update(sdt);
    this.waves.update(sdt);
    this.cracks.update(sdt);
    this.attackFx.update(sdt, this.camera);
    this.shields.update(sdt);
    this.updateMarker(time);
    this.updateCelebration(sdt, time);
    this.updateCamera(dt);
    this.cardFx.update(sdt, this.camera);
    this.updateStatusFx(time);
    this.syncShop();
    this.ufo.update(sdt, this.camera, time);
    if (this.city) {
      this.city.waterTexture.offset.x = (time * 0.012) % 1;
      this.city.landmarks.update(time);
    }

    this.renderer.render(this.scene, this.camera);
    if (this.ufo.playing) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.overlayScene, this.camera);
      this.renderer.autoClear = true;
    }
    this.positionTags();
    this.frames++;
  };

  private stepCues(): void {
    while (this.playing.length > 0) {
      const p = this.playing[0];
      if (!p) break;
      const local = this.simMs - p.startAt;
      if (local < 0) break;
      while (p.next < p.cues.length && (p.cues[p.next]?.at ?? Infinity) <= local) {
        const c = p.cues[p.next++];
        if (c) this.run(c);
      }
      if (p.next >= p.cues.length && this.simMs >= p.endAt) {
        this.playing.shift();
        continue;
      }
      // 後續批次若已到開始時間也要處理，所以這裡不 break 的話會漏；批次是依序排好的
      break;
    }
    if (this.shotSpec && this.simMs - this.shotSpec.start > this.shotSpec.dur) this.shotSpec = null;
  }

  /** 持續性狀態特效：身上有毒／縮小指示物的活著的怪獸，持續冒毒霧／收縮光點。 */
  private updateStatusFx(time: number): void {
    const targets: StatusTarget[] = [];
    if (this.cardFxOn && this.snapshot) {
      for (const m of this.snapshot.monsters) {
        const poison = m.tokens?.poison ?? 0;
        const shrink = m.tokens?.shrink ?? 0;
        const a = this.actors.get(m.seat);
        if (!a || !m.alive || poison + shrink === 0) continue;
        targets.push({ seat: m.seat, x: a.x, z: a.z, height: a.height, poison, shrink });
      }
    }
    this.statusFx.update(time, targets);
  }

  /** 正在慶祝的勝者（遊戲結束、結算演出播完、本人還在場上）。 */
  private celebrants(): number[] {
    const winners = this.snapshot?.winners ?? [];
    if (winners.length === 0 || this.playing.length > 0) return [];
    return winners.filter((seat) => this.actors.has(seat));
  }

  private clearCrowns(): void {
    for (const c of this.crowns.values()) {
      c.group.removeFromParent();
      c.dispose();
    }
    this.crowns.clear();
  }

  /** 勝利慶祝：勝者戴上皇冠，持續撒彩帶、噴金色光點、放金色衝擊波，偶爾咆哮。 */
  private updateCelebration(dt: number, time: number): void {
    const seats = this.celebrants();
    for (const [seat, c] of this.crowns) {
      if (seats.includes(seat)) continue;
      c.group.removeFromParent();
      c.dispose();
      this.crowns.delete(seat);
    }
    if (seats.length === 0) return;
    const q = QUALITY[this.tier];
    const t = this.celebrate;
    t.confetti += dt;
    t.wave += dt;
    t.spark += dt;
    t.roar += dt;
    for (const seat of seats) {
      const a = this.actors.get(seat);
      if (!a) continue;
      let crown = this.crowns.get(seat);
      if (!crown) {
        // 戴在頭上：依頭的大小決定皇冠尺寸，跟著頭轉；量不到頭就放在身高上方
        const box = headBounds(a.rig.head);
        if (box) {
          const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
          const scale = Math.min(1, Math.max(0.4, (size * 0.5) / 0.95));
          crown = buildCrown(seatColor(seat), box.max.y + 0.2 * scale, scale);
          crown.group.position.x = (box.min.x + box.max.x) / 2;
          crown.group.position.z = (box.min.z + box.max.z) / 2;
          a.rig.head.add(crown.group);
        } else {
          crown = buildCrown(seatColor(seat), a.rig.height / MONSTER_SCALE + 0.35);
          a.rig.root.add(crown.group);
        }
        this.crowns.set(seat, crown);
      }
      crown.update(time);
      if (t.confetti >= 0.4) {
        this.debris.burst(a.x, a.rig.height + 0.3, a.z, Math.ceil(q.debris * 0.5), 6, CONFETTI);
      }
      if (t.spark >= 0.1) {
        this.dust.emit(a.x, a.rig.height + 0.4, a.z, {
          count: 2,
          spread: 2.4,
          up: 2.6,
          size: 0.9,
          color: '#ffe27a',
          life: 1.2,
        });
      }
      if (t.wave >= 1.6) this.waves.fire(a.x, a.z, 8, '#ffe27a', 1.1);
      if (t.roar >= 6) a.roar();
    }
    if (t.confetti >= 0.4) t.confetti = 0;
    if (t.spark >= 0.1) t.spark = 0;
    if (t.wave >= 1.6) t.wave = 0;
    if (t.roar >= 6) t.roar = 0;
  }

  private updateMarker(time: number): void {
    const seat = this.snapshot?.activeSeat ?? null;
    const a = seat === null ? undefined : this.actor(seat);
    const alive = a?.alive === true;
    this.marker.visible = alive;
    if (!a || !alive) return;
    this.marker.position.set(a.x, 0.1, a.z);
    (this.marker.material as MeshBasicMaterial).color.set(seatColor(a.seat));
    this.marker.scale.setScalar(1 + 0.07 * Math.sin(time * 4));
  }

  /** 總覽鏡頭：依畫面長寬比與人數，把所有怪獸、頭上名牌與飛行高度都收進畫面。 */
  private overviewPose(): CameraPose {
    return overviewPoseFor(this.camera.aspect, this.snapshot?.playerCount ?? 6);
  }

  private updateCamera(dt: number): void {
    const spotOf = (seat: number): Spot | undefined => {
      const a = this.actors.get(seat);
      return a ? { x: a.x, z: a.z, yaw: a.yaw } : undefined;
    };
    let desired = this.overviewPose();
    let rate = 2.2;
    const winners = this.celebrants();
    const winner =
      winners[Math.floor(this.simMs / VICTORY_SWITCH_MS) % Math.max(1, winners.length)];
    const wa = winner === undefined ? undefined : this.actors.get(winner);
    if (wa && this.cameraMotion) {
      // 遊戲結束：所有人的鏡頭鎖定勝者（不理會自己拖過的視角與跟隨開關），繞著他慢慢轉；
      // 多位勝者每 7 秒換一位。「減少動態」時不動鏡頭，只保留皇冠與特效。
      desired = victoryPose({ x: wa.x, z: wa.z, yaw: wa.yaw }, this.simMs);
      rate = 2.4;
    } else if (this.viewCustom) {
      // 玩家掌控視角：不播自動鏡頭；拖曳中幾乎即時跟手
      desired = applyView(desired, clampView(this.view));
      rate = this.interacting ? 22 : 9;
    } else if (this.shotSpec && this.cameraMotion) {
      const t = (this.simMs - this.shotSpec.start) / this.shotSpec.dur;
      desired = poseFor(this.shotSpec.spec, spotOf, smoothstep(t));
      rate = 6;
    } else if (this.follow && this.cameraMotion) {
      // 沒有演出鏡頭時，跟著輪到行動的怪獸（它跳進東京、移動時鏡頭也跟著）
      const seat = this.snapshot?.activeSeat ?? null;
      const a = seat === null ? undefined : this.actors.get(seat);
      if (a?.alive === true) {
        desired = applyView(desired, followView({ x: a.x, z: a.z }, desired.lookAt));
        rate = 2.6;
      }
    }
    const k = 1 - Math.exp(-dt * rate);
    this.pose = blendPose(this.pose, desired, k);
    const { position: p, lookAt: l } = this.pose;
    let ox = 0;
    let oy = 0;
    if (this.shake > 0.001) {
      ox = (Math.random() - 0.5) * this.shake * 0.8;
      oy = (Math.random() - 0.5) * this.shake * 0.8;
      this.shake *= Math.exp(-dt * 7);
    }
    this.camera.position.set(p.x + ox, p.y + oy, p.z);
    this.camera.lookAt(l.x, l.y, l.z);
    if (Math.abs(this.camera.fov - this.pose.fov) > 0.01) {
      this.camera.fov = this.pose.fov;
      this.camera.updateProjectionMatrix();
    }
    const viewScale =
      (this.opts.canvas.clientHeight * this.renderer.getPixelRatio()) /
      (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.dust.setViewScale(viewScale);
    this.statusFx.setViewScale(viewScale);
  }

  private positionTags(): void {
    for (const [seat, el] of this.tags) {
      const a = this.actors.get(seat);
      if (!a) continue;
      const p = this.project(a.x, a.lift + a.rig.height + (this.crowns.has(seat) ? 2.6 : 1.1), a.z);
      el.style.opacity = p.ok ? '' : '0';
      el.style.transform = `translate(${p.sx.toFixed(1)}px, ${p.sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}
