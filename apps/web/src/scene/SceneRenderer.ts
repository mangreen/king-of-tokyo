import {
  AmbientLight,
  DirectionalLight,
  Fog,
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
import type { GameEvent } from '@kot/rules';
import { MonsterActor } from './actor.js';
import { buildCity, type CityBuild } from './city.js';
import { directEvents, type Cue } from './director.js';
import { AttackFxSystem, attackStyleOf } from './attackFx.js';
import { CrackSystem, DebrisSystem, DustSystem, ShieldSystem, ShockwaveSystem } from './effects.js';
import { Holds } from './holds.js';
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
  OVERVIEW_POSE,
  blendPose,
  poseFor,
  smoothstep,
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
  alive: boolean;
  hp: number;
  maxHp: number;
  vp: number;
  energy: number;
  location: SceneLocation;
}

export interface SceneSnapshot {
  playerCount: number;
  monsters: SceneMonster[];
  /** 目前行動中的座位（顯示腳下光環）。 */
  activeSeat: number | null;
  mySeat: number | null;
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
  private readonly blobTex: Texture = makeSoftDotTexture();
  private readonly blobs = new Map<number, Mesh>();
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
    const rebuild = !this.snapshot || this.snapshot.playerCount !== snap.playerCount;
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
    const { cues, duration } = directEvents(events);
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
    this.blobTex.dispose();
    this.marker.geometry.dispose();
    (this.marker.material as Material).dispose();
    for (const b of this.blobs.values()) {
      b.geometry.dispose();
      (b.material as Material).dispose();
    }
    this.blobs.clear();
    for (const el of this.tags.values()) el.remove();
    this.tags.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // ── 世界建構 ─────────────────────────────────────

  private rebuildWorld(playerCount: number): void {
    for (const a of this.actors.values()) {
      this.world.remove(a.rig.root);
      a.dispose();
    }
    this.actors.clear();
    for (const b of this.blobs.values()) {
      this.world.remove(b);
      b.geometry.dispose();
      (b.material as Material).dispose();
    }
    this.blobs.clear();
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
    const rig = buildMonster(m.seat, QUALITY[this.tier].segments);
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
    if (!this.holds.held(seat, 'hit')) this.displayedHp.set(seat, m.hp);
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
      for (const b of this.blobs.values()) b.visible = q.shadowMapSize === 0;
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
          attackStyleOf(cue.seat),
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
      case 'card': {
        const a = this.actor(cue.seat);
        if (a)
          this.dust.emit(a.x, 2.6, a.z, {
            count: 10,
            spread: 2.2,
            up: 2,
            size: 1.2,
            color: seatColor(cue.seat),
            life: 0.9,
          });
        break;
      }
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
    const key = `${m.name}|${String(hp)}|${String(m.maxHp)}|${String(m.vp)}|${String(m.energy)}|${String(m.alive)}|${String(active)}|${String(mine)}`;
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
      if (blob) blob.position.set(a.x, 0.08, a.z);
    }
    this.dust.update(sdt);
    this.debris.update(sdt);
    this.waves.update(sdt);
    this.cracks.update(sdt);
    this.attackFx.update(sdt, this.camera);
    this.shields.update(sdt);
    this.updateMarker(time);
    this.updateCamera(dt);
    if (this.city) {
      this.city.waterTexture.offset.x = (time * 0.012) % 1;
      this.city.landmarks.update(time);
    }

    this.renderer.render(this.scene, this.camera);
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

  private overviewPose(): CameraPose {
    const aspect = this.camera.aspect;
    // 窄螢幕（直向）把鏡頭拉遠，整個場景仍在畫面內
    const k = Math.max(1, Math.min(1.9, 1.55 / Math.max(0.4, aspect)));
    const { position: p, lookAt: l, fov } = OVERVIEW_POSE;
    return {
      position: { x: l.x + (p.x - l.x) * k, y: l.y + (p.y - l.y) * k, z: l.z + (p.z - l.z) * k },
      lookAt: l,
      fov,
    };
  }

  private updateCamera(dt: number): void {
    const spotOf = (seat: number): Spot | undefined => {
      const a = this.actors.get(seat);
      return a ? { x: a.x, z: a.z, yaw: a.yaw } : undefined;
    };
    let desired = this.overviewPose();
    let rate = 2.2;
    if (this.viewCustom) {
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
        desired = applyView(desired, followView({ x: a.x, z: a.z }, OVERVIEW_POSE.lookAt));
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
    this.dust.setViewScale(
      (this.opts.canvas.clientHeight * this.renderer.getPixelRatio()) /
        (2 * Math.tan((this.camera.fov * Math.PI) / 360)),
    );
  }

  private positionTags(): void {
    for (const [seat, el] of this.tags) {
      const a = this.actors.get(seat);
      if (!a) continue;
      const p = this.project(a.x, a.rig.height + 1.1, a.z);
      el.style.opacity = p.ok ? '' : '0';
      el.style.transform = `translate(${p.sx.toFixed(1)}px, ${p.sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}
