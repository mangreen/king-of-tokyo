import { describe, expect, it } from 'vitest';
import { defaultPrefs, parsePrefs, seedFromCode } from './prefs.js';
import { toSnapshot } from './snapshot.js';

describe('scene prefs', () => {
  it('沒有儲存值 → 預設（自動畫質；減少動態偏好時關閉鏡頭運動）', () => {
    expect(parsePrefs(null, false)).toEqual({
      enabled: true,
      quality: 'auto',
      cameraMotion: true,
      follow: true,
      attackFx: true,
      cardFx: true,
      danmaku: true,
      danmakuOpacity: 0.75,
      danmakuSize: 22,
      danmakuSpeed: 1,
    });
    expect(parsePrefs(null, true).cameraMotion).toBe(false);
    expect(parsePrefs(null, true).danmaku).toBe(false);
    expect(defaultPrefs(false).enabled).toBe(true);
  });

  it('正常讀回，壞資料逐欄退回預設', () => {
    expect(
      parsePrefs('{"enabled":false,"quality":"low","cameraMotion":false,"follow":false}', false),
    ).toEqual({
      enabled: false,
      quality: 'low',
      cameraMotion: false,
      follow: false,
      attackFx: true,
      cardFx: true,
      danmaku: true,
      danmakuOpacity: 0.75,
      danmakuSize: 22,
      danmakuSpeed: 1,
    });
    expect(parsePrefs('{"attackFx":false}', false).attackFx).toBe(false);
    // 彈幕：開關、透明度與大小；超出範圍夾回、壞值退回預設
    const dm = parsePrefs('{"danmaku":false,"danmakuOpacity":0.4,"danmakuSize":30}', false);
    expect([dm.danmaku, dm.danmakuOpacity, dm.danmakuSize]).toEqual([false, 0.4, 30]);
    const clamped = parsePrefs('{"danmakuOpacity":9,"danmakuSize":1}', false);
    expect([clamped.danmakuOpacity, clamped.danmakuSize]).toEqual([1, 14]);
    const sp = parsePrefs('{"danmakuSpeed":2.5}', false);
    expect(sp.danmakuSpeed).toBe(2.5);
    expect(parsePrefs('{"danmakuSpeed":99}', false).danmakuSpeed).toBe(3);
    expect(parsePrefs('{"danmakuSpeed":0}', false).danmakuSpeed).toBe(0.4);
    expect(parsePrefs('{"danmakuSpeed":"fast"}', false).danmakuSpeed).toBe(1);
    const bad = parsePrefs('{"danmakuOpacity":"x","danmakuSize":null}', false);
    expect([bad.danmakuOpacity, bad.danmakuSize]).toEqual([0.75, 22]);
    // 舊版偏好沒有 follow 欄位 → 預設開啟
    expect(parsePrefs('{"enabled":true,"quality":"auto","cameraMotion":true}', false).follow).toBe(
      true,
    );
    expect(parsePrefs('{"enabled":"yes","quality":"ultra","cameraMotion":1}', false)).toEqual(
      defaultPrefs(false),
    );
    expect(parsePrefs('not json', false)).toEqual(defaultPrefs(false));
    expect(parsePrefs('42', false)).toEqual(defaultPrefs(false));
    expect(parsePrefs('null', true)).toEqual(defaultPrefs(true));
  });

  it('seedFromCode 穩定且不同房間不同', () => {
    expect(seedFromCode('ABCD')).toBe(seedFromCode('ABCD'));
    expect(seedFromCode('ABCD')).not.toBe(seedFromCode('ABCE'));
    expect(seedFromCode('')).toBeGreaterThanOrEqual(0);
  });
});

describe('toSnapshot', () => {
  it('帶入暱稱、自己的座位、行動座位與每隻怪獸的狀態', () => {
    const snap = toSnapshot(
      {
        players: [
          { id: 'a', nickname: 'Ann', seat: 0 },
          { id: 'b', nickname: 'Bob', seat: 1 },
        ] as never,
      },
      {
        config: { playerCount: 3 } as never,
        monsters: [
          { seat: 0, hp: 7, maxHp: 10, vp: 2, energy: 1, alive: true, location: 'city' },
          { seat: 2, hp: 0, maxHp: 10, vp: 0, energy: 0, alive: false, location: null },
        ] as never,
      },
      1,
      'b',
    );
    expect(snap).toMatchObject({ playerCount: 3, activeSeat: 1, mySeat: 1 });
    expect(snap.monsters[0]).toMatchObject({ name: 'Ann', hp: 7, location: 'city' });
    expect(snap.monsters[1]?.name).toBe('座位 2');
    expect(
      toSnapshot({ players: [] }, { config: { playerCount: 2 } as never, monsters: [] }, null, 'x')
        .mySeat,
    ).toBeNull();
  });
});

describe('toSnapshot：震地暈眩', () => {
  const monsters = [0, 1, 2].map((seat) => ({
    seat,
    hp: 10,
    maxHp: 10,
    vp: 0,
    energy: 0,
    alive: seat !== 2,
    location: null,
  }));
  const snap = (stomp: number[] | undefined) =>
    toSnapshot(
      { players: [] },
      {
        config: { playerCount: 3 } as never,
        monsters: monsters as never,
        ...(stomp ? { stomp } : {}),
      },
      0,
      'x',
    );
  it('持有者以外的存活怪獸暈眩；持有者自己、淘汰者不暈眩', () => {
    expect(snap([0]).monsters.map((m) => m.dizzy)).toEqual([0, 1, 0]);
  });
  it('沒有效果（或沒給 stomp）：全部是 0', () => {
    expect(snap([]).monsters.map((m) => m.dizzy)).toEqual([0, 0, 0]);
    expect(snap(undefined).monsters.map((m) => m.dizzy)).toEqual([0, 0, 0]);
  });
  it('兩個持有者：各自被對方影響一層、旁人兩層', () => {
    expect(snap([0, 1]).monsters.map((m) => m.dizzy)).toEqual([1, 1, 0]);
  });
});
