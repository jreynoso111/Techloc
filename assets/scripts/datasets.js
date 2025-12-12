(() => {
  const isAdminRoute = window.location.pathname.toLowerCase().includes('/admin/');
  const basePath = isAdminRoute ? '../assets/data/' : 'assets/data/';
  const csvPath = (name) => `${basePath}${name}.csv`;

  const paths = {
    installers: csvPath('installers'),
    vehicles: csvPath('vehicles'),
    towing_companies: csvPath('towing_companies'),
    resellers: csvPath('resellers'),
    repair_shops: csvPath('repair_shops'),
    technicians: csvPath('technicians'),
  };

  window.TL_DATASETS = paths;
  window.getDatasetPath = (key) => paths[key] || csvPath(key);
})();
