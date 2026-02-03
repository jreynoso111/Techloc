import { supabase as supabaseClient } from '../js/supabaseClient.js';

(function () {
  if (!supabaseClient) {
    console.error('Supabase client not initialized. Ensure supabaseClient.js is available.');
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
    services: 'nav-services',
    login: 'nav-login',
    logout: 'nav-logout',
    userIndicator: 'nav-user-indicator',
  };

  const getNavElement = (key) => document.getElementById(navIds[key]);
  let currentSession = null;
  let pendingHeaderIndicator = false;

  const resolveUserLabel = (user) => {
    if (!user) return 'Invitado';
    const metadata = user.user_metadata || {};
    return (
      metadata.full_name ||
      metadata.name ||
      metadata.preferred_username ||
      user.email ||
      user.phone ||
      'Cuenta activa'
    );
  };

  const updateUserIndicator = (session) =>
    whenDomReady.then(() => {
      const indicator = getNavElement('userIndicator');
      if (!indicator) {
        if (!pendingHeaderIndicator) {
          pendingHeaderIndicator = true;
          window.addEventListener(
            'shared-header:loaded',
            () => {
              pendingHeaderIndicator = false;
              updateUserIndicator(currentSession);
            },
            { once: true }
          );
        }
        return;
      }
      const hasSession = Boolean(session?.user);
      const label = resolveUserLabel(session?.user);
      indicator.textContent = `Cuenta: ${label}`;
      indicator.classList.toggle('hidden', !hasSession);
      indicator.setAttribute('aria-hidden', (!hasSession).toString());
    });

  const roleAllowsDashboard = (role) => ['administrator', 'moderator'].includes(String(role || '').toLowerCase());
  const roleAllowsServiceRequests = (role) => String(role || '').toLowerCase() === 'administrator';

  // Rutas protegidas (control map served from /pages/control-map.html; root redirect removed)
  const protectedRoutes = [
    (path) => path.endsWith('/pages/control-map.html') || path.endsWith('pages/control-map.html'),
    (path) => path.endsWith('/services-request.html') || path.endsWith('services-request.html'),
    (path) => path.includes('/admin/'),
  ];

  const isServiceRequestPath = () => {
    const path = window.location.pathname.toLowerCase();
    return path.endsWith('/services-request.html') || path.endsWith('services-request.html');
  };

  const mapsTo = (page) => {
    const normalizedPage = page.startsWith('/') ? page.slice(1) : page;
    const currentPath = window.location.pathname;
    const normalizedPath = currentPath.toLowerCase();
    const repoSegment = '/techloc/';
    const repoIndex = normalizedPath.indexOf(repoSegment);
    const basePath = repoIndex !== -1 ? currentPath.slice(0, repoIndex + repoSegment.length) : '/';
    return `${basePath}${normalizedPage}`;
  };

  const profileCacheKey = (userId) => `techloc_profile_${userId}`;
  const loadCachedProfile = (userId) => {
    if (!userId) return null;
    try {
      const raw = localStorage.getItem(profileCacheKey(userId));
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn('Unable to read cached profile', error);
      return null;
    }
  };

  const saveCachedProfile = (userId, profile) => {
    if (!userId || !profile) return;
    try {
      localStorage.setItem(profileCacheKey(userId), JSON.stringify(profile));
    } catch (error) {
      console.warn('Unable to cache profile', error);
    }
  };

  // --- NUEVO: Función para obtener el rol y estado desde la tabla profiles ---
  const fetchUserProfile = async (userId) => {
    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('role, status')
        .eq('id', userId)
        .single();

      if (error || !data) {
        return {
          role: null,
          status: null,
        };
      }

      const profile = {
        role: data.role || 'user',
        status: (data.status || 'active').toLowerCase(),
      };
      saveCachedProfile(userId, profile);
      return profile;
    } catch (err) {
      console.error('Error fetching role:', err);
      return {
        role: null,
        status: null,
      };
    }
  };

  const toggleDashboardLinks = (hasSession, role, status) =>
    whenDomReady.then(() => {
      const isSuspended = status === 'suspended';
      const canShowDashboard = hasSession && !isSuspended && roleAllowsDashboard(role);
      const dashboardLinks = document.querySelectorAll('[data-dashboard-link]');

      dashboardLinks.forEach((link) => {
        if (!link) return;

        if (canShowDashboard) {
          link.classList.remove('hidden');
          link.removeAttribute('aria-hidden');
          link.removeAttribute('tabindex');
          link.style.pointerEvents = '';
        } else {
          link.classList.add('hidden');
          link.setAttribute('aria-hidden', 'true');
          link.setAttribute('tabindex', '-1');
          link.style.pointerEvents = 'none';
        }
      });
    });

  const updateNav = (hasSession, role, status) => // <--- Modificado para aceptar 'role' y 'status'
    whenDomReady.then(() => {
      const controlLink = getNavElement('control');
      const dashboardLink = getNavElement('dashboard');
      const servicesLink = getNavElement('services');
      const loginLink = getNavElement('login');
      const logoutButton = getNavElement('logout');

      const isSuspended = status === 'suspended';
      const canShowDashboard = hasSession && !isSuspended && roleAllowsDashboard(role);
      const canShowServices = hasSession && !isSuspended && roleAllowsServiceRequests(role);

      if (hasSession && !isSuspended) {
        // Lógica de visualización basada en sesión
        controlLink?.classList.remove('hidden');
        controlLink?.classList.add('md:inline-flex');

        if (canShowServices) {
          servicesLink?.classList.remove('hidden');
        } else {
          servicesLink?.classList.add('hidden');
        }

        if (canShowDashboard) {
          dashboardLink?.classList.remove('hidden');
          dashboardLink?.classList.add('md:inline-flex');
        } else {
          dashboardLink?.classList.add('hidden');
          dashboardLink?.classList.remove('md:inline-flex');
        }

        logoutButton?.classList.remove('hidden');
        loginLink?.classList.add('hidden');
      } else {
        controlLink?.classList.add('hidden');
        controlLink?.classList.remove('md:inline-flex');
        servicesLink?.classList.add('hidden');
        dashboardLink?.classList.add('hidden');
        dashboardLink?.classList.remove('md:inline-flex');
        logoutButton?.classList.add('hidden');
        loginLink?.classList.remove('hidden');
      }

      toggleDashboardLinks(hasSession, role, status);
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

  const enforceRouteProtection = (hasSession, role) => {
    const isAdminPath = window.location.pathname.toLowerCase().includes('/admin/');

    if (!hasSession && isProtectedRoute()) {
      window.location.replace(mapsTo('pages/login.html'));
      return;
    }

    if (hasSession && role && isAdminPath && !roleAllowsDashboard(role)) {
      window.location.replace(mapsTo('index.html'));
      return;
    }

    if (hasSession && role && isServiceRequestPath() && !roleAllowsServiceRequests(role)) {
      window.location.replace(mapsTo('index.html'));
      return;
    }

    if (window.currentUserStatus === 'suspended' && isProtectedRoute()) {
      supabaseClient?.auth.signOut();
      window.location.replace(mapsTo('pages/login.html'));
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
            // Limpiar rol global al salir
            window.currentUserRole = null;
            window.currentUserStatus = null;
            document.body.removeAttribute('data-user-role');
            document.body.removeAttribute('data-user-status');
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
      let userRole = null;
      let userStatus = null;

      if (hasSession && data.session.user) {
        const cachedProfile = loadCachedProfile(data.session.user.id);
        userRole = cachedProfile?.role ?? null;
        userStatus = cachedProfile?.status ?? null;
      } else {
        window.currentUserRole = null;
        window.currentUserStatus = null;
        document.body.removeAttribute('data-user-role');
        document.body.removeAttribute('data-user-status');
      }

      const isLoginPage = window.location.pathname.toLowerCase().includes('/login.html');
      if (hasSession && isLoginPage) {
        window.location.replace(mapsTo('index.html'));
        return;
      }

      currentSession = data?.session ?? null;
      if (hasSession && data.session.user) {
        window.currentUserRole = userRole;
        window.currentUserStatus = userStatus;
        if (userRole) document.body.setAttribute('data-user-role', userRole);
        if (userStatus) document.body.setAttribute('data-user-status', userStatus);
      }

      updateNav(hasSession, userRole, userStatus);
      updateUserIndicator(currentSession);
      toggleProtectedBlocks(hasSession);
      enforceRouteProtection(hasSession, userRole);
      bindLogout();

      if (hasSession && data.session.user) {
        fetchUserProfile(data.session.user.id).then((profile) => {
          const nextRole = profile?.role ?? null;
          const nextStatus = profile?.status ?? null;
          window.currentUserRole = nextRole;
          window.currentUserStatus = nextStatus;
          if (nextRole) document.body.setAttribute('data-user-role', nextRole);
          if (nextStatus) document.body.setAttribute('data-user-status', nextStatus);
          updateNav(true, nextRole, nextStatus);
          updateUserIndicator(currentSession);
          toggleProtectedBlocks(true);
          enforceRouteProtection(true, nextRole);
          if (nextRole || nextStatus) {
            window.dispatchEvent(
              new CustomEvent('auth:role-ready', { detail: { role: nextRole, status: nextStatus } })
            );
          }
        });
      }

      supabaseClient.auth.onAuthStateChange(async (event, session) => {
        currentSession = session ?? null;
        const sessionExists = Boolean(session);
        let updatedRole = null;
        let updatedStatus = null;

        if (sessionExists && session.user) {
          const cachedProfile = loadCachedProfile(session.user.id);
          updatedRole = cachedProfile?.role ?? null;
          updatedStatus = cachedProfile?.status ?? null;
          window.currentUserRole = updatedRole;
          window.currentUserStatus = updatedStatus;
          if (updatedRole) document.body.setAttribute('data-user-role', updatedRole);
          if (updatedStatus) document.body.setAttribute('data-user-status', updatedStatus);

          fetchUserProfile(session.user.id).then((profile) => {
            const nextRole = profile?.role ?? null;
            const nextStatus = profile?.status ?? null;
            window.currentUserRole = nextRole;
            window.currentUserStatus = nextStatus;
            if (nextRole) document.body.setAttribute('data-user-role', nextRole);
            if (nextStatus) document.body.setAttribute('data-user-status', nextStatus);
            updateNav(true, nextRole, nextStatus);
            updateUserIndicator(currentSession);
            toggleProtectedBlocks(true);
            enforceRouteProtection(true, nextRole);
            if (nextRole || nextStatus) {
              window.dispatchEvent(
                new CustomEvent('auth:role-ready', { detail: { role: nextRole, status: nextStatus } })
              );
            }
          });
        } else {
           window.currentUserRole = null;
           window.currentUserStatus = null;
           document.body.removeAttribute('data-user-role');
           document.body.removeAttribute('data-user-status');
        }

        const onLoginPage = window.location.pathname.toLowerCase().includes('/login.html');

        updateNav(sessionExists, updatedRole, updatedStatus);
        updateUserIndicator(currentSession);
        toggleProtectedBlocks(sessionExists);
        enforceRouteProtection(sessionExists, updatedRole);

        if (event === 'SIGNED_IN' && onLoginPage) {
          window.location.replace(mapsTo('index.html'));
          return;
        }

        if (event === 'SIGNED_OUT' && isProtectedRoute()) {
          window.location.replace(mapsTo('pages/login.html'));
        }
      });
    } catch (error) {
      console.error('Failed to verify Supabase session', error);
      currentSession = null;
      enforceRouteProtection(false, null);
      updateNav(false, null, null);
      updateUserIndicator(currentSession);
      toggleProtectedBlocks(false);
    }
  };

  startAuthFlow();
})();
