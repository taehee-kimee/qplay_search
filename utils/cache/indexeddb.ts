const DB_NAME = 'qplay-cache';
const DB_VERSION = 2;

type CacheStoreName = 'ocrAnswers_v2' | 'searchIndex_v3' | 'tessdata_v1';

interface CachedAnswerRecord {
  readonly qhash: string;
  readonly answer: string;
  readonly updatedAt: number;
}

interface CachedIndexRecord {
  readonly key: string;
  readonly payload: string;
  readonly updatedAt: number;
}

interface CachedBinaryRecord {
  readonly key: string;
  readonly payload: ArrayBuffer;
  readonly updatedAt: number;
}

const memoryAnswers = new Map<string, CachedAnswerRecord>();
const memoryIndexes = new Map<string, CachedIndexRecord>();
const memoryTessdata = new Map<string, CachedBinaryRecord>();

const MIGRATION_TIMEOUT_MS = 5000;
const WRITE_COALESCE_MS = 100;

const pendingWrites = new Map<string, { timer: number; record: CachedAnswerRecord | CachedIndexRecord | CachedBinaryRecord }>();

export async function getCachedAnswer(hash: string): Promise<string | null> {
  if (!isIndexedDbAvailable()) {
    const record = memoryAnswers.get(hash);
    return record?.answer ?? null;
  }

  const record = await withStore<CachedAnswerRecord | undefined>(
    'ocrAnswers_v2',
    'readonly',
    store => requestAsPromise(store.get(hash))
  );

  return record?.answer ?? null;
}

export async function setCachedAnswer(hash: string, answer: string): Promise<void> {
  const record: CachedAnswerRecord = { qhash: hash, answer, updatedAt: Date.now() };

  if (!isIndexedDbAvailable()) {
    memoryAnswers.set(hash, record);
    return;
  }

  await coalescedWrite('ocrAnswers_v2', hash, record);
}

export async function getCachedIndex(key: string): Promise<string | null> {
  if (!isIndexedDbAvailable()) {
    const record = memoryIndexes.get(key);
    return record?.payload ?? null;
  }

  const record = await withStore<CachedIndexRecord | undefined>(
    'searchIndex_v3',
    'readonly',
    store => requestAsPromise(store.get(key))
  );
  return record?.payload ?? null;
}

export async function setCachedIndex(key: string, payload: string): Promise<void> {
  const record: CachedIndexRecord = { key, payload, updatedAt: Date.now() };

  if (!isIndexedDbAvailable()) {
    memoryIndexes.set(key, record);
    return;
  }

  await coalescedWrite('searchIndex_v3', key, record);
}

export async function hasCachedTessdata(tag: string): Promise<boolean> {
  if (!isIndexedDbAvailable()) {
    return memoryTessdata.has(tag);
  }

  const record = await withStore<CachedBinaryRecord | undefined>(
    'tessdata_v1',
    'readonly',
    store => requestAsPromise(store.get(tag))
  );
  return record !== undefined;
}

export async function getCachedTessdata(tag: string): Promise<ArrayBuffer | null> {
  if (!isIndexedDbAvailable()) {
    return memoryTessdata.get(tag)?.payload ?? null;
  }

  const record = await withStore<CachedBinaryRecord | undefined>(
    'tessdata_v1',
    'readonly',
    store => requestAsPromise(store.get(tag))
  );
  return record?.payload ?? null;
}

export async function setCachedTessdata(tag: string, payload: ArrayBuffer): Promise<void> {
  const record: CachedBinaryRecord = { key: tag, payload, updatedAt: Date.now() };

  if (!isIndexedDbAvailable()) {
    memoryTessdata.set(tag, record);
    return;
  }

  await coalescedWrite('tessdata_v1', tag, record);
}

async function coalescedWrite(
  storeName: CacheStoreName,
  key: string,
  record: CachedAnswerRecord | CachedIndexRecord | CachedBinaryRecord
): Promise<void> {
  const pending = pendingWrites.get(key);
  if (pending) {
    window.clearTimeout(pending.timer);
  }

  const timer = window.setTimeout(async () => {
    pendingWrites.delete(key);
    try {
      await withStore(storeName, 'readwrite', store => requestAsPromise(store.put(record)));
    } catch (error) {
      console.warn(`IndexedDB 쓰기 실패 (${storeName}):`, error);
    }
  }, WRITE_COALESCE_MS);

  pendingWrites.set(key, { timer, record });
}

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function withStore<T>(
  storeName: CacheStoreName,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);
  const result = await executor(store);
  await completeTransaction(transaction);
  return result;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    const timeout = window.setTimeout(() => {
      reject(new Error('IndexedDB 초기화 타임아웃'));
    }, MIGRATION_TIMEOUT_MS);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('ocrAnswers_v2')) {
        database.createObjectStore('ocrAnswers_v2', { keyPath: 'qhash' });
      }
      if (!database.objectStoreNames.contains('searchIndex_v3')) {
        database.createObjectStore('searchIndex_v3', { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains('tessdata_v1')) {
        database.createObjectStore('tessdata_v1', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      window.clearTimeout(timeout);
      resolve(request.result);
    };

    request.onerror = () => {
      window.clearTimeout(timeout);
      reject(request.error ?? new Error('IndexedDB 초기화에 실패했습니다.'));
    };
  });
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 요청이 실패했습니다.'));
  });
}

function completeTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 트랜잭션이 실패했습니다.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 트랜잭션이 중단되었습니다.'));
  });
}

