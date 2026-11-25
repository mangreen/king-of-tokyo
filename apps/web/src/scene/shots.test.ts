import { describe, expect, it } from 'vitest';
import { BAY_SPOT, CITY_SPOT, MAX_SEATS, ringSpot, type Spot } from './layout.js';
import {
  MONSTER_HEIGHT,
  OVERVIEW_POSE,
  TAG_HALF_WIDTH,
  TAG_HEADROOM,
  blendPose,
  overviewPoseFor,
  overviewSpots,
  poseFor,
  projectNdc,
  smoothstep,
  victoryPose,
} from './shots.js';

const spots: Record<number, Spot> = { 0: CITY_SPOT, 1: ringSpot(1, 4), 2: BAY_SPOT };
const spotOf = (seat: number) => spots[seat];
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe('camera shots', () => {
  it('預設與沒有主角時都是高角度俯瞰', () => {
    expect(poseFor({ type: 'overview' }, spotOf)).toEqual(OVERVIEW_POSE);
    expect(poseFor({ type: 'closeUp', seat: 99 }, spotOf)).toEqual(OVERVIEW_POSE);
    expect(OVERVIEW_POSE.position.y).toBeGreaterThan(MONSTER_HEIGHT * 3);
  });

  it('低角度英雄：鏡頭低於怪獸頭部、在攻擊者背後、看向被攻擊者', () => {
    const pose = poseFor({ type: 'lowHero', seat: 1, targets: [0] }, spotOf);
    expect(pose.position.y).toBeLessThan(MONSTER_HEIGHT * 0.6);
    // 鏡頭比被攻擊者離攻擊者更近 → 在攻擊者這一側
    expect(dist(pose.position, spots[1]!)).toBeLessThan(dist(pose.position, spots[0]!));
    // 視線落點在兩者之間
    expect(dist(pose.lookAt, spots[0]!)).toBeLessThan(dist(spots[1]!, spots[0]!));
  });

  it('特寫：在怪獸前方、與頭同高', () => {
    const pose = poseFor({ type: 'closeUp', seat: 1 }, spotOf);
    expect(dist(pose.position, spots[1]!)).toBeCloseTo(8.5, 1);
    expect(pose.position.y).toBeGreaterThan(MONSTER_HEIGHT * 0.5);
    expect(pose.fov).toBeLessThan(OVERVIEW_POSE.fov);
  });

  it('環繞：半徑固定、角度隨進度改變', () => {
    const a = poseFor({ type: 'orbit', seat: 2 }, spotOf, 0);
    const b = poseFor({ type: 'orbit', seat: 2 }, spotOf, 1);
    expect(dist(a.position, spots[2]!)).toBeCloseTo(dist(b.position, spots[2]!));
    expect(dist(a.position, b.position)).toBeGreaterThan(5);
    // 超出 0–1 會被夾住
    expect(poseFor({ type: 'orbit', seat: 2 }, spotOf, 5)).toEqual(b);
  });

  it('推近：看著目標怪獸', () => {
    const pose = poseFor({ type: 'pushIn', seat: 1 }, spotOf);
    expect(pose.lookAt.x).toBeCloseTo(spots[1]!.x);
    expect(pose.lookAt.z).toBeCloseTo(spots[1]!.z);
  });

  it('blendPose / smoothstep 端點與夾限', () => {
    const p = poseFor({ type: 'closeUp', seat: 1 }, spotOf);
    expect(blendPose(OVERVIEW_POSE, p, 0)).toEqual(OVERVIEW_POSE);
    const end = blendPose(OVERVIEW_POSE, p, 1);
    expect(end.position.x).toBeCloseTo(p.position.x);
    expect(end.position.y).toBeCloseTo(p.position.y);
    expect(end.fov).toBeCloseTo(p.fov);
    expect(blendPose(OVERVIEW_POSE, p, 9)).toEqual(end);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5);
    expect(smoothstep(-1)).toBe(0);
  });
});

describe('勝利鏡頭', () => {
  const winner = ringSpot(1, 4);

  it('固定距離繞著勝者轉、視線落在勝者身上，時間越久角度越不同', () => {
    const a = victoryPose(winner, 0);
    const b = victoryPose(winner, 5000);
    expect(dist(a.position, winner)).toBeCloseTo(14, 5);
    expect(dist(b.position, winner)).toBeCloseTo(14, 5);
    expect(a.position).not.toEqual(b.position);
    expect(dist(a.lookAt, winner)).toBeCloseTo(0, 5);
    // 俯看：鏡頭比怪獸高，看向怪獸偏上的位置（皇冠要入鏡）
    expect(a.position.y).toBeGreaterThan(MONSTER_HEIGHT);
    expect(a.lookAt.y).toBeGreaterThan(MONSTER_HEIGHT * 0.8);
  });

  it('同一個時間點、同一位勝者，每個人算出的鏡位完全相同（鎖定）', () => {
    expect(victoryPose(winner, 12345)).toEqual(victoryPose({ ...winner }, 12345));
  });
});

describe('總覽鏡頭：所有怪獸與頭上名牌都入鏡', () => {
  const aspects = [0.45, 0.56, 0.75, 1, 1.33, 1.78, 2.4];

  it.each([2, 3, 4, 5, 6])('%i 人局：各種畫面比例下，腳、頭頂名牌、飛行高度都在畫面內', (n) => {
    for (const aspect of aspects) {
      const pose = overviewPoseFor(aspect, n);
      for (const [i, s] of overviewSpots(n).entries()) {
        const spot = `spot ${String(i)} aspect ${String(aspect)}`;
        const feet = projectNdc(pose, aspect, { x: s.x, y: -1.2, z: s.z });
        // 頭頂 + 名牌／狀態列／皇冠的空間 + 飛行抬高
        const top = projectNdc(pose, aspect, {
          x: s.x,
          y: MONSTER_HEIGHT + 3 + TAG_HEADROOM,
          z: s.z,
        });
        // 名牌左右兩端（名牌有寬度，不能只看中心點）
        const tagL = projectNdc(pose, aspect, {
          x: s.x - TAG_HALF_WIDTH,
          y: MONSTER_HEIGHT + 3 + 1.5,
          z: s.z,
        });
        const tagR = projectNdc(pose, aspect, {
          x: s.x + TAG_HALF_WIDTH,
          y: MONSTER_HEIGHT + 3 + 1.5,
          z: s.z,
        });
        for (const p of [feet, top, tagL, tagR]) {
          expect(p, spot).not.toBeNull();
          expect(Math.abs(p?.x ?? 9), spot).toBeLessThanOrEqual(1);
          expect(Math.abs(p?.y ?? 9), spot).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('橫向螢幕不會拉得太遠（怪獸夠大）：16:9 的距離與舊版總覽相近', () => {
    const p = overviewPoseFor(16 / 9, MAX_SEATS);
    const dist = Math.hypot(
      p.position.x - p.lookAt.x,
      p.position.y - p.lookAt.y,
      p.position.z - p.lookAt.z,
    );
    expect(dist).toBeLessThan(60);
    // 怪獸身高佔畫面高度的比例至少 6%
    const a = projectNdc(p, 16 / 9, { x: 19, y: 0, z: 10 });
    const b = projectNdc(p, 16 / 9, { x: 19, y: MONSTER_HEIGHT, z: 10 });
    expect(((b?.y ?? 0) - (a?.y ?? 0)) / 2).toBeGreaterThan(0.06);
  });

  it('直向螢幕自動拉遠；越窄拉得越遠', () => {
    const far = (a: number): number => overviewPoseFor(a, 6).position.y;
    expect(far(0.5)).toBeGreaterThan(far(0.75));
    expect(far(0.75)).toBeGreaterThan(far(1.78));
  });

  it('人數少時鏡頭更近（只涵蓋實際有人的位置）；同樣參數結果穩定', () => {
    expect(overviewPoseFor(1.78, 2).position.y).toBeLessThanOrEqual(
      overviewPoseFor(1.78, 6).position.y + 0.01,
    );
    expect(overviewPoseFor(1.78, 4)).toEqual(overviewPoseFor(1.78, 4));
  });

  it('預設姿態＝16:9、6 人局的適配結果；仍然是高角度俯瞰', () => {
    expect(OVERVIEW_POSE).toEqual(overviewPoseFor(16 / 9, MAX_SEATS));
    expect(OVERVIEW_POSE.position.y).toBeGreaterThan(MONSTER_HEIGHT * 3);
    expect(OVERVIEW_POSE.position.z).toBeGreaterThan(OVERVIEW_POSE.lookAt.z);
  });
});
