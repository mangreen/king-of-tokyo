import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createMemoryRoomStore, type HostSave } from '@kot/room';
import { createIdbRoomStore, SAVE_MAX_AGE_MS } from './idbStore.js';

const hostKey = 'b'.repeat(32);
function save(code: string, savedAt: number): HostSave {
  return {
    version: 1,
    hostKey,
    savedAt,
    replica: {
      version: 1,
      epoch: 0,
      code,
      cardSetId: 'original',
      cardSetHash: 'h',
      phase: 'lobby',
      hostId: 'p1',
      botSerial: 0,
      members: [],
      seed: null,
      config: null,
      actions: [],
    } as unknown as HostSave['replica'],
  };
}

describe('IndexedDB 房主存檔', () => {
  it('存、讀、刪；沒有的房號回傳 null', async () => {
    const store = createIdbRoomStore(new IDBFactory());
    expect(await store.load('AAAAA')).toBeNull();
    await store.save('AAAAA', save('AAAAA', 1));
    expect((await store.load('AAAAA'))?.replica.code).toBe('AAAAA');
    await store.save('AAAAA', save('AAAAA', 2));
    expect((await store.load('AAAAA'))?.savedAt).toBe(2);
    await store.remove('AAAAA');
    expect(await store.load('AAAAA')).toBeNull();
  });

  it('資料重新開啟後仍在（不同 store 實例、同一個資料庫）', async () => {
    const factory = new IDBFactory();
    await createIdbRoomStore(factory).save('BBBBB', save('BBBBB', 1));
    expect((await createIdbRoomStore(factory).load('BBBBB'))?.hostKey).toBe(hostKey);
  });

  it('壞資料等同沒有存檔，prune 會把壞資料與過期資料清掉、留下新的', async () => {
    const factory = new IDBFactory();
    const now = 10 * SAVE_MAX_AGE_MS;
    const store = createIdbRoomStore(factory, () => now);
    await store.save('OLD11', save('OLD11', now - SAVE_MAX_AGE_MS - 1));
    await store.save('NEW11', save('NEW11', now - 1000));
    await store.save('BAD11', { junk: true } as unknown as HostSave);
    expect(await store.load('BAD11')).toBeNull();
    await store.prune();
    expect(await store.load('OLD11')).toBeNull();
    expect(await store.load('NEW11')).not.toBeNull();
    // 壞資料已被清除：直接開底層確認不會留著
    const raw = await new Promise<unknown>((resolve) => {
      const open = factory.open('kot-host', 1);
      open.onsuccess = () => {
        const get = open.result.transaction('rooms').objectStore('rooms').get('BAD11');
        get.onsuccess = () => {
          resolve(get.result);
        };
      };
    });
    expect(raw).toBeUndefined();
  });

  it('沒有 IndexedDB：load 回傳 null、save 丟例外（由存檔器接住）', async () => {
    const store = createIdbRoomStore(null);
    expect(await store.load('AAAAA')).toBeNull();
    await expect(store.save('AAAAA', save('AAAAA', 1))).rejects.toThrow();
    await expect(store.prune()).resolves.toBeUndefined();
  });

  it('與記憶體版行為一致（同一份契約）', async () => {
    for (const store of [createIdbRoomStore(new IDBFactory()), createMemoryRoomStore()]) {
      await store.save('CCCCC', save('CCCCC', 5));
      expect((await store.load('CCCCC'))?.savedAt).toBe(5);
      await store.remove('CCCCC');
      expect(await store.load('CCCCC')).toBeNull();
    }
  });
});
