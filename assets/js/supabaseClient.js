import { BACKEND_PROVIDER, SUPABASE_KEY, SUPABASE_URL, assertSupabaseTarget } from '../scripts/env.js';
import { notifyGlobalAlert } from '../scripts/globalAlerts.js';

const existingClient = typeof window !== 'undefined' ? window.supabaseClient : null;
const SESSION_STORAGE_KEY = 'techloc:insforge-session:v1';
const RECOVERY_TOKEN_STORAGE_KEY = 'techloc:insforge-recovery-token:v1';
const BASE_URL = String(SUPABASE_URL || '').trim().replace(/\/+$/, '');
const DEFAULT_FETCH_TIMEOUT_MS = 300_000;
const MAX_GET_URL_LENGTH = 3500;
const DEFAULT_IN_FILTER_CHUNK_SIZE = 60;
const JWT_REFRESH_SKEW_MS = 60_000;
const SILENT_REQUEST_HEADERS = {
  'x-techloc-silent-request': 'true',
};
const SESSION_EVENTS = {
  SIGNED_IN: 'SIGNED_IN',
  SIGNED_OUT: 'SIGNED_OUT',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  PASSWORD_RECOVERY: 'PASSWORD_RECOVERY',
};

const sessionListeners = new Set();

const canUseStorage = () =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const createFetchWithTimeout = (timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) => {
  if (typeof fetch !== 'function') return null;
  return async (resource, options = {}) => {
    const controller = new AbortController();
    const { signal, ...rest } = options || {};
    const timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs);

    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }

    try {
      return await fetch(resource, { ...rest, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };
};

const fetchWithTimeout = createFetchWithTimeout();

const parseJsonSafely = async (response) => {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
};

const isJwtLikeToken = (token = '') => String(token || '').split('.').length === 3;
const DEFAULT_PUBLIC_AUTH_TOKEN = isJwtLikeToken(SUPABASE_KEY) ? SUPABASE_KEY : '';

const parseResponseBody = async (response) => {
  const jsonPayload = await parseJsonSafely(response);
  if (jsonPayload !== null) return jsonPayload;
  try {
    const text = await response.text();
    return text ? { message: text } : null;
  } catch (_error) {
    return null;
  }
};

const pickErrorMessage = (payload, fallbackMessage = '') => {
  const candidates = [
    payload?.message,
    payload?.error_description,
    payload?.msg,
    payload?.hint,
    payload?.error?.message,
    payload?.error?.error_description,
    payload?.error?.msg,
    payload?.error,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return fallbackMessage || 'Request failed.';
};

const createError = (payload, fallbackMessage) => {
  if (!payload && fallbackMessage) return { message: fallbackMessage };
  return {
    message: pickErrorMessage(payload, fallbackMessage),
    details: payload || null,
  };
};

const isUnauthorizedTokenError = (response, payload) => {
  if (Number(response?.status) !== 401) return false;
  const message = String(payload?.message || payload?.error || '').toLowerCase();
  if (!message) return true;
  return message.includes('invalid token') || message.includes('unauthorized');
};

const getStoredSession = () => {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
};

const decodeJwtPayload = (token = '') => {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(normalized + padding));
  } catch (_error) {
    return null;
  }
};

const getJwtExpirationMs = (token = '') => {
  const exp = Number(decodeJwtPayload(token)?.exp || 0);
  if (!Number.isFinite(exp) || exp <= 0) return null;
  return exp * 1000;
};

const shouldRefreshSessionToken = (token = '') => {
  const expirationMs = getJwtExpirationMs(token);
  if (!expirationMs) return false;
  return expirationMs - Date.now() <= JWT_REFRESH_SKEW_MS;
};

const setStoredSession = (session) => {
  if (!canUseStorage()) return;
  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
};

const getRecoveryToken = () => {
  if (!canUseStorage()) return '';
  return String(window.localStorage.getItem(RECOVERY_TOKEN_STORAGE_KEY) || '').trim();
};

const setRecoveryTokenValue = (token = '') => {
  if (!canUseStorage()) return;
  if (token) {
    window.localStorage.setItem(RECOVERY_TOKEN_STORAGE_KEY, token);
    return;
  }
  window.localStorage.removeItem(RECOVERY_TOKEN_STORAGE_KEY);
};

const notifyAuthListeners = (event, session) => {
  sessionListeners.forEach((listener) => {
    try {
      listener(event, session);
    } catch (error) {
      console.warn('Session listener failed', error);
    }
  });
};

const serializeFilterValue = (value) => {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value ?? '');
};

const serializeInValues = (values = []) =>
  `(${values.map((value) => serializeFilterValue(value).replace(/,/g, '\\,')).join(',')})`;

const toPattern = (value = '') => String(value).replace(/%/g, '*');

const parseInFilterValues = (rawValue = '') => {
  const normalized = String(rawValue || '');
  if (!normalized.startsWith('in.(') || !normalized.endsWith(')')) return [];
  const body = normalized.slice(4, -1);
  if (!body) return [];
  return body.split(',').map((value) => value.replace(/\\,/g, ','));
};

const buildHeaders = ({ authToken, prefer, extra = {} } = {}) => {
  const resolvedAuthToken = String(authToken || DEFAULT_PUBLIC_AUTH_TOKEN || '').trim();
  const headers = {
    ...extra,
  };
  if (resolvedAuthToken) {
    headers.Authorization = `Bearer ${resolvedAuthToken}`;
  }
  if (prefer) headers.Prefer = prefer;
  return headers;
};

const normalizeProfile = (profile, fallbackEmail = '', fallbackUserId = '') => {
  const role = String(profile?.role || 'user').toLowerCase();
  const status = String(profile?.status || 'active').toLowerCase();
  return {
    id: profile?.id || fallbackUserId || null,
    email: profile?.email || fallbackEmail || null,
    name: profile?.name || null,
    role,
    status,
    background_mode: profile?.background_mode || null,
  };
};

const buildAppUser = (authUser = {}, profile = null) => {
  const normalizedProfile = normalizeProfile(profile, authUser?.email, authUser?.id);
  return {
    ...authUser,
    id: normalizedProfile.id || authUser?.id || null,
    email: authUser?.email || normalizedProfile.email || null,
    app_metadata: {
      ...(authUser?.app_metadata || {}),
      role: normalizedProfile.role,
      status: normalizedProfile.status,
      insforge_auth_id: authUser?.id || null,
    },
    user_metadata: {
      ...(authUser?.user_metadata || {}),
      role: normalizedProfile.role,
      status: normalizedProfile.status,
      name: normalizedProfile.name,
    },
    profile: {
      ...(authUser?.profile || {}),
      id: normalizedProfile.id,
      email: normalizedProfile.email,
      name: normalizedProfile.name,
      role: normalizedProfile.role,
      status: normalizedProfile.status,
      background_mode: normalizedProfile.background_mode,
    },
  };
};

const fetchProfileByField = async (field, value, authToken) => {
  if (!field || !value) return null;
  const url = new URL('/api/database/records/profiles', BASE_URL);
  url.searchParams.set('select', 'id,email,name,role,status,background_mode');
  url.searchParams.set('limit', '1');
  url.searchParams.set(field, `eq.${serializeFilterValue(value)}`);

  const response = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: buildHeaders({ authToken }),
  });
  const payload = await parseJsonSafely(response);
  if (!response.ok) return null;
  return Array.isArray(payload) && payload.length ? payload[0] : null;
};

const resolveProfileForAuthUser = async (authUser, authToken) => {
  if (!authUser) return null;
  const byEmail = await fetchProfileByField('email', authUser.email, authToken);
  if (byEmail) return byEmail;
  return fetchProfileByField('id', authUser.id, authToken);
};

const normalizeSession = (rawSession = null) => {
  if (!rawSession?.access_token || !rawSession?.user) return null;
  return {
    access_token: rawSession.access_token,
    refresh_token: rawSession.refresh_token || null,
    token_type: 'bearer',
    user: rawSession.user,
  };
};

const persistSession = (session, event = SESSION_EVENTS.SIGNED_IN) => {
  const normalized = normalizeSession(session);
  setStoredSession(normalized);
  notifyAuthListeners(event, normalized);
  return normalized;
};

const recoverSessionForUnauthorizedToken = async (failedAuthToken = '') => {
  const currentSession = getStoredSession();
  if (!currentSession?.access_token) {
    return { authToken: DEFAULT_PUBLIC_AUTH_TOKEN, recoveredSession: null };
  }

  if (failedAuthToken && currentSession.access_token !== failedAuthToken) {
    return { authToken: currentSession.access_token, recoveredSession: currentSession };
  }

  if (currentSession.refresh_token) {
    try {
      const response = await fetchWithTimeout(`${BASE_URL}/api/auth/refresh?client_type=desktop`, {
        method: 'POST',
        headers: buildHeaders({
          extra: { 'Content-Type': 'application/json', ...SILENT_REQUEST_HEADERS },
        }),
        body: JSON.stringify({ refreshToken: currentSession.refresh_token }),
      });
      const payload = await parseJsonSafely(response);
      if (response.ok) {
        const profile = await resolveProfileForAuthUser(payload?.user, payload?.accessToken);
        const user = buildAppUser(payload?.user, profile);
        const recoveredSession = persistSession(
          {
            access_token: payload?.accessToken || null,
            refresh_token: payload?.refreshToken || currentSession.refresh_token || null,
            user,
          },
          SESSION_EVENTS.TOKEN_REFRESHED
        );
        if (recoveredSession?.access_token) {
          return { authToken: recoveredSession.access_token, recoveredSession };
        }
      }
    } catch (_error) {
      // Fall through to public-key retry.
    }
  }

  persistSession(null, SESSION_EVENTS.SIGNED_OUT);
  setRecoveryTokenValue('');
  return { authToken: DEFAULT_PUBLIC_AUTH_TOKEN, recoveredSession: null };
};

const ensureActiveSession = async () => {
  const session = getStoredSession();
  if (!session?.access_token) return null;
  if (!isJwtLikeToken(session.access_token)) {
    persistSession(null, SESSION_EVENTS.SIGNED_OUT);
    return null;
  }

  if (shouldRefreshSessionToken(session.access_token)) {
    const recovery = await recoverSessionForUnauthorizedToken(session.access_token);
    return recovery?.recoveredSession || null;
  }

  const expirationMs = getJwtExpirationMs(session.access_token);
  if (expirationMs && expirationMs <= Date.now() && !session?.refresh_token) {
    persistSession(null, SESSION_EVENTS.SIGNED_OUT);
    return null;
  }

  return session;
};

class InsForgeQueryBuilder {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.operation = 'select';
    this.selectClause = '*';
    this.filters = [];
    this.limitValue = null;
    this.rangeFrom = null;
    this.rangeTo = null;
    this.orderBy = null;
    this.expectSingle = false;
    this.allowEmptySingle = false;
    this.countMode = null;
    this.headOnly = false;
    this.payload = null;
    this.selectAfterWrite = false;
    this.upsertOptions = null;
  }

  select(columns = '*', options = {}) {
    this.selectClause = columns || '*';
    this.countMode = options?.count || null;
    this.headOnly = Boolean(options?.head);
    if (this.operation !== 'select') this.selectAfterWrite = true;
    return this;
  }

  insert(values) {
    this.operation = 'insert';
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }

  upsert(values, options = {}) {
    this.operation = 'upsert';
    this.payload = Array.isArray(values) ? values : [values];
    this.upsertOptions = {
      onConflict: options?.onConflict || null,
      ignoreDuplicates: Boolean(options?.ignoreDuplicates),
    };
    return this;
  }

  update(values) {
    this.operation = 'update';
    this.payload = values || {};
    return this;
  }

  delete(options = {}) {
    this.operation = 'delete';
    this.countMode = options?.count || this.countMode || null;
    return this;
  }

  eq(column, value) {
    this.filters.push([column, `eq.${serializeFilterValue(value)}`]);
    return this;
  }

  neq(column, value) {
    this.filters.push([column, `neq.${serializeFilterValue(value)}`]);
    return this;
  }

  gt(column, value) {
    this.filters.push([column, `gt.${serializeFilterValue(value)}`]);
    return this;
  }

  gte(column, value) {
    this.filters.push([column, `gte.${serializeFilterValue(value)}`]);
    return this;
  }

  lt(column, value) {
    this.filters.push([column, `lt.${serializeFilterValue(value)}`]);
    return this;
  }

  lte(column, value) {
    this.filters.push([column, `lte.${serializeFilterValue(value)}`]);
    return this;
  }

  like(column, value) {
    this.filters.push([column, `like.${toPattern(value)}`]);
    return this;
  }

  ilike(column, value) {
    this.filters.push([column, `ilike.${toPattern(value)}`]);
    return this;
  }

  in(column, values) {
    this.filters.push([column, `in.${serializeInValues(values)}`]);
    return this;
  }

  is(column, value) {
    this.filters.push([column, `is.${serializeFilterValue(value)}`]);
    return this;
  }

  order(column, options = {}) {
    this.orderBy = {
      column,
      ascending: options?.ascending !== false,
    };
    return this;
  }

  limit(count) {
    this.limitValue = Number(count);
    return this;
  }

  range(from, to) {
    this.rangeFrom = Number(from);
    this.rangeTo = Number(to);
    return this;
  }

  single() {
    this.expectSingle = true;
    this.allowEmptySingle = false;
    return this;
  }

  maybeSingle() {
    this.expectSingle = true;
    this.allowEmptySingle = true;
    return this;
  }

  then(onFulfilled, onRejected) {
    return this.execute().then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    return this.execute().catch(onRejected);
  }

  finally(onFinally) {
    return this.execute().finally(onFinally);
  }

  buildRequest(authToken) {
    const url = new URL(`/api/database/records/${encodeURIComponent(this.table)}`, BASE_URL);
    const preferParts = [];
    const headers = {};
    let method = 'GET';
    let body = null;

    if (this.selectClause && (this.operation === 'select' || this.selectAfterWrite)) {
      url.searchParams.set('select', this.selectClause);
    }
    if (this.orderBy?.column) {
      url.searchParams.set('order', `${this.orderBy.column}.${this.orderBy.ascending ? 'asc' : 'desc'}`);
    }
    if (Number.isFinite(this.rangeFrom) && Number.isFinite(this.rangeTo)) {
      url.searchParams.set('offset', `${this.rangeFrom}`);
      url.searchParams.set('limit', `${Math.max(0, this.rangeTo - this.rangeFrom + 1)}`);
    } else if (Number.isFinite(this.limitValue)) {
      url.searchParams.set('limit', `${this.limitValue}`);
    }
    this.filters.forEach(([column, value]) => {
      url.searchParams.append(column, value);
    });
    if (this.upsertOptions?.onConflict) {
      url.searchParams.set('on_conflict', this.upsertOptions.onConflict);
    }
    if (this.countMode) {
      preferParts.push(`count=${this.countMode}`);
    }

    if (this.operation === 'insert' || this.operation === 'upsert') {
      method = 'POST';
      body = JSON.stringify(this.payload || []);
      headers['Content-Type'] = 'application/json';
      if (this.selectAfterWrite || this.expectSingle) preferParts.push('return=representation');
      if (this.operation === 'upsert') {
        preferParts.push(
          this.upsertOptions?.ignoreDuplicates
            ? 'resolution=ignore-duplicates'
            : 'resolution=merge-duplicates'
        );
      }
    } else if (this.operation === 'update') {
      method = 'PATCH';
      body = JSON.stringify(this.payload || {});
      headers['Content-Type'] = 'application/json';
      if (this.selectAfterWrite || this.expectSingle) preferParts.push('return=representation');
    } else if (this.operation === 'delete') {
      method = 'DELETE';
      if (this.selectAfterWrite || this.expectSingle) preferParts.push('return=representation');
    } else if (this.headOnly && !url.searchParams.has('limit')) {
      url.searchParams.set('limit', '1');
    }

    return {
      authToken,
      url,
      method,
      body,
      headers,
      preferHeader: preferParts.length ? preferParts.join(',') : null,
    };
  }

  async executeRequest(request) {
    const send = async (authToken) => {
      const response = await fetchWithTimeout(request.url.toString(), {
        method: request.method,
        headers: buildHeaders({
          authToken,
          prefer: request.preferHeader,
          extra: request.headers,
        }),
        body: request.body,
      });
      const payload = await parseResponseBody(response);
      return { response, payload };
    };

    let { response, payload } = await send(request.authToken);
    if (
      request.authToken &&
      request.authToken !== DEFAULT_PUBLIC_AUTH_TOKEN &&
      isUnauthorizedTokenError(response, payload)
    ) {
      const recovery = await recoverSessionForUnauthorizedToken(request.authToken);
      ({ response, payload } = await send(recovery.authToken));
    }

    if (!response.ok) {
      return {
        data: null,
        count: null,
        error: createError(payload, `${this.operation} failed (${response.status}).`),
      };
    }

    let data = payload;
    const countHeader = response.headers.get('x-total-count');
    const count = countHeader !== null ? Number(countHeader) : null;

    if (this.headOnly) {
      data = null;
    }

    if (this.expectSingle) {
      const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
      if (!rows.length) {
        return {
          data: null,
          count,
          error: this.allowEmptySingle ? null : createError(null, 'Expected a single row but none were returned.'),
        };
      }
      if (rows.length > 1 && !this.allowEmptySingle) {
        return {
          data: null,
          count,
          error: createError(null, 'Expected a single row but multiple rows were returned.'),
        };
      }
      data = rows[0] || null;
    }

    return { data, count, error: null };
  }

  async executeChunkedInQuery(request) {
    const chunkableFilterIndex = this.filters.findIndex(([, value]) => String(value || '').startsWith('in.('));
    if (chunkableFilterIndex === -1) {
      return this.executeRequest(request);
    }

    const [column, rawValue] = this.filters[chunkableFilterIndex];
    const values = parseInFilterValues(rawValue);
    if (values.length <= DEFAULT_IN_FILTER_CHUNK_SIZE) {
      return this.executeRequest(request);
    }

    const mergedRows = [];
    const seenRows = new Set();
    let totalCount = 0;

    for (let index = 0; index < values.length; index += DEFAULT_IN_FILTER_CHUNK_SIZE) {
      const chunk = values.slice(index, index + DEFAULT_IN_FILTER_CHUNK_SIZE);
      const chunkRequest = this.buildRequest(request.authToken);
      chunkRequest.url.searchParams.delete(column);
      chunkRequest.url.searchParams.append(column, `in.${serializeInValues(chunk)}`);

      const chunkResult = await this.executeRequest(chunkRequest);
      if (chunkResult.error) return chunkResult;

      const rows = Array.isArray(chunkResult.data) ? chunkResult.data : [];
      totalCount += Number(chunkResult.count || rows.length || 0);

      rows.forEach((row) => {
        const key = JSON.stringify(row);
        if (seenRows.has(key)) return;
        seenRows.add(key);
        mergedRows.push(row);
      });
    }

    if (this.orderBy?.column) {
      const { column, ascending } = this.orderBy;
      mergedRows.sort((left, right) => {
        const a = left?.[column];
        const b = right?.[column];
        if (a === b) return 0;
        if (a === undefined || a === null) return ascending ? 1 : -1;
        if (b === undefined || b === null) return ascending ? -1 : 1;
        return a > b ? (ascending ? 1 : -1) : (ascending ? -1 : 1);
      });
    }

    const offset = Number.isFinite(this.rangeFrom) ? this.rangeFrom : 0;
    const limit = Number.isFinite(this.rangeFrom) && Number.isFinite(this.rangeTo)
      ? Math.max(0, this.rangeTo - this.rangeFrom + 1)
      : Number.isFinite(this.limitValue)
        ? Math.max(0, this.limitValue)
        : null;
    const data = limit === null ? mergedRows : mergedRows.slice(offset, offset + limit);

    return {
      data,
      count: totalCount || mergedRows.length,
      error: null,
    };
  }

  async execute() {
    const session = await ensureActiveSession();
    const authToken = session?.access_token || DEFAULT_PUBLIC_AUTH_TOKEN;
    const request = this.buildRequest(authToken);
    if (
      request.method === 'GET' &&
      request.url.toString().length > MAX_GET_URL_LENGTH &&
      this.operation === 'select'
    ) {
      return this.executeChunkedInQuery(request);
    }
    return this.executeRequest(request);
  }
}

class InsForgeCompatClient {
  from(table) {
    return new InsForgeQueryBuilder(this, table);
  }

  async rpc(functionName, args = {}) {
    const session = await ensureActiveSession();
    const requestUrl = `${BASE_URL}/api/database/rpc/${encodeURIComponent(functionName)}`;
    const send = async (authToken) => {
      const response = await fetchWithTimeout(requestUrl, {
        method: 'POST',
        headers: buildHeaders({
          authToken,
          extra: { 'Content-Type': 'application/json' },
        }),
        body: JSON.stringify(args || {}),
      });
      const payload = await parseResponseBody(response);
      return { response, payload };
    };

    let authToken = session?.access_token || DEFAULT_PUBLIC_AUTH_TOKEN;
    let { response, payload } = await send(authToken);
    if (
      authToken &&
      authToken !== DEFAULT_PUBLIC_AUTH_TOKEN &&
      isUnauthorizedTokenError(response, payload)
    ) {
      const recovery = await recoverSessionForUnauthorizedToken(authToken);
      authToken = recovery.authToken;
      ({ response, payload } = await send(authToken));
    }

    if (!response.ok) {
      return { data: null, error: createError(payload, `rpc ${functionName} failed.`) };
    }
    return { data: payload, error: null };
  }

  removeChannel() {
    return Promise.resolve('ok');
  }
}

const authApi = {
  async signInWithPassword({ email, password } = {}) {
    const response = await fetchWithTimeout(`${BASE_URL}/api/auth/sessions?client_type=desktop`, {
      method: 'POST',
      headers: buildHeaders({
        extra: { 'Content-Type': 'application/json', ...SILENT_REQUEST_HEADERS },
      }),
      body: JSON.stringify({ email, password }),
    });
    const payload = await parseResponseBody(response);
    if (!response.ok) {
      const retryAfter = String(response.headers.get('retry-after') || '').trim();
      const fallbackMessage = response.status === 429
        ? `Too many requests from this IP.${retryAfter ? ` Retry after ${retryAfter}s.` : ''}`
        : 'Unable to sign in.';
      return {
        data: null,
        error: {
          ...createError(payload, fallbackMessage),
          status: response.status,
          statusCode: response.status,
        },
      };
    }

    const profile = await resolveProfileForAuthUser(payload?.user, payload?.accessToken);
    const user = buildAppUser(payload?.user, profile);
    const session = persistSession({
      access_token: payload?.accessToken || null,
      refresh_token: payload?.refreshToken || null,
      user,
    });
    return { data: { user, session }, error: null };
  },

  async getSession() {
    const session = await ensureActiveSession();
    return { data: { session }, error: null };
  },

  async getUser() {
    const session = getStoredSession();
    return { data: { user: session?.user || null }, error: null };
  },

  async getCurrentUser() {
    const session = await ensureActiveSession();
    if (!session?.access_token) {
      return { data: { user: null }, error: null };
    }

    const send = async (authToken) => {
      const response = await fetchWithTimeout(`${BASE_URL}/api/auth/sessions/current`, {
        method: 'GET',
        headers: buildHeaders({ authToken, extra: SILENT_REQUEST_HEADERS }),
      });
      const payload = await parseResponseBody(response);
      return { response, payload };
    };

    let authToken = session.access_token;
    let { response, payload } = await send(authToken);
    if (isUnauthorizedTokenError(response, payload)) {
      const recovery = await recoverSessionForUnauthorizedToken(authToken);
      authToken = recovery.authToken;
      if (!authToken || authToken === DEFAULT_PUBLIC_AUTH_TOKEN) {
        return { data: { user: null }, error: null };
      }
      ({ response, payload } = await send(authToken));
    }

    if (!response.ok) {
      return { data: { user: null }, error: createError(payload, 'Unable to resolve current user.') };
    }

    const profile = await resolveProfileForAuthUser(payload?.user, authToken);
    const user = buildAppUser(payload?.user, profile);
    persistSession({ ...(getStoredSession() || session), access_token: authToken, user }, SESSION_EVENTS.TOKEN_REFRESHED);
    return { data: { user }, error: null };
  },

  async refreshSession() {
    const session = await ensureActiveSession();
    if (!session?.refresh_token) {
      return { data: { session: null }, error: createError(null, 'Refresh token is unavailable.') };
    }

    const response = await fetchWithTimeout(`${BASE_URL}/api/auth/refresh?client_type=desktop`, {
      method: 'POST',
      headers: buildHeaders({
        extra: { 'Content-Type': 'application/json', ...SILENT_REQUEST_HEADERS },
      }),
      body: JSON.stringify({ refreshToken: session.refresh_token }),
    });
    const payload = await parseResponseBody(response);
    if (!response.ok) {
      return { data: { session: null }, error: createError(payload, 'Unable to refresh session.') };
    }

    const profile = await resolveProfileForAuthUser(payload?.user, payload?.accessToken);
    const user = buildAppUser(payload?.user, profile);
    const nextSession = persistSession(
      {
        access_token: payload?.accessToken || null,
        refresh_token: payload?.refreshToken || session.refresh_token || null,
        user,
      },
      SESSION_EVENTS.TOKEN_REFRESHED
    );
    return { data: { session: nextSession, user }, error: null };
  },

  async signOut() {
    const session = await ensureActiveSession();
    if (session?.access_token) {
      try {
        await fetchWithTimeout(`${BASE_URL}/api/auth/logout`, {
          method: 'POST',
          headers: buildHeaders({ authToken: session.access_token, extra: SILENT_REQUEST_HEADERS }),
        });
      } catch (_error) {
        // Best effort.
      }
    }
    setRecoveryTokenValue('');
    persistSession(null, SESSION_EVENTS.SIGNED_OUT);
    return { error: null };
  },

  async resetPasswordForEmail(email, options = {}) {
    const response = await fetchWithTimeout(`${BASE_URL}/api/auth/email/send-reset-password`, {
      method: 'POST',
      headers: buildHeaders({
        extra: { 'Content-Type': 'application/json' },
      }),
      body: JSON.stringify({
        email,
        redirectTo: options?.redirectTo || null,
      }),
    });
    const payload = await parseJsonSafely(response);
    if (!response.ok) {
      return { data: null, error: createError(payload, 'Could not send reset email.') };
    }
    return { data: payload, error: null };
  },

  async updateUser(attributes = {}) {
    if (attributes?.password) {
      const recoveryToken = getRecoveryToken();
      if (!recoveryToken) {
        return { data: null, error: createError(null, 'Recovery token is missing.') };
      }

      const response = await fetchWithTimeout(`${BASE_URL}/api/auth/email/reset-password`, {
        method: 'POST',
        headers: buildHeaders({
          extra: { 'Content-Type': 'application/json', ...SILENT_REQUEST_HEADERS },
        }),
        body: JSON.stringify({
          newPassword: attributes.password,
          otp: recoveryToken,
        }),
      });
      const payload = await parseJsonSafely(response);
      if (!response.ok) {
        return { data: null, error: createError(payload, 'Could not reset password.') };
      }
      setRecoveryTokenValue('');
      return { data: payload, error: null };
    }

    const session = await ensureActiveSession();
    if (!session?.access_token) {
      return { data: null, error: createError(null, 'Active session is required.') };
    }

    const response = await fetchWithTimeout(`${BASE_URL}/api/auth/profiles/current`, {
      method: 'PATCH',
      headers: buildHeaders({
        authToken: session.access_token,
        extra: { 'Content-Type': 'application/json' },
      }),
      body: JSON.stringify({ profile: attributes }),
    });
    const payload = await parseJsonSafely(response);
    if (!response.ok) {
      return { data: null, error: createError(payload, 'Could not update profile.') };
    }
    return { data: payload, error: null };
  },

  async exchangeCodeForSession() {
    return { data: null, error: createError(null, 'Code exchange is not used for InsForge reset links.') };
  },

  setRecoveryToken(token) {
    setRecoveryTokenValue(token);
    notifyAuthListeners(SESSION_EVENTS.PASSWORD_RECOVERY, getStoredSession());
  },

  clearRecoveryToken() {
    setRecoveryTokenValue('');
  },

  onAuthStateChange(callback) {
    if (typeof callback === 'function') {
      sessionListeners.add(callback);
    }
    return {
      data: {
        subscription: {
          unsubscribe: () => sessionListeners.delete(callback),
        },
      },
    };
  },
};

const supabaseInstance =
  existingClient ||
  (BASE_URL && SUPABASE_KEY && assertSupabaseTarget(BASE_URL, SUPABASE_KEY)
    ? Object.assign(new InsForgeCompatClient(), { auth: authApi, provider: BACKEND_PROVIDER })
    : null);

const supabase = existingClient || supabaseInstance || null;

if (!supabase) {
  notifyGlobalAlert({
    title: 'Database Connection Blocked',
    message: 'The data client was not created due to validation or missing credentials.',
    details: 'The configured backend endpoint did not pass validation.',
  });
}

if (typeof window !== 'undefined' && supabase) {
  window.supabaseClient = supabase;
}

export { supabase };
export default supabase;
