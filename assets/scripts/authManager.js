(function () {
  const supabaseClient = window.supabaseClient;
  if (!supabaseClient) {
    console.error('Supabase client not initialized. Ensure supabaseClient.js runs before authManager.js.');
    return;
  }

  const whenDomReady = new Promise((resolve) => {
    if (document.readyState !== 'loading') {
      resolve();
      return;
    }
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });

  const navIds = {
    control: 'nav-control-view',
    dashboard: 'nav-dashboard',
    login: 'nav-login',
    logout: 'nav-logout',
  };

  const getNavElement = (key) => document.getElementById(navIds[key]);

  const protectedRoutes = [
    (path) => path.endsWith('/vehicles.html') || path.endsWith('vehicles.html'),
    (path) => path.includes('/admin/index.html'),
  ];

  const mapsTo = (page) => {
    const normalizedPage = page.startsWith('/') ? page.slice(1) : page;
    const path = window.location.pathname;
    const repoSegment = '/Techloc/';
    const repoIndex = path.toLowerCase().indexOf(repoSegment.toLowerCase());

    if (repoIndex !== -1) {
      const base = path.slice(0, repoIndex + repoSegment.length);
      return `${base}${normalizedPage}`;
    }

    return `/${normalizedPage}`;
  };

  const updateNav = (hasSession) =>
    whenDomReady.then(() => {
      const controlLink = getNavElement('control');
      const dashboardLink = getNavElement('dashboard');
      const loginLink = getNavElement('login');
      const logoutButton = getNavElement('logout');

      if (hasSession) {
        controlLink?.classList.remove('hidden');
        controlLink?.classList.add('md:inline-flex');
        dashboardLink?.classList.remove('hidden');
        dashboardLink?.classList.add('md:inline-flex');
        logoutButton?.classList.remove('hidden');
        loginLink?.classList.add('hidden');
      } else {
        controlLink?.classList.add('hidden');
        controlLink?.classList.remove('md:inline-flex');
        dashboardLink?.classList.add('hidden');
        dashboardLink?.classList.remove('md:inline-flex');
        logoutButton?.classList.add('hidden');
        loginLink?.classList.remove('hidden');
      }
    });

  const toggleProtectedBlocks = (hasSession) =>
    whenDomReady.then(() => {
      const loading = document.querySelector('[data-auth-loading]');
      const protectedBlocks = document.querySelectorAll('[data-auth-protected]');

      if (hasSession) {
        loading?.remove();
        protectedBlocks.forEach((block) => {
          block.classList.remove('hidden');
          block.removeAttribute('aria-hidden');
        });
        return;
      }

      loading?.classList.remove('hidden');
      protectedBlocks.forEach((block) => {
        block.classList.add('hidden');
        block.setAttribute('aria-hidden', 'true');
      });
    });

  const isProtectedRoute = () => {
    const path = window.location.pathname.toLowerCase();
    return protectedRoutes.some((matcher) => matcher(path));
  };

  const enforceRouteProtection = (hasSession) => {
    if (!hasSession && isProtectedRoute()) {
      window.location.replace(mapsTo('login.html'));
    }
  };

  const bindLogout = () => {
    whenDomReady.then(() => {
      const logoutButton = getNavElement('logout');
      if (!logoutButton || logoutButton.dataset.bound === 'true') return;

      logoutButton.dataset.bound = 'true';
      logoutButton.addEventListener('click', async (event) => {
        event.preventDefault();
        try {
          await supabaseClient.auth.signOut();
        } catch (error) {
          console.error('Error during Supabase sign out', error);
        }
      });
    });
  };

  const startAuthFlow = async () => {
    try {
      const { data } = await supabaseClient.auth.getSession();
      const hasSession = Boolean(data?.session);
      updateNav(hasSession);
      toggleProtectedBlocks(hasSession);
      enforceRouteProtection(hasSession);
      bindLogout();

      supabaseClient.auth.onAuthStateChange((event, session) => {
        const sessionExists = Boolean(session);
        updateNav(sessionExists);
        toggleProtectedBlocks(sessionExists);
        enforceRouteProtection(sessionExists);

        if (event === 'SIGNED_OUT') {
          window.location.replace(mapsTo('index.html'));
        }
      });
    } catch (error) {
      console.error('Failed to verify Supabase session', error);
      enforceRouteProtection(false);
      updateNav(false);
      toggleProtectedBlocks(false);
    }
  };

  startAuthFlow();
})();
