import { parseHostSave, type HostSave, type RoomStore } from '@kot/room';

const DB_NAME = 'kot-host';
const STORE = 'rooms';
/** 存檔超過這麼久沒更新就清掉（房主早就離開了，留著只佔空間，也含對局種子）。 */
export const SAVE_MAX_AGE_MS = 24 * 3_600_000;

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB 失敗'));
    };
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB 交易失敗'));
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error('IndexedDB 交易中止'));
    };
  });
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB 無法開啟'));
    };
    request.onblocked = () => {
      reject(new Error('IndexedDB 被其他分頁佔用'));
    };
  });
}

/**
 * 房主存檔的 IndexedDB 版（Worker 與主執行緒都能用）。儲存不可用（隱私模式、配額滿…）時
 * save 會丟例外（RoomSaver 會接住）、load 回傳 null：功能降級成「重新整理就結束這局」，不影響遊戲本身。
 * 讀出來的資料一律用 parseHostSave 驗證，壞資料等同沒有存檔。
 */
export function createIdbRoomStore(
  factory: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB,
  now: () => number = () => Date.now(),
): RoomStore & { prune(): Promise<void> } {
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (!factory) return Promise.reject(new Error('沒有 IndexedDB'));
    db ??= openDb(factory).catch((error: unknown) => {
      db = null; // 下次再試
      throw error;
    });
    return db;
  };

  return {
    async save(code, save) {
      const handle = await open();
      const tx = handle.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(save, code);
      await done(tx);
    },
    async load(code): Promise<HostSave | null> {
      try {
        const handle = await open();
        const tx = handle.transaction(STORE, 'readonly');
        const value: unknown = await wrap(tx.objectStore(STORE).get(code));
        return parseHostSave(value);
      } catch {
        return null;
      }
    },
    async remove(code) {
      const handle = await open();
      const tx = handle.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(code);
      await done(tx);
    },
    async prune() {
      try {
        const handle = await open();
        const tx = handle.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (!current) return;
          const save = parseHostSave(current.value);
          // 壞資料與過期資料一起清掉
          if (!save || now() - save.savedAt > SAVE_MAX_AGE_MS) current.delete();
          current.continue();
        };
        await done(tx);
      } catch {
        // 清不掉也不影響遊戲
      }
    },
  };
}
