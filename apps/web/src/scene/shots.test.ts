import { describe, expect, it } from 'vitest';
import { BAY_SPOT, CITY_SPOT, ringSpot, type Spot } from './layout.js';
import { MONSTER_HEIGHT, OVERVIEW_POSE, blendPose, poseFor, smoothstep } from './shots.js';

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
