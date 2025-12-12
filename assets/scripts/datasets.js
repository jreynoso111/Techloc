(() => {
  const isAdminRoute = window.location.pathname.toLowerCase().includes('/admin/');
  const basePath = isAdminRoute ? '../assets/data/' : 'assets/data/';
  const csvPath = (name) => `${basePath}${name}.csv`;

  const paths = {
    services: csvPath('technicians'),
    vehicles: csvPath('vehicles'),
  };

  window.TL_DATASETS = paths;
  window.getDatasetPath = (key) => paths[key] || csvPath(key);
})();
