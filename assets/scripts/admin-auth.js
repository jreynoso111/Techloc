const SUPABASE_URL = 'https://ewgtclzscwbokxmzxbcu.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3Z3RjbHpzY3dib2t4bXp4YmN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwODA3MzIsImV4cCI6MjA4MDY1NjczMn0.QkM72rVeBpm6uGgBVdG4ulIzEg3V_7T8usqvIf6vBto';

const LOGIN_PAGE = new URL('../../login.html', import.meta.url).toString();
const ADMIN_HOME = new URL('../../Admin/index.html', import.meta.url).toString();
const CONTROL_VIEW = new URL('../../vehicles.html', import.meta.url).toString();

const AUTHORIZED_EMAILS = ['admin@techloc.com', 'ops@techloc.com'];

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

let currentSession = null;
let initialSessionResolved = false;
let initializationPromise = null;
const sessionListeners = new Set();

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

const setSession = (session) => {
  currentSession = session;
  notifySessionListeners(session);
};

const isAuthorizedUser = (session) => {
  const email = session?.user?.email?.toLowerCase();
  return Boolean(email && AUTHORIZED_EMAILS.includes(email));
};

const routeInfo = (() => {
  const path = window.location.pathname.toLowerCase();
  return {
    isAdminRoute: path.includes('/admin/'),
    isControlView: path.endsWith('/vehicles.html') || path.endsWith('vehicles.html'),
    isLoginPage: path.endsWith('/login.html') || path.endsWith('login.html'),
  };
})();

const getCurrentSession = async () => {
  await initializeAuthState();
  return currentSession;
};

const initializeAuthState = () => {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      const { data } = await supabaseClient.auth.getSession();
      setSession(data?.session ?? null);
    } catch (error) {
      console.error('Session prefetch error', error);
      setSession(null);
    } finally {
      initialSessionResolved = true;
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
      setSession(session);

      if (event === 'SIGNED_OUT') {
        const isProtectedRoute = routeInfo.isAdminRoute || routeInfo.isControlView;
        if (isProtectedRoute && !routeInfo.isLoginPage) {
          redirectToLogin();
        }
      }
    });
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
      await supabaseClient.auth.signOut();
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
        handleUnauthorized('No active Supabase session');
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
      document.querySelector('[data-admin-actions]') ||
      document.querySelector('header .md\\:flex') ||
      document.querySelector('header .flex.items-center.justify-between');
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
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      console.error('Supabase sign out error', error);
      return;
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
  if (!navItems.length && !guestItems.length) return;

  const session = sessionFromEvent ?? currentSession;
  const authorized = isAuthorizedUser(session);

  if (authorized) {
    navItems.forEach((item) => item.classList.remove('hidden'));
    guestItems.forEach((item) => item.classList.add('hidden'));
    setupLogoutButton();
  } else {
    navItems.forEach((item) => item.classList.add('hidden'));
    guestItems.forEach((item) => item.classList.remove('hidden'));
    const logoutButton = ensureLogoutButton();
    if (logoutButton) {
      logoutButton.classList.add('hidden');
    }
  }
};

const enforceAdminGuard = async () => {
  await waitForDom();
  applyLoadingState();
  const session = await requireSession();
  setupLogoutButton();
  revealAuthorizedUi();
  return session;
};

const startNavigationSync = () => {
  const handleNavigationSync = (session) =>
    syncNavigationVisibility(session).catch((error) => console.error('Navigation auth sync failed', error));

  sessionListeners.add(handleNavigationSync);
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
