import type { BufferAttribute, BufferGeometry } from 'three';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
  type CanvasTexture,
  type Material,
  type Texture,
} from 'three';
import {
  CLASS_COUNT,
  FLOOR_COUNTS,
  FLOOR_HEIGHT,
  FOOTPRINTS,
  TINT_COUNT,
  classKey,
  generateCity,
  type BuildingPlan,
} from './cityPlan.js';
import { buildLandmarks, type Landmarks } from './landmarks.js';
import {
  ODAIBA,
  ODAIBA_RADIUS,
  PALACE,
  PLAZA_RADIUS,
  RIVER_HALF_WIDTH,
  RIVER_MOUTH_Z,
  riverX,
  shoreX,
} from './layout.js';
import {
  makeFacadeTexture,
  makeGroundTexture,
  makeIslandTexture,
  makePalaceTexture,
  makePlazaTexture,
  makeSkyTexture,
  makeWaterTexture,
} from './textures.js';

/** 建築色調（乘在立面紋理上）。偏暖的混凝土與玻璃色。 */
const TINTS = ['#ffffff', '#f2dcc0', '#c9d8e6', '#e6c8c0', '#d6e2c8', '#bfc6d8'] as const;
const GROUND_SIZE_PERIODS = 8;

/**
 * 一種尺寸的建築幾何：側面的窗格 UV 烘進幾何（每 1.2 單位重複一次紋理），
 * 屋頂用另一個 group 對應純色材質。沒有底面（看不到）。
 */
export function makeBuildingGeometry(footprint: number, floors: number): BufferGeometry {
  const f = FOOTPRINTS[footprint] ?? FOOTPRINTS[0]!;
  const h = (FLOOR_COUNTS[floors] ?? FLOOR_COUNTS[0]!) * FLOOR_HEIGHT;
  const box = new BoxGeometry(f.w, h, f.d);
  box.translate(0, h / 2, 0);

  // BoxGeometry 面的順序：+x, -x, +y, -y, +z, -z（各 6 個索引）。重排成 側面 → 屋頂，丟掉底面。
  const idx = box.getIndex();
  if (!idx) throw new Error('BoxGeometry should be indexed');
  const src = idx.array;
  const pick = (face: number): number[] => Array.from(src.slice(face * 6, face * 6 + 6));
  const order = [...pick(0), ...pick(1), ...pick(4), ...pick(5), ...pick(2)];
  box.setIndex(order);
  box.clearGroups();
  box.addGroup(0, 24, 0);
  box.addGroup(24, 6, 1);

  // 側面 UV：水平 = 邊長 / 1.2，垂直 = 高度 / 1.2
  const uv = box.getAttribute('uv') as BufferAttribute;
  const faceUv = (face: number, wUnits: number): void => {
    for (let i = 0; i < 4; i++) {
      const k = face * 4 + i;
      uv.setXY(k, uv.getX(k) * (wUnits / 1.2), uv.getY(k) * (h / 1.2));
    }
  };
  faceUv(0, f.d);
  faceUv(1, f.d);
  faceUv(4, f.w);
  faceUv(5, f.w);
  uv.needsUpdate = true;
  return box;
}

export interface CityBuild {
  group: Group;
  dispose: () => void;
  /** 水面材質的紋理（每幀位移做流動）。 */
  waterTexture: CanvasTexture;
  landmarks: Landmarks;
  background: Texture;
  stats: { buildings: number; drawMeshes: number };
}

export interface CityOptions {
  seed: number;
  playerCount: number;
  density: number;
  /** 建築是否投射陰影（只有高畫質；怪獸陰影一律由渲染器決定）。 */
  castShadows: boolean;
}

export function buildCity(opts: CityOptions): CityBuild {
  const group = new Group();
  group.name = 'city';
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T): T => {
    disposables.push(o);
    return o;
  };

  // ── 地面 ─────────────────────────────────────────
  const ground = makeGroundTexture();
  track(ground.texture);
  ground.texture.repeat.set(GROUND_SIZE_PERIODS, GROUND_SIZE_PERIODS);
  const groundSize = ground.period * GROUND_SIZE_PERIODS;
  const groundMat = track(new MeshLambertMaterial({ map: ground.texture }));
  const groundMesh = new Mesh(track(new PlaneGeometry(groundSize, groundSize)), groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  groundMesh.name = 'ground';
  group.add(groundMesh);

  // ── 東京市廣場 ────────────────────────────────────
  const plazaTex = track(makePlazaTexture());
  const plaza = new Mesh(
    track(new RingGeometry(0, PLAZA_RADIUS, 48)),
    track(new MeshLambertMaterial({ map: plazaTex })),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.03;
  plaza.receiveShadow = true;
  plaza.name = 'plaza';
  group.add(plaza);

  // ── 水域：東京灣（海岸線以東）、隅田川 ─────────────────
  const waterTexture = track(makeWaterTexture());
  waterTexture.repeat.set(14, 14);
  const waterMat = track(
    new MeshLambertMaterial({ map: waterTexture, side: DoubleSide, color: '#9fd0e8' }),
  );
  const bay = new Shape();
  bay.moveTo(shoreX(-95), -95);
  for (let z = -95; z <= 95; z += 1.5) bay.lineTo(shoreX(z), z);
  bay.lineTo(140, 95);
  bay.lineTo(140, -95);
  const bayGeo = track(new ShapeGeometry(bay));
  bayGeo.rotateX(Math.PI / 2); // (x, y) → (x, 0, y)：Shape 的 y 就是世界 z
  const water = new Mesh(bayGeo, waterMat);
  water.position.y = 0.04;
  water.name = 'bay';
  group.add(water);

  const river = new Shape();
  const zs: number[] = [];
  for (let z = -95; z <= RIVER_MOUTH_Z + 2; z += 1.5) zs.push(z);
  river.moveTo(riverX(zs[0] ?? -95) - RIVER_HALF_WIDTH, zs[0] ?? -95);
  for (const z of zs) river.lineTo(riverX(z) - RIVER_HALF_WIDTH, z);
  for (const z of [...zs].reverse()) river.lineTo(riverX(z) + RIVER_HALF_WIDTH, z);
  const riverGeo = track(new ShapeGeometry(river));
  riverGeo.rotateX(Math.PI / 2);
  const riverMesh = new Mesh(riverGeo, waterMat);
  riverMesh.position.y = 0.045;
  riverMesh.name = 'sumida';
  group.add(riverMesh);

  // ── 台場（東京灣的站位）：人工島＋地面標示 ─────────────
  const island = new Mesh(
    track(new CylinderGeometry(ODAIBA_RADIUS, ODAIBA_RADIUS + 0.3, 0.55, 40)),
    track(new MeshLambertMaterial({ color: '#8c8576' })),
  );
  island.position.set(ODAIBA.x, 0.22, ODAIBA.z);
  island.receiveShadow = true;
  island.name = 'odaiba';
  group.add(island);
  const islandTop = new Mesh(
    track(new RingGeometry(0, ODAIBA_RADIUS - 0.1, 48)),
    track(new MeshLambertMaterial({ map: track(makeIslandTexture()) })),
  );
  islandTop.rotation.x = -Math.PI / 2;
  islandTop.position.set(ODAIBA.x, 0.51, ODAIBA.z);
  islandTop.receiveShadow = true;
  group.add(islandTop);

  // ── 皇居綠地（北方） ─────────────────────────────
  const palace = new Mesh(
    track(new PlaneGeometry(12, 9)),
    track(new MeshLambertMaterial({ map: track(makePalaceTexture()) })),
  );
  palace.rotation.x = -Math.PI / 2;
  palace.position.set(PALACE.x, 0.05, PALACE.z);
  palace.receiveShadow = true;
  palace.name = 'palace';
  group.add(palace);

  // ── 地標：東京鐵塔、晴空塔、彩虹大橋、摩天輪 ───────────
  const landmarks = buildLandmarks();
  track(landmarks);
  group.add(landmarks.group);

  // ── 建築：每種尺寸一個 InstancedMesh ───────────────
  const facade = track(makeFacadeTexture());
  const sideMat = track(new MeshLambertMaterial({ map: facade }));
  const roofMat = track(new MeshLambertMaterial({ color: '#9b958a' }));
  const plans = generateCity(opts.seed, opts.playerCount, opts.density);
  const buckets: BuildingPlan[][] = Array.from({ length: CLASS_COUNT }, () => []);
  for (const b of plans) buckets[classKey(b)]?.push(b);

  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const one = new Vector3(1, 1, 1);
  const tint = new Color();
  let drawMeshes = 0;
  buckets.forEach((list, key) => {
    if (list.length === 0) return;
    const footprint = Math.floor(key / FLOOR_COUNTS.length);
    const floors = key % FLOOR_COUNTS.length;
    const geo = track(makeBuildingGeometry(footprint, floors));
    const mesh = track(new InstancedMesh(geo, [sideMat, roofMat] as Material[], list.length));
    mesh.name = `buildings-${String(key)}`;
    list.forEach((b, i) => {
      q.setFromAxisAngle(up, b.yaw);
      pos.set(b.x, 0, b.z);
      m.compose(pos, q, one);
      mesh.setMatrixAt(i, m);
      tint.set(TINTS[b.tint % TINT_COUNT] ?? '#ffffff');
      mesh.setColorAt(i, tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = opts.castShadows;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // 實例分散全場，包圍球等於整座城，剔除沒有意義
    group.add(mesh);
    drawMeshes += 2; // 側面＋屋頂兩個 group
  });

  const background = track(makeSkyTexture());
  return {
    group,
    dispose: () => {
      for (const d of disposables) d.dispose();
      group.clear();
    },
    waterTexture,
    landmarks,
    background,
    stats: { buildings: plans.length, drawMeshes },
  };
}
