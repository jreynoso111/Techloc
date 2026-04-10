const DATA_SYNC_EVENT_NAME = 'techloc:data-sync';
const DATA_SYNC_STORAGE_KEY = 'techloc:data-sync:v1';

const safeNowIso = () => new Date().toISOString();

export const emitDataSyncSignal = ({ scope = 'all', source = 'unknown', detail = {} } = {}) => {
  const payload = {
    scope: String(scope || 'all'),
    source: String(source || 'unknown'),
    detail: detail && typeof detail === 'object' ? detail : {},
    emittedAt: safeNowIso(),
  };

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DATA_SYNC_EVENT_NAME, { detail: payload }));
    try {
      window.localStorage?.setItem(DATA_SYNC_STORAGE_KEY, JSON.stringify(payload));
    } catch (_error) {
      // Non-blocking: same-tab CustomEvent is enough when storage is unavailable.
    }
  }

  return payload;
};

export const subscribeDataSyncSignal = (callback) => {
  if (typeof window === 'undefined' || typeof callback !== 'function') {
    return () => {};
  }

  const handleCustomEvent = (event) => {
    callback(event?.detail || null);
  };

  const handleStorageEvent = (event) => {
    if (event?.key !== DATA_SYNC_STORAGE_KEY || !event.newValue) return;
    try {
      callback(JSON.parse(event.newValue));
    } catch (_error) {
      // Ignore malformed payloads.
    }
  };

  window.addEventListener(DATA_SYNC_EVENT_NAME, handleCustomEvent);
  window.addEventListener('storage', handleStorageEvent);

  return () => {
    window.removeEventListener(DATA_SYNC_EVENT_NAME, handleCustomEvent);
    window.removeEventListener('storage', handleStorageEvent);
  };
};
