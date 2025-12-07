const SUPABASE_URL = 'https://ewgtclzscwbokxmzxbcu.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3Z3RjbHpzY3dib2t4bXp4YmN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwODA3MzIsImV4cCI6MjA4MDY1NjczMn0.QkM72rVeBpm6uGgBVdG4ulIzEg3V_7T8usqvIf6vBto';

const LOGIN_PAGE = new URL('../../login.html', import.meta.url).toString();
const ADMIN_HOME = new URL('../../Admin/index.html', import.meta.url).toString();

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const redirectToLogin = () => {
  window.location.href = LOGIN_PAGE;
};

const redirectToAdminHome = () => {
  window.location.href = ADMIN_HOME;
};

const requireSession = async () => {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error || !data?.session) {
    redirectToLogin();
    throw new Error('No active Supabase session');
  }
  return data.session;
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

const enforceAdminGuard = async () => {
  const session = await requireSession();
  await waitForDom();
  setupLogoutButton();
  return session;
};

const autoStart = () => {
  const path = window.location.pathname.toLowerCase();
  const isAdminRoute = path.includes('/admin/');
  const isLoginPage = path.endsWith('/login.html') || path.endsWith('login.html');

  if (isAdminRoute && !isLoginPage) {
    enforceAdminGuard().catch((error) => console.error('Authentication guard failed', error));
  }
};

autoStart();

export {
  supabaseClient,
  enforceAdminGuard,
  requireSession,
  redirectToLogin,
  redirectToAdminHome,
  setupLogoutButton,
  LOGIN_PAGE,
  ADMIN_HOME,
};
