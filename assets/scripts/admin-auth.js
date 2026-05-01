import { SUPABASE_KEY, SUPABASE_URL, assertSupabaseTarget } from './env.js';
import { supabase as sharedSupabaseClient } from '../js/supabaseClient.js';
import {
  clearWebAdminSession,
} from './web-admin-session.js';

const LOGIN_PAGE = new URL('../../pages/login.html', import.meta.url).toString();
const ADMIN_HOME = new URL('../../pages/admin/index.html', import.meta.url).toString();
const CONTROL_VIEW = new URL('../../pages/control-map.html', import.meta.url).toString();


const supabaseClient =
  sharedSupabaseClient ||
  window.supabaseClient ||
  (window.supabase?.createClient && SUPABASE_URL && SUPABASE_KEY && assertSupabaseTarget(SUPABASE_URL, SUPABASE_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null);

const hasSupabaseAuth =
  Boolean(supabaseClient?.auth) && typeof supabaseClient.auth.getSession === 'function';

if (!hasSupabaseAuth) {
  console.warn('Supabase auth unavailable in admin guard.');
}

if (supabaseClient) {
  window.supabaseClient = supabaseClient;
}

let currentSession = null;
let initialSessionResolved = false;
let initializationPromise = null;
let cachedUserRole = null;
let cachedUserStatus = null;
let cachedUserProfile = null;
const ACCESS_LOOKUP_TIMEOUT_MS = 2500;
const PROFILE_LOOKUP_TIMEOUT_MS = 1800;
const sessionListeners = new Set();
const broadcastRoleStatus = (role, status) =>
  window.dispatchEvent(
    new CustomEvent('auth:role-updated', {
      detail: { role: role ?? null, status: status ?? null, mapCategory: window.currentUserMapCategory ?? null },
    }),
  );

const HOME_PAGE = new URL('../../index.html', import.meta.url).toString();

const redirectToLogin = () => {
  window.location.href = LOGIN_PAGE;
};

const redirectToAdminHome = () => {
  window.location.href = ADMIN_HOME;
};

const redirectToControlView = () => {
  window.location.href = CONTROL_VIEW;
};

const redirectToHome = () => {
  window.location.href = HOME_PAGE;
};

const notifySessionListeners = (session) => {
  sessionListeners.forEach((listener) => listener(session));
};

const roleAllowsDashboard = (role) => ['administrator', 'moderator'].includes(String(role || '').toLowerCase());
const roleIsAdministrator = (role) => String(role || '').toLowerCase() === 'administrator';
const normalizeRoleValue = (value, fallback = 'user') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
};
const normalizeStatusValue = (value, fallback = 'active') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
};
const isRateLimitedError = (error) => {
  const status = Number(error?.status || error?.statusCode);
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return status === 429 || message.includes('too many requests') || details.includes('too many requests');
};

const isMissingProfilesStatusColumnError = (error) => {
  const code = String(error?.code || '').trim().toUpperCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (code === '42703') return true;
  if (message.includes('column') && message.includes('status')) return true;
  if (details.includes('status') && details.includes('column')) return true;
  if (hint.includes('status') && hint.includes('column')) return true;
  return false;
};

const withTimeout = (promise, timeoutMs = 2500, label = 'operation') =>
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const timeoutError = new Error(`${label} timed out after ${timeoutMs}ms`);
      timeoutError.name = 'TimeoutError';
      reject(timeoutError);
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });

const resolveFallbackAccess = (session) => {
  const profileRole = session?.user?.profile?.role || null;
  const userRole = session?.user?.user_metadata?.role || null;
  const appRole = session?.user?.app_metadata?.role || null;
  const profileStatus = session?.user?.profile?.status || null;
  const userStatus = session?.user?.user_metadata?.status || null;
  const appStatus = session?.user?.app_metadata?.status || null;
  const profileMapCategory = session?.user?.profile?.map_category || null;
  const userMapCategory = session?.user?.user_metadata?.map_category || null;
  const appMapCategory = session?.user?.app_metadata?.map_category || null;

  const roleHint = profileRole || userRole || appRole || null;
  const statusHint = profileStatus || userStatus || appStatus || null;
  const mapCategoryHint = profileMapCategory || userMapCategory || appMapCategory || null;

  const roleSource = cachedUserRole
    ? 'verified-cache'
    : roleHint
      ? 'session-hint'
      : 'default';

  const statusSource = cachedUserStatus
    ? 'verified-cache'
    : statusHint
      ? 'session-hint'
      : 'default';

  const role = normalizeRoleValue(cachedUserRole || roleHint || 'user', 'user');
  const status = normalizeStatusValue(cachedUserStatus || statusHint || 'active', 'active');

  return {
    role,
    status,
    map_category: normalizeRoleValue(mapCategoryHint || cachedUserProfile?.map_category || 'general', 'general'),
    source: roleSource === 'default' ? statusSource : roleSource,
    confident: false,
  };
};

const setSession = (session) => {
  currentSession = session;
  notifySessionListeners(session);
};

const getEffectiveSession = (session) => session || null;

const getUserAccess = async (
  session,
  { timeoutMs = ACCESS_LOOKUP_TIMEOUT_MS, preferCache = true, requireReliable = false } = {},
) => {
  const userId = session?.user?.id;
  if (!userId) {
    window.currentUserRole = 'user';
    window.currentUserStatus = 'active';
    broadcastRoleStatus('user', 'active');
    return { role: 'user', status: 'active', source: 'default', confident: true };
  }

  const fallbackAccess = resolveFallbackAccess(session);
  const fallbackRole = fallbackAccess.role;
  const fallbackStatus = fallbackAccess.status;

  if (!requireReliable && preferCache && cachedUserRole && cachedUserStatus) {
    cachedUserRole = fallbackRole;
    cachedUserStatus = fallbackStatus;
    window.currentUserRole = fallbackRole;
    window.currentUserStatus = fallbackStatus;
    broadcastRoleStatus(fallbackRole, fallbackStatus);
    return fallbackAccess;
  }

  if (!supabaseClient?.from && typeof supabaseClient?.auth?.getProfile !== 'function') {
    const deniedAccess = { role: 'user', status: 'active', source: 'unavailable', confident: false };
    window.currentUserRole = requireReliable ? deniedAccess.role : fallbackRole;
    window.currentUserStatus = requireReliable ? deniedAccess.status : fallbackStatus;
    broadcastRoleStatus(window.currentUserRole, window.currentUserStatus);
    return requireReliable ? deniedAccess : fallbackAccess;
  }

  let data = null;
  let error = null;
  try {
    if (typeof supabaseClient?.auth?.getProfile === 'function') {
      const result = await withTimeout(
        supabaseClient.auth.getProfile(),
        timeoutMs,
        'Profile access lookup',
      );
      data = result?.data?.profile || null;
      error = result?.error || null;
    } else {
      let result = await withTimeout(
        supabaseClient
          .from('profiles')
          .select('role, status, map_category')
          .eq('id', userId)
          .maybeSingle(),
        timeoutMs,
        'Profile access lookup',
      );
      data = result?.data || null;
      error = result?.error || null;
      if (error && String(error.message || '').toLowerCase().includes('map_category')) {
        result = await withTimeout(
          supabaseClient
            .from('profiles')
            .select('role, status')
            .eq('id', userId)
            .maybeSingle(),
          timeoutMs,
          'Profile access lookup',
        );
        data = result?.data || null;
        error = result?.error || null;
      }
    }
  } catch (error) {
    const isTimeout = String(error?.name || '') === 'TimeoutError';
    console.warn(
      isTimeout ? 'Profile access lookup timed out.' : 'Unable to fetch user role',
      error,
    );
    if (requireReliable) {
      const deniedAccess = { role: 'user', status: 'active', source: isTimeout ? 'timeout' : 'error', confident: false };
      window.currentUserRole = deniedAccess.role;
      window.currentUserStatus = deniedAccess.status;
      broadcastRoleStatus(deniedAccess.role, deniedAccess.status);
      return deniedAccess;
    }
    window.currentUserRole = fallbackRole;
    window.currentUserStatus = fallbackStatus;
    broadcastRoleStatus(fallbackRole, fallbackStatus);
    return fallbackAccess;
  }

  if (error) {
    if (isRateLimitedError(error)) {
      console.warn('Profile access lookup rate-limited.');
      if (requireReliable) {
        const deniedAccess = { role: 'user', status: 'active', source: 'rate-limited', confident: false };
        window.currentUserRole = deniedAccess.role;
        window.currentUserStatus = deniedAccess.status;
        broadcastRoleStatus(deniedAccess.role, deniedAccess.status);
        return deniedAccess;
      }
      window.currentUserRole = fallbackRole;
      window.currentUserStatus = fallbackStatus;
      broadcastRoleStatus(fallbackRole, fallbackStatus);
      return fallbackAccess;
    }
    if (isMissingProfilesStatusColumnError(error)) {
      if (requireReliable) {
        const deniedAccess = { role: 'user', status: 'active', source: 'missing-status-column', confident: false };
        window.currentUserRole = deniedAccess.role;
        window.currentUserStatus = deniedAccess.status;
        broadcastRoleStatus(deniedAccess.role, deniedAccess.status);
        return deniedAccess;
      }
      try {
        const roleOnlyResponse = await withTimeout(
          supabaseClient
            .from('profiles')
            .select('role')
            .eq('id', userId)
            .maybeSingle(),
          timeoutMs,
          'Profile role-only lookup',
        );
        const roleOnlyData = roleOnlyResponse?.data || null;
        const roleOnlyError = roleOnlyResponse?.error || null;
        if (!roleOnlyError && roleOnlyData) {
          const normalizedRole = normalizeRoleValue(roleOnlyData.role, 'user');
          const normalizedStatus = requireReliable ? 'active' : normalizeStatusValue(fallbackStatus, 'active');
          cachedUserRole = normalizedRole;
          cachedUserStatus = normalizedStatus;
          window.currentUserRole = normalizedRole;
          window.currentUserStatus = normalizedStatus;
          broadcastRoleStatus(normalizedRole, normalizedStatus);
          return { role: normalizedRole, status: normalizedStatus, source: 'db-role-only', confident: true };
        }
      } catch (roleOnlyLookupError) {
        console.warn('Role-only lookup failed', roleOnlyLookupError);
      }
    }
    console.warn('Unable to fetch user role', error);
    if (requireReliable) {
      const deniedAccess = { role: 'user', status: 'active', source: 'error', confident: false };
      window.currentUserRole = deniedAccess.role;
      window.currentUserStatus = deniedAccess.status;
      broadcastRoleStatus(deniedAccess.role, deniedAccess.status);
      return deniedAccess;
    }
    window.currentUserRole = fallbackRole;
    window.currentUserStatus = fallbackStatus;
    broadcastRoleStatus(fallbackRole, fallbackStatus);
    return fallbackAccess;
  }

  if (!data) {
    if (requireReliable) {
      const deniedAccess = { role: 'user', status: 'active', source: 'missing-profile', confident: false };
      window.currentUserRole = deniedAccess.role;
      window.currentUserStatus = deniedAccess.status;
      broadcastRoleStatus(deniedAccess.role, deniedAccess.status);
      return deniedAccess;
    }
    window.currentUserRole = fallbackRole;
    window.currentUserStatus = fallbackStatus;
    broadcastRoleStatus(fallbackRole, fallbackStatus);
    return fallbackAccess;
  }

  const normalizedRole = normalizeRoleValue(data.role, 'user');
  const normalizedStatus = normalizeStatusValue(data.status, 'active');
  const normalizedMapCategory = normalizeRoleValue(data.map_category, 'general');
  cachedUserRole = normalizedRole;
  cachedUserStatus = normalizedStatus;
  window.currentUserRole = normalizedRole;
  window.currentUserStatus = normalizedStatus;
  window.currentUserMapCategory = normalizedMapCategory;
  broadcastRoleStatus(normalizedRole, normalizedStatus);
  return { role: normalizedRole, status: normalizedStatus, map_category: normalizedMapCategory, source: 'db', confident: true };
};

const getUserProfile = async (session, { timeoutMs = PROFILE_LOOKUP_TIMEOUT_MS } = {}) => {
  const fallbackProfile = {
    name: session?.user?.profile?.name || session?.user?.user_metadata?.name || null,
    email: session?.user?.profile?.email || session?.user?.email || null,
  };

  if (window.currentUserProfile) return window.currentUserProfile;
  if (cachedUserProfile) {
    window.currentUserProfile = cachedUserProfile;
    return cachedUserProfile;
  }
  if (session?.user?.profile?.email || session?.user?.profile?.name) {
    cachedUserProfile = {
      name: session?.user?.profile?.name || fallbackProfile.name,
      email: session?.user?.profile?.email || fallbackProfile.email,
    };
    window.currentUserProfile = cachedUserProfile;
    return cachedUserProfile;
  }

  const userId = session?.user?.id;
  if (!userId) {
    cachedUserProfile = null;
    return fallbackProfile;
  }

  if (!supabaseClient?.from && typeof supabaseClient?.auth?.getProfile !== 'function') {
    return fallbackProfile;
  }

  let data = null;
  let error = null;
  try {
    if (typeof supabaseClient?.auth?.getProfile === 'function') {
      const result = await withTimeout(
        supabaseClient.auth.getProfile(),
        timeoutMs,
        'Profile header lookup',
      );
      data = result?.data?.profile || null;
      error = result?.error || null;
    } else {
      const result = await withTimeout(
        supabaseClient.from('profiles').select('name, email, map_category').eq('id', userId).maybeSingle(),
        timeoutMs,
        'Profile header lookup',
      );
      data = result?.data || null;
      error = result?.error || null;
    }
  } catch (error) {
    const isTimeout = String(error?.name || '') === 'TimeoutError';
    console.warn(
      isTimeout ? 'Profile header lookup timed out; using fallback email.' : 'Unable to fetch user profile',
      error,
    );
    return fallbackProfile;
  }

  if (error) {
    if (isRateLimitedError(error)) {
      console.warn('Profile header lookup rate-limited; using fallback profile.');
      return fallbackProfile;
    }
    console.warn('Unable to fetch user profile', error);
    return fallbackProfile;
  }

  if (!data) {
    return fallbackProfile;
  }

  cachedUserProfile = data || null;
  window.currentUserProfile = cachedUserProfile;
  return cachedUserProfile;
};

const recordLastConnection = async (session) => {
  const userId = session?.user?.id;
  if (!userId) return;
  if (!supabaseClient?.from && typeof supabaseClient?.auth?.updateUser !== 'function') return;
  if (typeof localStorage === 'undefined') return;

  const storageKey = `techloc:last-connection:${userId}`;
  const now = Date.now();
  const lastRecorded = Number(localStorage.getItem(storageKey) || 0);
  if (Number.isFinite(lastRecorded) && lastRecorded && now - lastRecorded < 5 * 60 * 1000) return;

  localStorage.setItem(storageKey, String(now));
  const { error } = typeof supabaseClient?.auth?.updateUser === 'function'
    ? await supabaseClient.auth.updateUser({ last_connection: new Date(now).toISOString() })
    : await supabaseClient
        .from('profiles')
        .update({ last_connection: new Date(now).toISOString() })
        .eq('id', userId);

  if (error) {
    console.warn('Unable to record last connection', error);
  }
};

const updateHeaderAccount = (session) => {
  const accountName = document.querySelector('[data-account-name]');
  if (!accountName) return;

  if (!session?.user) {
    accountName.textContent = 'Account';
    return;
  }

  const immediateLabel = session.user.email || 'Account';
  accountName.textContent = immediateLabel;

  getUserProfile(session)
    .then((profile) => {
      const label = profile?.email || session.user.email || 'Account';
      if (accountName.isConnected) accountName.textContent = label;
    })
    .catch((error) => {
      console.warn('Unable to update account label from profile', error);
    });
};

const applyRoleVisibility = (role) => {
  const adminOnly = document.querySelectorAll('[data-admin-only]');
  adminOnly.forEach((item) => {
    if (role === 'administrator') {
      item.classList.remove('hidden');
      item.removeAttribute('aria-hidden');
    } else {
      item.classList.add('hidden');
      item.setAttribute('aria-hidden', 'true');
    }
  });
};

const isAuthorizedUser = (session) => Boolean(session);

const routeInfo = (() => {
  const path = window.location.pathname.toLowerCase();
  return {
    isAdminRoute: path.includes('/admin/'),
    isAdminDashboard:
      path.endsWith('/admin/index.html') || path.endsWith('/admin/') || path.endsWith('admin/index.html'),
    isControlView: path.endsWith('/pages/control-map.html') || path.endsWith('pages/control-map.html'),
    isLoginPage: path.endsWith('/login.html') || path.endsWith('login.html'),
    isProfilesPage: path.includes('/admin/profiles.html'),
    isSettingsPage: path.includes('/admin/settings.html'),
    isServicesPage: path.includes('/admin/services.html'),
    isGpsBlacklistPage: path.includes('/admin/gps-blacklist.html'),
  };
})();

const routeRequiresAdministrator = () =>
  routeInfo.isProfilesPage ||
  routeInfo.isSettingsPage ||
  routeInfo.isGpsBlacklistPage;

const getCurrentSession = async () => {
  await initializeAuthState();
  return currentSession;
};

const initializeAuthState = () => {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      if (hasSupabaseAuth) {
        const { data } = await supabaseClient.auth.getSession();
        const resolved = getEffectiveSession(data?.session ?? null);
        if (!resolved) clearWebAdminSession();
        setSession(resolved);
      } else {
        clearWebAdminSession();
        setSession(getEffectiveSession(null));
      }
    } catch (error) {
      console.error('Session prefetch error', error);
      setSession(getEffectiveSession(null));
    } finally {
      initialSessionResolved = true;
    }

    if (hasSupabaseAuth && typeof supabaseClient.auth.onAuthStateChange === 'function') {
      supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          clearWebAdminSession();
        }

        const effectiveSession = getEffectiveSession(session);
        setSession(effectiveSession);

        if (!effectiveSession) {
          cachedUserRole = null;
          cachedUserStatus = null;
          cachedUserProfile = null;
          window.currentUserRole = null;
          window.currentUserStatus = null;
          window.currentUserMapCategory = null;
          window.currentUserProfile = null;
          broadcastRoleStatus(null, null);
        }

        if (event === 'SIGNED_OUT') {
          const isProtectedRoute = routeInfo.isAdminRoute || routeInfo.isControlView;
          if (isProtectedRoute && !routeInfo.isLoginPage) {
            redirectToLogin();
          }
        }
      });
    }
  })();

  return initializationPromise;
};

const waitForAuthorizedSession = () =>
  new Promise((resolve, reject) => {
    let cleanedUp = false;

    const cleanup = () => {
      cleanedUp = true;
      sessionListeners.delete(checkSession);
    };

    const handleAuthorized = (session) => {
      cleanup();
      resolve(session);
    };

    const handleUnauthorized = async (reason) => {
      cleanup();
      clearWebAdminSession();
      if (hasSupabaseAuth && typeof supabaseClient.auth.signOut === 'function') {
        await supabaseClient.auth.signOut();
      }
      redirectToLogin();
      reject(new Error(reason));
    };

    const checkSession = (session) => {
      const authorized = isAuthorizedUser(session);
      if (authorized) {
        handleAuthorized(session);
        return;
      }

      if (session === null && initialSessionResolved && !cleanedUp) {
        handleUnauthorized('No active authenticated session');
      }
    };

    initializeAuthState()
      .then(() => {
        if (isAuthorizedUser(currentSession)) {
          handleAuthorized(currentSession);
          return;
        }
        sessionListeners.add(checkSession);
        checkSession(currentSession);
      })
      .catch((error) => {
        console.error('Authentication initialization failed', error);
        handleUnauthorized('Initialization failed');
      });
  });

const requireSession = async () => {
  const session = await waitForAuthorizedSession();
  return session;
};

const ensureLogoutButton = () => {
  let logoutButton = document.querySelector('[data-admin-logout]');

  if (!logoutButton) {
    const headerActions =
      document.querySelector('[data-site-header] [data-admin-actions]') ||
      document.querySelector('[data-site-header] .md\\:flex') ||
      document.querySelector('[data-site-header] .flex.items-center.justify-between');
    if (!headerActions) return null;

    logoutButton = document.createElement('button');
    logoutButton.type = 'button';
    logoutButton.dataset.adminLogout = 'true';
    logoutButton.className =
      'hidden items-center gap-2 rounded-full border border-red-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-200 transition hover:border-red-400 hover:text-white';
    logoutButton.innerHTML = '<span>Logout</span>';
    headerActions.appendChild(logoutButton);
  }

  return logoutButton;
};

const setupLogoutButton = () => {
  const logoutButton = ensureLogoutButton();
  if (!logoutButton) return;

  logoutButton.classList.remove('hidden');
  if (logoutButton.dataset.bound === 'true') return;

  logoutButton.dataset.bound = 'true';
  logoutButton.addEventListener('click', async () => {
    clearWebAdminSession();
    if (hasSupabaseAuth && typeof supabaseClient.auth.signOut === 'function') {
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        console.error('Supabase sign out error', error);
        return;
      }
    }
    redirectToLogin();
  });
};

const waitForDom = () =>
  new Promise((resolve) => {
    if (document.readyState !== 'loading') {
      resolve();
      return;
    }
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });

const waitForPageLoad = () =>
  new Promise((resolve) => {
    if (document.readyState === 'complete') {
      resolve();
      return;
    }
    window.addEventListener('load', () => resolve(), { once: true });
  });

const applyLoadingState = () => {
  const protectedBlocks = document.querySelectorAll('[data-auth-protected]');
  protectedBlocks.forEach((block) => {
    block.classList.add('hidden');
    block.setAttribute('aria-hidden', 'true');
  });

  const loading = document.querySelector('[data-auth-loading]');
  if (loading) {
    loading.classList.remove('hidden');
  }
};

const revealAuthorizedUi = () => {
  const loading = document.querySelector('[data-auth-loading]');
  if (loading) {
    loading.remove();
  }

  const protectedBlocks = document.querySelectorAll('[data-auth-protected]');
  protectedBlocks.forEach((block) => {
    block.classList.remove('hidden');
    block.removeAttribute('aria-hidden');
  });

  const gatedItems = document.querySelectorAll('[data-auth-visible]');
  gatedItems.forEach((item) => item.classList.remove('hidden'));
};

const syncNavigationVisibility = async (sessionFromEvent = null) => {
  await waitForDom();
  await initializeAuthState();

  const navItems = document.querySelectorAll('[data-auth-visible]');
  const guestItems = document.querySelectorAll('[data-auth-guest]');
  const loginButton = document.getElementById('nav-login');
  const logoutButton = ensureLogoutButton();
  if (!navItems.length && !guestItems.length) return;

  const session = sessionFromEvent ?? currentSession;
  const authorized = isAuthorizedUser(session);
  const { role, status } = authorized
    ? await getUserAccess(session, { timeoutMs: ACCESS_LOOKUP_TIMEOUT_MS })
    : { role: 'user', status: 'active' };

  if (status === 'suspended' && (routeInfo.isAdminRoute || routeInfo.isControlView)) {
    clearWebAdminSession();
    if (hasSupabaseAuth && typeof supabaseClient.auth.signOut === 'function') {
      await supabaseClient.auth.signOut();
    }
    redirectToLogin();
    return;
  }

  applyRoleVisibility(role);

  if (authorized) {
    navItems.forEach((item) => item.classList.remove('hidden'));
    guestItems.forEach((item) => item.classList.add('hidden'));
    loginButton?.classList.add('hidden');
    logoutButton?.classList.remove('hidden');
    setupLogoutButton();
    updateHeaderAccount(session);
    recordLastConnection(session).catch((error) =>
      console.warn('Unable to record last connection in navigation sync', error),
    );
  } else {
    navItems.forEach((item) => item.classList.add('hidden'));
    guestItems.forEach((item) => item.classList.remove('hidden'));
    loginButton?.classList.remove('hidden');
    if (logoutButton) {
      logoutButton.classList.add('hidden');
    }
    updateHeaderAccount(null);
  }
};

const enforceAdminGuard = async () => {
  await waitForDom();
  applyLoadingState();
  const session = await requireSession();
  setupLogoutButton();
  const { role, status, confident } = await getUserAccess(session, {
    timeoutMs: ACCESS_LOOKUP_TIMEOUT_MS * 2,
    preferCache: false,
    requireReliable: true,
  });
  applyRoleVisibility(role);

  if (status === 'suspended') {
    clearWebAdminSession();
    if (hasSupabaseAuth && typeof supabaseClient.auth.signOut === 'function') {
      await supabaseClient.auth.signOut();
    }
    redirectToLogin();
    return session;
  }

  if (routeInfo.isAdminRoute && !routeInfo.isServicesPage && !roleAllowsDashboard(role)) {
    redirectToHome();
    return session;
  }

  if (routeRequiresAdministrator() && !roleIsAdministrator(role)) {
    redirectToHome();
    return session;
  }

  if (!confident && routeInfo.isAdminRoute && !routeInfo.isServicesPage) {
    redirectToHome();
    return session;
  }

  revealAuthorizedUi();
  await waitForPageLoad();
  if (routeInfo.isAdminDashboard) {
    window.adminAuthReady = true;
    window.dispatchEvent(new Event('admin:auth-ready'));
    return session;
  }

  return session;
};

const startNavigationSync = () => {
  const handleNavigationSync = (session) =>
    syncNavigationVisibility(session).catch((error) => console.error('Navigation auth sync failed', error));

  sessionListeners.add(handleNavigationSync);
  window.addEventListener('shared-header:ready', () => handleNavigationSync(currentSession));
  initializeAuthState()
    .then(() => handleNavigationSync(currentSession))
    .catch((error) => console.error('Navigation initialization failed', error));
};

const autoStart = () => {
  initializeAuthState();

  if ((routeInfo.isAdminRoute || routeInfo.isControlView) && !routeInfo.isLoginPage) {
    enforceAdminGuard().catch((error) => console.error('Authentication guard failed', error));
  }

  startNavigationSync();
};

autoStart();

export {
  supabaseClient,
  enforceAdminGuard,
  requireSession,
  redirectToLogin,
  redirectToAdminHome,
  redirectToHome,
  redirectToControlView,
  setupLogoutButton,
  LOGIN_PAGE,
  ADMIN_HOME,
  HOME_PAGE,
};
