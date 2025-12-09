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

  // --- NUEVO: Función para obtener el rol desde la tabla profiles ---
  const fetchUserRole = async (userId) => {
    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();

      if (error || !data) return 'user'; // Rol por defecto si falla
      return data.role;
    } catch (err) {
      console.error('Error fetching role:', err);
      return 'user';
    }
  };

  const updateNav = (hasSession, role) => // <--- Modificado para aceptar 'role'
    whenDomReady.then(() => {
      const controlLink = getNavElement('control');
      const dashboardLink = getNavElement('dashboard');
      const loginLink = getNavElement('login');
      const logoutButton = getNavElement('logout');

      if (hasSession) {
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
          // Limpiar rol global al salir
          window.currentUserRole = null; 
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

      // --- NUEVO: Si hay sesión, buscamos el rol en la base de datos ---
      if (hasSession && data.session.user) {
        userRole = await fetchUserRole(data.session.user.id);
        
        // Guardamos el rol globalmente para usarlo en otros scripts
        window.currentUserRole = userRole; 
        
        // Opcional: Añadir al body para usar CSS (ej: body[data-role="admin"] .delete-btn { display: block; })
        document.body.setAttribute('data-user-role', userRole);
        
        // Disparamos un evento para avisar a otros scripts que el rol está listo
        window.dispatchEvent(new CustomEvent('auth:role-ready', { detail: { role: userRole } }));
      } else {
        window.currentUserRole = null;
        document.body.removeAttribute('data-user-role');
      }

      const isLoginPage = window.location.pathname.toLowerCase().includes('/login.html');
      if (hasSession && isLoginPage) {
        window.location.replace(mapsTo('index.html'));
        return;
      }

      updateNav(hasSession, userRole); // Pasamos el rol
      toggleProtectedBlocks(hasSession);
      enforceRouteProtection(hasSession);
      bindLogout();

      supabaseClient.auth.onAuthStateChange(async (event, session) => {
        const sessionExists = Boolean(session);
        let updatedRole = 'user';

        if (sessionExists && session.user) {
           updatedRole = await fetchUserRole(session.user.id);
           window.currentUserRole = updatedRole;
           document.body.setAttribute('data-user-role', updatedRole);
        } else {
           window.currentUserRole = null;
           document.body.removeAttribute('data-user-role');
        }

        const onLoginPage = window.location.pathname.toLowerCase().includes('/login.html');

        updateNav(sessionExists, updatedRole);
        toggleProtectedBlocks(sessionExists);
        enforceRouteProtection(sessionExists);

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
      enforceRouteProtection(false);
      updateNav(false, null);
      toggleProtectedBlocks(false);
    }
  };

  startAuthFlow();
})();
