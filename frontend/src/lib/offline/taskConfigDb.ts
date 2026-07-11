const DB_NAME = "sorotask-offline";
const DB_VERSION = 1;
const STORE = "task-configs";

export interface TaskConfig {
  id: string;
  contractAddress: string;
  functionName: string;
  interval: number;
  gasBalance: number;
  updatedAt: number;
}

export type SyncState = "pending" | "synced";

export interface StoredTaskConfig extends TaskConfig {
  syncState: SyncState;
}

export interface SyncResult {
  synced: number;
  failed: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("syncState", "syncState", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = op(tx.objectStore(STORE));
      let result: T;
      request.onsuccess = () => {
        result = request.result as T;
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveTaskConfig(config: TaskConfig): Promise<StoredTaskConfig> {
  const record: StoredTaskConfig = { ...config, syncState: "pending" };
  await run("readwrite", (store) => store.put(record));
  return record;
}

export function getTaskConfig(id: string): Promise<StoredTaskConfig | undefined> {
  return run("readonly", (store) => store.get(id));
}

export async function getAllTaskConfigs(): Promise<StoredTaskConfig[]> {
  return (await run<StoredTaskConfig[]>("readonly", (store) => store.getAll())) ?? [];
}

export async function getPendingConfigs(): Promise<StoredTaskConfig[]> {
  return (
    (await run<StoredTaskConfig[]>("readonly", (store) =>
      store.index("syncState").getAll("pending"),
    )) ?? []
  );
}

export async function markConfigSynced(id: string): Promise<void> {
  const existing = await getTaskConfig(id);
  if (!existing) return;
  await run("readwrite", (store) => store.put({ ...existing, syncState: "synced" }));
}

export async function deleteTaskConfig(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
}

function toConfig(stored: StoredTaskConfig): TaskConfig {
  return {
    id: stored.id,
    contractAddress: stored.contractAddress,
    functionName: stored.functionName,
    interval: stored.interval,
    gasBalance: stored.gasBalance,
    updatedAt: stored.updatedAt,
  };
}

// Flush every pending config through `push`. Each item is independent: a
// failure leaves that config pending for the next attempt and does not abort
// the rest of the batch.
export async function syncTaskConfigs(
  push: (config: TaskConfig) => Promise<void>,
): Promise<SyncResult> {
  const pending = await getPendingConfigs();
  let synced = 0;
  let failed = 0;

  for (const config of pending) {
    try {
      await push(toConfig(config));
      await markConfigSynced(config.id);
      synced++;
    } catch {
      failed++;
    }
  }

  return { synced, failed };
}
