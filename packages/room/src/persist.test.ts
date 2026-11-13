import { describe, expect, it } from 'vitest';
import { createMemoryRoomStore, parseHostSave, RoomSaver, type HostSave } from './persist.js';

const save = (n: number): HostSave => ({
  version: 1,
  hostKey: 'a'.repeat(32),
  savedAt: n,
  replica: {
    version: 1,
    epoch: 0,
    code: 'ABCDE',
    cardSetId: 'c',
    cardSetHash: 'h',
    phase: 'lobby',
    hostId: 'p1',
    botSerial: 0,
    members: [],
    seed: null,
    config: null,
    actions: [],
  } as unknown as HostSave['replica'],
});

describe('RoomSaver', () => {
  it('合併連續的存檔請求，只寫最新內容', async () => {
    const store = createMemoryRoomStore();
    let n = 0;
    const saver = new RoomSaver(store, () => save((n += 1)));
    saver.request('ABCDE');
    saver.request('ABCDE');
    saver.request('ABCDE');
    await saver.flush();
    expect(n).toBe(1);
    expect(store.size).toBe(1);
  });

  it('remove 之後的存檔請求不會把檔案寫回去', async () => {
    const store = createMemoryRoomStore();
    const saver = new RoomSaver(store, () => save(1));
    saver.request('ABCDE');
    await saver.flush();
    saver.remove('ABCDE');
    saver.request('ABCDE');
    await saver.flush();
    expect(store.size).toBe(0);
  });

  it('寫入失敗交給 onError，不中斷後續寫入', async () => {
    const errors: unknown[] = [];
    const store = createMemoryRoomStore();
    let failOnce = true;
    const flaky = {
      ...store,
      save: (code: string, s: HostSave) => {
        if (failOnce) {
          failOnce = false;
          return Promise.reject(new Error('quota'));
        }
        return store.save(code, s);
      },
    };
    const saver = new RoomSaver(
      flaky,
      () => save(1),
      (e) => errors.push(e),
    );
    saver.request('ABCDE');
    await saver.flush();
    saver.request('ABCDE');
    await saver.flush();
    expect(errors).toHaveLength(1);
    expect(store.size).toBe(1);
  });
});

describe('parseHostSave', () => {
  it('接受合法存檔，拒絕外形不對的資料', () => {
    expect(parseHostSave(JSON.parse(JSON.stringify(save(1))))).not.toBeNull();
    expect(parseHostSave({ version: 1 })).toBeNull();
    expect(parseHostSave('x')).toBeNull();
  });
});
