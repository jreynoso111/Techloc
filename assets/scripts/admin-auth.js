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

const HOME_PAGE = new URL('../../index.html', import.meta.url).toString();

const redirectToLogin = () => {
  window.location.href = LOGIN_PAGE;
};

const redirectToAdminHome = () => {
  window.location.href = ADMIN_HOME;
};

const redirectToHome = () => {
  window.location.href = HOME_PAGE;
};

const isAuthorizedUser = (session) => {
  const email = session?.user?.email?.toLowerCase();
  return Boolean(email && AUTHORIZED_EMAILS.includes(email));
};

const waitForAuthorizedSession = () =>
  new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = (subscription) => {
      settled = true;
      subscription?.unsubscribe();
    };

    const handleAuthorized = (session, subscription) => {
      cleanup(subscription);
      resolve(session);
    };

    const handleUnauthorized = async (subscription, reason) => {
      cleanup(subscription);
      await supabaseClient.auth.signOut();
      redirectToLogin();
      reject(new Error(reason));
    };

    const { data } = supabaseClient.auth.onAuthStateChange((event, session) => {
      const authorized = isAuthorizedUser(session);

      if (event === 'INITIAL_SESSION') {
        if (session && authorized) {
          handleAuthorized(session, data.subscription);
        } else if (!settled) {
          handleUnauthorized(data.subscription, 'No active Supabase session');
        }
        return;
      }

      if (event === 'SIGNED_IN') {
        if (session && authorized) {
          handleAuthorized(session, data.subscription);
        } else {
          handleUnauthorized(data.subscription, 'Unauthorized account');
        }
        return;
      }

      if (event === 'SIGNED_OUT') {
        if (!settled) {
          cleanup(data.subscription);
          redirectToLogin();
          reject(new Error('Signed out'));
        }
      }
    });

    supabaseClient.auth
      .getSession()
      .then(({ data: sessionData }) => {
        if (settled || !sessionData?.session) return;
        const authorized = isAuthorizedUser(sessionData.session);
        if (authorized) {
          handleAuthorized(sessionData.session, data.subscription);
        }
      })
      .catch((error) => console.error('Session prefetch error', error));
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
  const navItems = document.querySelectorAll('[data-auth-visible]');
  const guestItems = document.querySelectorAll('[data-auth-guest]');
  if (!navItems.length && !guestItems.length) return;

  const session = sessionFromEvent ?? (await supabaseClient.auth.getSession()).data?.session;
  const isAuthorized = isAuthorizedUser(session);

  if (isAuthorized) {
    navItems.forEach((item) => item.classList.remove('hidden'));
    guestItems.forEach((item) => item.classList.add('hidden'));
  } else {
    navItems.forEach((item) => item.classList.add('hidden'));
    guestItems.forEach((item) => item.classList.remove('hidden'));
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

const autoStart = () => {
  const path = window.location.pathname.toLowerCase();
  const isAdminRoute = path.includes('/admin/');
  const isControlView = path.endsWith('/vehicles.html') || path.endsWith('vehicles.html');
  const isLoginPage = path.endsWith('/login.html') || path.endsWith('login.html');

  if ((isAdminRoute || isControlView) && !isLoginPage) {
    enforceAdminGuard().catch((error) => console.error('Authentication guard failed', error));
  }

  syncNavigationVisibility().catch((error) => console.error('Navigation auth sync failed', error));
  supabaseClient.auth.onAuthStateChange((event, session) => {
    syncNavigationVisibility(session).catch((error) => console.error('Navigation auth sync failed', error));

    if (event === 'SIGNED_OUT') {
      const isProtectedRoute = isAdminRoute || isControlView;
      if (isProtectedRoute && !isLoginPage) {
        redirectToLogin();
      }
    }
  });
};

autoStart();

export {
  supabaseClient,
  enforceAdminGuard,
  requireSession,
  redirectToLogin,
  redirectToAdminHome,
  redirectToHome,
  setupLogoutButton,
  LOGIN_PAGE,
  ADMIN_HOME,
  HOME_PAGE,
};
