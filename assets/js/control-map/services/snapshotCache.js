const SNAPSHOT_DB_NAME = 'techloc-control-map-snapshots';
const SNAPSHOT_STORE_NAME = 'snapshots';
const SNAPSHOT_DB_VERSION = 1;
const SNAPSHOT_KEY = 'control-map';
const STATIC_SNAPSHOT_URL = new URL('../../../data/snapshots/control-map.json', import.meta.url).toString();

let snapshotState = {
  loaded: false,
  source: 'empty',
  generatedAt: '',
  tables: {},
};
let loadPromise = null;

const normalizeTableName = (value = '') => String(value || '').trim().toLowerCase();

const cloneRows = (rows = []) => {
  if (!Array.isArray(rows)) return [];
  try {
    return structuredClone(rows);
  } catch (_error) {
    return JSON.parse(JSON.stringify(rows));
  }
};

const openSnapshotDb = () => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    resolve(null);
    return;
  }

  const request = indexedDB.open(SNAPSHOT_DB_NAME, SNAPSHOT_DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) {
      db.createObjectStore(SNAPSHOT_STORE_NAME, { keyPath: 'id' });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Unable to open snapshot cache.'));
});

const readPersistedSnapshot = async () => {
  const db = await openSnapshotDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE_NAME, 'readonly');
    const request = tx.objectStore(SNAPSHOT_STORE_NAME).get(SNAPSHOT_KEY);
    request.onsuccess = () => resolve(request.result?.snapshot || null);
    request.onerror = () => reject(request.error || new Error('Unable to read snapshot cache.'));
    tx.oncomplete = () => db.close();
  });
};

const writePersistedSnapshot = async (snapshot) => {
  const db = await openSnapshotDb();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE_NAME, 'readwrite');
    tx.objectStore(SNAPSHOT_STORE_NAME).put({
      id: SNAPSHOT_KEY,
      savedAt: new Date().toISOString(),
      snapshot,
    });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Unable to persist snapshot cache.'));
    };
  });
};

const normalizeSnapshot = (snapshot = {}, source = 'unknown') => {
  const rawTables = snapshot?.tables && typeof snapshot.tables === 'object' ? snapshot.tables : {};
  const tables = {};
  Object.entries(rawTables).forEach(([tableName, value]) => {
    const rows = Array.isArray(value) ? value : Array.isArray(value?.rows) ? value.rows : [];
    if (!rows.length && !Array.isArray(value)) return;
    tables[normalizeTableName(tableName)] = {
      name: tableName,
      rows,
      updatedAt: value?.updatedAt || snapshot?.generatedAt || '',
      source: value?.source || source,
    };
  });
  return {
    loaded: true,
    source,
    generatedAt: snapshot?.generatedAt || snapshot?.createdAt || '',
    tables,
  };
};

const mergeSnapshots = (...snapshots) => {
  const merged = {
    loaded: true,
    source: snapshots.map((snapshot) => snapshot?.source).filter(Boolean).join('+') || 'empty',
    generatedAt: '',
    tables: {},
  };

  snapshots.filter(Boolean).forEach((snapshot) => {
    if (snapshot.generatedAt) merged.generatedAt = snapshot.generatedAt;
    Object.assign(merged.tables, snapshot.tables || {});
  });

  return merged;
};

const fetchStaticSnapshot = async () => {
  try {
    const response = await fetch(STATIC_SNAPSHOT_URL, { cache: 'no-cache' });
    if (!response.ok) return null;
    return normalizeSnapshot(await response.json(), 'static');
  } catch (_error) {
    return null;
  }
};

export const loadControlMapSnapshot = async ({ force = false } = {}) => {
  if (snapshotState.loaded && !force) return snapshotState;
  if (loadPromise && !force) return loadPromise;

  loadPromise = (async () => {
    const [staticSnapshot, persistedSnapshot] = await Promise.all([
      fetchStaticSnapshot(),
      readPersistedSnapshot().then((snapshot) => snapshot ? normalizeSnapshot(snapshot, 'indexeddb') : null).catch(() => null),
    ]);
    snapshotState = mergeSnapshots(staticSnapshot, persistedSnapshot);
    return snapshotState;
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
};

export const getControlMapSnapshotRows = (tableName) => {
  const normalized = normalizeTableName(tableName);
  const entry = snapshotState.tables?.[normalized];
  return entry?.rows?.length ? cloneRows(entry.rows) : [];
};

export const hasControlMapSnapshotRows = (tableName) => getControlMapSnapshotRows(tableName).length > 0;

export const setControlMapSnapshotRows = async (tableName, rows = [], { source = 'live' } = {}) => {
  if (!tableName || !Array.isArray(rows)) return;
  const normalized = normalizeTableName(tableName);
  const nextState = {
    loaded: true,
    source: snapshotState.source || source,
    generatedAt: new Date().toISOString(),
    tables: {
      ...(snapshotState.tables || {}),
      [normalized]: {
        name: tableName,
        rows: cloneRows(rows),
        updatedAt: new Date().toISOString(),
        source,
      },
    },
  };
  snapshotState = nextState;
  await writePersistedSnapshot({
    version: 1,
    generatedAt: nextState.generatedAt,
    tables: Object.fromEntries(
      Object.values(nextState.tables).map((entry) => [entry.name, {
        updatedAt: entry.updatedAt,
        source: entry.source,
        rows: entry.rows,
      }])
    ),
  }).catch(() => {});
};

export const getControlMapSnapshotInfo = () => ({
  source: snapshotState.source,
  generatedAt: snapshotState.generatedAt,
  tables: Object.fromEntries(
    Object.entries(snapshotState.tables || {}).map(([key, entry]) => [key, {
      name: entry.name,
      rows: Array.isArray(entry.rows) ? entry.rows.length : 0,
      updatedAt: entry.updatedAt,
      source: entry.source,
    }])
  ),
});
