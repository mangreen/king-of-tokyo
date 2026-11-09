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
    });
    expect(parsePrefs(null, true).cameraMotion).toBe(false);
    expect(defaultPrefs(false).enabled).toBe(true);
  });

  it('正常讀回，壞資料逐欄退回預設', () => {
    expect(
      parsePrefs('{"enabled":false,"quality":"low","cameraMotion":false,"follow":false}', false),
    ).toEqual({ enabled: false, quality: 'low', cameraMotion: false, follow: false });
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
