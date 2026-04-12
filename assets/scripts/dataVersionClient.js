import { emitDataSyncSignal } from './dataSyncSignal.js';

const normalizeTableName = (value = '') => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
const PENDING_STORAGE_KEY = 'techloc:data-version-pending:v1';
const PENDING_EVENT_NAME = 'techloc:data-version-pending';

const buildTablesParam = (tables = []) =>
  [...new Set((tables || []).map(normalizeTableName).filter(Boolean))].join(',');

const readPendingState = () => {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage?.getItem(PENDING_STORAGE_KEY) || '{}') || {};
  } catch (_error) {
    return {};
  }
};

const writePendingState = (state) => {
  if (typeof window === 'undefined') return;
  const payload = state && typeof state === 'object' ? state : {};
  try {
    window.localStorage?.setItem(PENDING_STORAGE_KEY, JSON.stringify(payload));
  } catch (_error) {
    // Non-blocking.
  }
  window.dispatchEvent(new CustomEvent(PENDING_EVENT_NAME, { detail: payload }));
};

export const getPendingDataVersions = () => readPendingState();

export const markDataVersionPending = ({ table, version } = {}) => {
  const normalizedTable = normalizeTableName(table);
  const normalizedVersion = Number(version || 0);
  if (!normalizedTable || !normalizedVersion) return;
  const state = readPendingState();
  const currentVersion = Number(state?.[normalizedTable]?.version || 0);
  if (currentVersion >= normalizedVersion) return;
  state[normalizedTable] = {
    table: normalizedTable,
    version: normalizedVersion,
    updatedAt: new Date().toISOString(),
  };
  writePendingState(state);
};

export const clearPendingDataVersion = ({ table, version = null } = {}) => {
  const normalizedTable = normalizeTableName(table);
  if (!normalizedTable) return;
  const state = readPendingState();
  if (!state[normalizedTable]) return;
  const currentVersion = Number(state[normalizedTable]?.version || 0);
  if (version !== null && Number(version || 0) < currentVersion) return;
  delete state[normalizedTable];
  writePendingState(state);
};

export const subscribePendingDataVersionState = (callback) => {
  if (typeof window === 'undefined' || typeof callback !== 'function') {
    return () => {};
  }
  const handler = (event) => {
    callback(event?.detail || readPendingState());
  };
  window.addEventListener(PENDING_EVENT_NAME, handler);
  window.addEventListener('storage', handler);
  callback(readPendingState());
  return () => {
    window.removeEventListener(PENDING_EVENT_NAME, handler);
    window.removeEventListener('storage', handler);
  };
};

export const fetchDataVersionSnapshot = async ({ tables = [] } = {}) => {
  const params = new URLSearchParams();
  const tablesParam = buildTablesParam(tables);
  if (tablesParam) params.set('tables', tablesParam);

  const response = await fetch(`/api/data-version/snapshot${params.toString() ? `?${params.toString()}` : ''}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Unable to fetch data version snapshot (${response.status}).`);
  }

  const payload = await response.json();
  return payload?.data?.versions || {};
};

export const subscribeToDataVersionStream = ({ tables = [], onVersion = null, onError = null } = {}) => {
  if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
    return () => {};
  }

  const params = new URLSearchParams();
  const tablesParam = buildTablesParam(tables);
  if (tablesParam) params.set('tables', tablesParam);

  const stream = new EventSource(`/api/data-version/stream${params.toString() ? `?${params.toString()}` : ''}`);

  const handleVersion = (event) => {
    try {
      const payload = JSON.parse(event?.data || '{}');
      const versions = payload?.snapshot?.versions || {};
      Object.entries(versions).forEach(([table, entry]) => {
        markDataVersionPending({
          table,
          version: Number(entry?.version || 0),
        });
      });
      emitDataSyncSignal({
        scope: tablesParam || 'all',
        source: 'data-version-stream',
        detail: payload,
      });
      if (typeof onVersion === 'function') onVersion(payload);
    } catch (error) {
      console.warn('Invalid data-version event payload.', error);
    }
  };

  const handleReady = (event) => {
    try {
      const payload = JSON.parse(event?.data || '{}');
      emitDataSyncSignal({
        scope: tablesParam || 'all',
        source: 'data-version-stream-ready',
        detail: payload,
      });
    } catch (error) {
      console.warn('Invalid data-version ready payload.', error);
    }
  };

  stream.addEventListener('version', handleVersion);
  stream.addEventListener('ready', handleReady);
  stream.onerror = (error) => {
    if (typeof onError === 'function') onError(error);
  };

  return () => {
    stream.removeEventListener('version', handleVersion);
    stream.removeEventListener('ready', handleReady);
    stream.close();
  };
};
