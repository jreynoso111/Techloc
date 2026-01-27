// ... (manten tus imports y constantes iniciales igual)

const initializeResizablePanels = () => {
  const container = document.getElementById('deal-alerts-layout');
  const handle = document.getElementById('panel-resizer');
  const dealPanel = document.getElementById('deal-status-panel');
  const alertsPanel = document.getElementById('alerts-panel');
  
  // Resizers de la Primera Fila
  const chartsLayout = document.getElementById('deal-charts-layout');
  const chartHandle = document.getElementById('chart-resizer');
  const primaryChart = document.getElementById('status-primary-card');
  const secondaryChart = document.getElementById('status-secondary-card');
  const heightHandle = document.getElementById('panel-height-resizer');

  // Resizers de la Segunda Fila (Nuevos IDs del HTML corregido)
  const fullChartsLayout = document.getElementById('full-charts-layout');
  const fullChartResizer = document.getElementById('full-chart-resizer');
  const fullChartHeightHandle = document.getElementById('full-chart-height-resizer');
  const fullChartCards = document.querySelectorAll('[data-full-chart-card]');

  if (!container || !handle) return;

  const minWidth = 220;
  const minHeight = 220;

  // --- Lógica: División Horizontal (Alerts vs Charts) ---
  let isDraggingPanel = false;
  handle.addEventListener('pointerdown', (e) => {
    if (window.innerWidth < 1024) return;
    isDraggingPanel = true;
    document.body.classList.add('select-none', 'resize-col');
    const startX = e.clientX;
    const startAlertsWidth = alertsPanel.getBoundingClientRect().width;

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(minWidth, startAlertsWidth - delta);
      alertsPanel.style.flex = `0 0 ${nextWidth}px`;
    };

    const onUp = () => {
      isDraggingPanel = false;
      document.body.classList.remove('select-none', 'resize-col');
      DashboardState.layout.alertsPanelWidth = alertsPanel.getBoundingClientRect().width;
      schedulePersistPreferences();
      window.removeEventListener('pointermove', onMove);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });

  // --- Lógica: División Horizontal Segunda Fila (Gráfico vs Gráfico) ---
  if (fullChartResizer && fullChartsLayout) {
    fullChartResizer.addEventListener('pointerdown', (e) => {
      const firstCard = fullChartCards[0];
      const secondCard = fullChartCards[1];
      if (!firstCard || !secondCard) return;

      document.body.classList.add('select-none', 'resize-col');
      const startX = e.clientX;
      const startFirstWidth = firstCard.getBoundingClientRect().width;

      const onMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = Math.max(minWidth, startFirstWidth + delta);
        firstCard.style.flex = `0 0 ${nextWidth}px`;
        secondCard.style.flex = '1 1 auto';
      };

      const onUp = () => {
        document.body.classList.remove('select-none', 'resize-col');
        // Puedes crear una nueva clave en el state si quieres persistir este split por separado
        schedulePersistPreferences();
        window.removeEventListener('pointermove', onMove);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    });
  }

  // --- Lógica: Redimensionamiento de Altura (Segunda Fila) ---
  if (fullChartHeightHandle && fullChartCards.length) {
    fullChartHeightHandle.addEventListener('pointerdown', (e) => {
      if (fullChartCards[0].dataset.collapsed === 'true') return;
      
      document.body.classList.add('select-none', 'resize-row');
      const startY = e.clientY;
      const startHeight = fullChartCards[0].getBoundingClientRect().height;

      const onMove = (moveEvent) => {
        const delta = moveEvent.clientY - startY;
        const nextHeight = Math.max(minHeight, startHeight + delta);
        fullChartCards.forEach(card => card.style.height = `${nextHeight}px`);
      };

      const onUp = () => {
        document.body.classList.remove('select-none', 'resize-row');
        DashboardState.layout.fullChartHeight = fullChartCards[0].getBoundingClientRect().height;
        schedulePersistPreferences();
        window.removeEventListener('pointermove', onMove);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    });
  }

  // --- Inicializar estados desde DashboardState ---
  if (typeof DashboardState.layout.fullChartHeight === 'number') {
    fullChartCards.forEach(card => card.style.height = `${DashboardState.layout.fullChartHeight}px`);
  }
};
// ... (continúa con el resto del archivo)
