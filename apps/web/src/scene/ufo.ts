import type { Object3D, PerspectiveCamera } from 'three';
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { UFO_DELIVER_AT } from './director.js';
import { disposeCardMesh, makeCardMesh, type CardFaces } from './cardShow.js';

/**
 * 商店飛碟（原創造型：淡紫色碟身、藍色玻璃罩、黃色圓燈、碟身側面的閃電徽章）。
 * 演出：從畫面右上飛入 → 停在城市上空打出黃色光束 → 光束裡飄著商店的三張牌 →
 * 買到的那張飛向買家（清商店時三張被吸回飛碟）→ 飛碟往左上飛走。
 * 純視覺；動畫只看進度 p（0–1），所以事件太多、時間軸被壓縮時整段會等比例變快。
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

const easeOut = (k: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
const easeIn = (k: number): number => Math.pow(Math.min(1, Math.max(0, k)), 2.2);
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const seg = (p: number, a: number, b: number): number =>
  Math.min(1, Math.max(0, (p - a) / (b - a)));

export interface UfoStart {
  /** 買到的牌（清商店時為 null）。 */
  picked: string | null;
  /** 光束裡要展示的牌（買牌：買到的＋商店裡其他的；清商店：被清掉的）。最多三張。 */
  shown: string[];
  /** 買家頭上的位置（牌飛去的終點）。 */
  target: { x: number; y: number; z: number };
  /** 整段演出秒數。 */
  dur: number;
}

interface Slot {
  mesh: Mesh;
  picked: boolean;
  x: number;
  phase: number;
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
  private readonly slots: Slot[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private state: { t: number; dur: number; start: UfoStart } | null = null;
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

    this.body.add(this.spin, this.badge);
    this.root.add(this.body, this.beam);
    parent.add(this.root);
  }

  get playing(): boolean {
    return this.state !== null;
  }

  start(opts: UfoStart): void {
    this.clearSlots();
    const shown = opts.shown.slice(0, 3);
    // 買到的牌放中間，其他的分在兩側
    const order: { id: string; picked: boolean }[] = [];
    const others = shown.filter((id) => id !== opts.picked);
    if (opts.picked !== null) {
      order.push({ id: opts.picked, picked: true });
      others.forEach((id, i) => {
        order.splice(i === 0 ? 0 : order.length, 0, { id, picked: false });
      });
    } else {
      for (const id of shown) order.push({ id, picked: false });
    }
    const xs = order.length === 3 ? SLOT_X : order.length === 2 ? [-1.8, 1.8] : [0];
    order.forEach((o, i) => {
      const mesh = makeCardMesh(this.faces.texture(o.id));
      mesh.visible = false;
      this.parent.add(mesh);
      this.slots.push({ mesh, picked: o.picked, x: xs[i] ?? 0, phase: i * 1.7 });
    });
    this.state = { t: 0, dur: Math.max(0.3, opts.dur), start: opts };
    this.root.visible = true;
  }

  /** 立即結束（跳過演出）。 */
  clear(): void {
    this.state = null;
    this.root.visible = false;
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
    const st = this.state;
    if (!st) return;
    st.t += dt;
    const p = st.t / st.dur;
    if (p >= 1) {
      this.clear();
      return;
    }
    camera.updateMatrixWorld();
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.upv.setFromMatrixColumn(camera.matrixWorld, 1);
    this.fwd.setFromMatrixColumn(camera.matrixWorld, 2).negate();

    // ── 飛碟本體（鏡頭空間：飛入 → 停住 → 飛走） ──
    const enter = easeOut(seg(p, 0, 0.22));
    const leave = easeIn(seg(p, 0.76, 1));
    const hover = enter >= 1 && leave === 0 ? Math.sin(time * 2.4) * 0.02 : 0;
    const nx = lerp(lerp(ENTER_NDC.x, HOVER_NDC.x, enter), EXIT_NDC.x, leave);
    const ny = lerp(lerp(ENTER_NDC.y, HOVER_NDC.y, enter), EXIT_NDC.y, leave) + hover;
    this.placeAt(camera, nx, ny, this.root.position);
    this.root.quaternion.copy(camera.quaternion);
    this.spin.rotation.y = time * 1.6;
    this.body.rotation.x = 0.95 + Math.sin(time * 1.3) * 0.03;
    this.body.rotation.z = (1 - enter) * -0.45 + leave * 0.45 + Math.sin(time * 1.8) * 0.04;
    this.lights.forEach((l, i) => {
      const on = Math.sin(time * 7 + i * 0.9) > -0.2;
      (l.material as MeshBasicMaterial).color.set(on ? '#ffd23f' : '#a8761a');
    });

    // ── 光束 ──
    const beamOn = easeOut(seg(p, 0.2, 0.3)) * (1 - easeIn(seg(p, 0.74, 0.8)));
    this.beam.visible = beamOn > 0.01;
    this.beam.scale.set(0.35 + 0.65 * beamOn, beamOn, 0.35 + 0.65 * beamOn);
    (this.beam.material as ShaderMaterial).uniforms['uOpacity']!.value = 0.55 * beamOn;

    // ── 卡牌 ──
    for (const s of this.slots) this.placeCard(s, p, time, camera, st.start);
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
    p: number,
    time: number,
    camera: PerspectiveCamera,
    start: UfoStart,
  ): void {
    const show = easeOut(seg(p, 0.26, 0.38));
    const bob = Math.sin(time * 2.2 + s.phase) * 0.35;
    // 待在光束裡的位置（跟著飛碟，沿螢幕左右／往下排開）
    this.home
      .copy(this.root.position)
      .addScaledVector(this.right, s.x)
      .addScaledVector(this.upv, -CARD_DROP + bob);
    let scale = CARD_SCALE * show;
    let alpha = show;
    this.tmp.copy(this.home);

    if (s.picked) {
      const k = seg(p, UFO_DELIVER_AT - 0.1, UFO_DELIVER_AT);
      if (k > 0) {
        // 飛向買家頭上（弧線上拋）
        const e = easeIn(k);
        this.tmp.set(start.target.x, start.target.y, start.target.z).lerp(this.home, 1 - e);
        this.tmp.addScaledVector(this.upv, Math.sin(Math.PI * e) * 3.2);
        scale = CARD_SCALE * (1 - 0.55 * e);
      } else {
        scale *= 1 + 0.08 * Math.sin(time * 6);
      }
      if (p >= UFO_DELIVER_AT) alpha = 0;
    } else {
      // 其他牌：待到飛碟離開前被吸回碟身
      const k = easeIn(seg(p, 0.62, 0.76));
      if (k > 0) {
        this.tmp.lerp(this.root.position, k);
        scale = CARD_SCALE * (1 - k);
      }
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
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
  }
}
