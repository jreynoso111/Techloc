const alertsSlot = document.querySelector('[data-alerts-panel]');

const getBasePath = () => {
  const bodyBase = document.body?.dataset.basePath;
  if (bodyBase) return bodyBase;
  const path = window.location.pathname;
  if (path.includes('/pages/admin/')) return '../../';
  if (path.includes('/pages/')) return '../';
  return './';
};

const hydrateAlertsPanel = async () => {
  if (!alertsSlot) return;
  const basePath = getBasePath();

  try {
    const response = await fetch(`${basePath}assets/modules/alerts-panel.html`);
    if (!response.ok) throw new Error(`Alerts module not found (${response.status})`);
    alertsSlot.innerHTML = await response.text();
  } catch (error) {
    console.error('Alerts module failed to load:', error);
  }
};

await hydrateAlertsPanel();
