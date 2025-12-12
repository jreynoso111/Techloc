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

  // Rutas protegidas
  const protectedRoutes = [
    (path) => path.endsWith('/vehicles.html') || path.endsWith('vehicles.html'),
    (path) => path.includes('/admin/'),
  ];

  const mapsTo = (page) => {
    const normalizedPage = page.startsWith('/') ? page.slice(1) : page;
    const currentPath = window.location.pathname;
    const normalizedPath = currentPath.toLowerCase();
    const repoSegment = '/techloc/';
    const repoIndex = normalizedPath.indexOf(repoSegment);
    const basePath = repoIndex !== -1 ? currentPath.slice(0, repoIndex + repoSegment.length) : '/';
    return `${basePath}${normalizedPage}`;
  };

  // --- NUEVO: Función para obtener el rol y estado desde la tabla profiles ---
  const fetchUserProfile = async (userId) => {
    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('role, status')
        .eq('id', userId)
        .single();

      if (error || !data)
        return {
          role: 'user',
          status: 'active',
        }; // Valores por defecto si falla

      return {
        role: data.role || 'user',
        status: data.status || 'active',
      };
    } catch (err) {
      console.error('Error fetching role:', err);
      return {
        role: 'user',
        status: 'active',
      };
    }
  };

  const updateNav = (hasSession, role, status) => // <--- Modificado para aceptar 'role' y 'status'
    whenDomReady.then(() => {
      const controlLink = getNavElement('control');
      const dashboardLink = getNavElement('dashboard');
      const loginLink = getNavElement('login');
      const logoutButton = getNavElement('logout');

      const isSuspended = status === 'suspended';

      if (hasSession && !isSuspended) {
        // Lógica de visualización basada en sesión
        controlLink?.classList.remove('hidden');
        controlLink?.classList.add('md:inline-flex');
        
        // --- EJEMPLO: Solo mostrar Dashboard a administradores ---
        if (role === 'administrator') {
            dashboardLink?.classList.remove('hidden');
            dashboardLink?.classList.add('md:inline-flex');
        } else {
            dashboardLink?.classList.add('hidden');
        }

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

  const enforceRouteProtection = (hasSession, role) => {
    const isAdminPath = window.location.pathname.toLowerCase().includes('/admin/');

    if (!hasSession && isProtectedRoute()) {
      window.location.replace(mapsTo('login.html'));
      return;
    }

    if (hasSession && isAdminPath && role !== 'administrator') {
      window.location.replace(mapsTo('index.html'));
      return;
    }

    if (window.currentUserStatus === 'suspended' && isProtectedRoute()) {
      window.supabaseClient?.auth.signOut();
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
      let userRole = 'user'; // Rol por defecto
      let userStatus = 'active';

      // --- NUEVO: Si hay sesión, buscamos el rol en la base de datos ---
      if (hasSession && data.session.user) {
        const profile = await fetchUserProfile(data.session.user.id);
        userRole = profile.role;
        userStatus = profile.status.toLowerCase();

        // Guardamos el rol y estado globalmente para usarlo en otros scripts
        window.currentUserRole = userRole;
        window.currentUserStatus = userStatus;

        // Opcional: Añadir al body para usar CSS (ej: body[data-role="admin"] .delete-btn { display: block; })
        document.body.setAttribute('data-user-role', userRole);
        document.body.setAttribute('data-user-status', userStatus);

        // Disparamos un evento para avisar a otros scripts que el rol está listo
        window.dispatchEvent(
          new CustomEvent('auth:role-ready', { detail: { role: userRole, status: userStatus } })
        );
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

      updateNav(hasSession, userRole, userStatus); // Pasamos el rol y estado
      toggleProtectedBlocks(hasSession);
      enforceRouteProtection(hasSession, userRole);
      bindLogout();

      supabaseClient.auth.onAuthStateChange(async (event, session) => {
        const sessionExists = Boolean(session);
        let updatedRole = 'user';
        let updatedStatus = 'active';

        if (sessionExists && session.user) {
           const profile = await fetchUserProfile(session.user.id);
           updatedRole = profile.role;
           updatedStatus = profile.status.toLowerCase();
           window.currentUserRole = updatedRole;
           window.currentUserStatus = updatedStatus;
           document.body.setAttribute('data-user-role', updatedRole);
           document.body.setAttribute('data-user-status', updatedStatus);
        } else {
           window.currentUserRole = null;
           window.currentUserStatus = null;
           document.body.removeAttribute('data-user-role');
           document.body.removeAttribute('data-user-status');
        }

        const onLoginPage = window.location.pathname.toLowerCase().includes('/login.html');

        updateNav(sessionExists, updatedRole, updatedStatus);
        toggleProtectedBlocks(sessionExists);
        enforceRouteProtection(sessionExists, updatedRole);

        if (event === 'SIGNED_IN' && onLoginPage) {
          window.location.replace(mapsTo('index.html'));
          return;
        }

        if (event === 'SIGNED_OUT' && isProtectedRoute()) {
          window.location.replace(mapsTo('login.html'));
        }
      });
    } catch (error) {
      console.error('Failed to verify Supabase session', error);
      enforceRouteProtection(false, null);
      updateNav(false, null, null);
      toggleProtectedBlocks(false);
    }
  };

  startAuthFlow();
})();
