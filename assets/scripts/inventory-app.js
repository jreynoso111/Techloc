import { setupBackgroundManager } from './backgroundManager.js';
setupBackgroundManager();

import {
  DashboardState,
  DEFAULT_SEGMENT_KEY,
  COLUMN_STORAGE_KEY,
  PREFERENCES_STORAGE_KEY,
  CONFIG_TABLE,
  CONFIG_TABLE_NAME,
  formatDate,
  formatColumnLabel,
  getColumnLabel,
  applyColumnLabelOverrides,
  setColumnLabelOverride,
  buildSchemaFromData,
  getColumnValues,
  getUniqueValues,
  detectDateKey,
  detectSalesChannelKey,
  detectLastLeadKey,
  detectUnitTypeKey,
  detectVehicleStatusKey,
  detectTruthyColumnValue,
  detectCategoryKeys,
  normalizeBoolean,
  detectInvPrepStatusKey,
  formatInvPrepStatusLabel,
} from './core/state.js';
import { initDashboardUI } from './ui/uiController.js';
import {
  getSupabaseClient,
  hydrateVehiclesFromSupabase,
  initializeSupabaseRealtime,
} from './api/supabase.js';
import { getVehicles } from './services/fleetService.js';

// ==========================================================
// 1) UTILIDADES DE ICONOS Y DEBUG
// ==========================================================

const createLucideSvg = (name, className = '') => {
  const iconDef = lucide?.icons?.[name];
  if (!iconDef) return null;
  const svgString = iconDef.toSvg({ class: className, 'data-lucide': name, 'data-lucide-initialized': 'true' });
  const wrapper = document.createElement('span');
  wrapper.innerHTML = svgString;
  return wrapper.firstElementChild;
};

const initializeLucideIcons = (root = document) => {
  if (!lucide?.icons) return;
  const icons = [];
  if (root.matches?.('[data-lucide]')) icons.push(root);
  root.querySelectorAll?.('[data-lucide]').forEach((icon) => icons.push(icon));
  icons.forEach((icon) => {
    if (icon.getAttribute('data-lucide-initialized') === 'true') return;
    const name = icon.getAttribute('data-lucide');
    const className = icon.getAttribute('class') || '';
    const svgEl = createLucideSvg(name, className);
    if (svgEl) icon.replaceWith(svgEl);
  });
};

const updateLucideIcon = (icon, name) => {
  if (!icon) return;
  icon.setAttribute('data-lucide', name);
  icon.removeAttribute('data-lucide-initialized');
  initializeLucideIcons(icon);
};

initializeLucideIcons();

const PILL_CLASSES = 'rounded-xl border border-slate-700 bg-slate-950/60 px-2 py-1 text-[10px] hover:bg-slate-900/60';
const SUPABASE_URL = '';   
const SUPABASE_ANON_KEY = ''; 

const showDebug = (title, detail, obj) => {
  const banner = document.getElementById('debug-banner');
  const text = document.getElementById('debug-text');
  const pre = document.getElementById('debug-pre');
  if (!banner) return;
  banner.classList.remove('hidden');
  text.textContent = `${title} — ${detail || ''}`.trim();
  pre.textContent = obj ? JSON.stringify(obj, null, 2) : '';
  document.getElementById('debug-copy').onclick = async () => {
    const payload = `${title}\n${detail || ''}\n\n${pre.textContent}`.trim();
    try { await navigator.clipboard.writeText(payload); } catch {}
  };
};

const setConnectionStatus = (status) => {
  const statusEl = document.getElementById('connection-status');
  const dotEl = document.getElementById('connection-dot');
  if (!statusEl || !dotEl) return;
  statusEl.textContent = status;
  dotEl.className = 'h-2.5 w-2.5 rounded-full';
  if (status === 'Live') dotEl.classList.add('bg-emerald-400', 'shadow-[0_0_10px_rgba(52,211,153,0.8)]');
  else if (status.includes('Reconnect')) dotEl.classList.add('bg-amber-400', 'shadow-[0_0_10px_rgba(251,191,36,0.8)]');
  else dotEl.classList.add('bg-slate-500');
};

// ==========================================================
// 2) LÓGICA DE ALERTAS Y DEALS
// ==========================================================

let supabaseClient = null;
let alertsDealsRows = [];
let alertsDealsFilter = 'all';
let alertsDealsFilterOptions = [];
const ALERTS_STORAGE_PREFIX = 'alertsDeals';
const ALERTS_COLUMNS_STORAGE_KEY = `${ALERTS_STORAGE_PREFIX}:columns`;
const ALERTS_COLUMNS_LABELS_KEY = `${ALERTS_STORAGE_PREFIX}:columnLabels`;
let alertsDealsColumns = [];
let alertsDealsColumnLabels = {};
let alertsDealsAvailableColumns = [];
let alertsDealsSortKey = '';
let alertsDealsSortDirection = 'asc';

const setAlertsDealCount = (count) => {
  const badge = document.getElementById('alerts-deals-count');
  const modalCount = document.querySelector('[data-alerts-deals-count]');
  const row = document.getElementById('alerts-deals-row');
  const rowCount = document.getElementById('alerts-deals-row-count');
  if (!badge) return;
  const safeCount = Number(count) || 0;
  if (safeCount <= 0) {
    badge.classList.add('hidden');
    if (modalCount) modalCount.textContent = '0';
    if (rowCount) rowCount.textContent = '0';
    return;
  }
  badge.textContent = String(safeCount);
  if (modalCount) modalCount.textContent = String(safeCount);
  badge.classList.remove('hidden');
  row?.classList.remove('hidden');
  if (rowCount) rowCount.textContent = String(safeCount);
};

const getAlertsColumnLabel = (key) => alertsDealsColumnLabels[key] || formatColumnLabel(key);
const getStatusBadgeClasses = (status) => {
  const normalized = String(status || '').trim().toUpperCase();
  const base = 'rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase';
  if (normalized === 'ACTIVE') return `${base} border-emerald-500/40 bg-emerald-500/10 text-emerald-200`;
  if (normalized === 'STOCK') return `${base} border-blue-500/40 bg-blue-500/10 text-blue-200`;
  if (normalized === 'STOLEN') return `${base} border-rose-500/40 bg-rose-500/10 text-rose-200`;
  return `${base} border-slate-500/40 bg-slate-500/10 text-slate-200`;
};

const getAlertsColumnValue = (row, key, vin, vinQuery) => {
  if (key === 'VIN') {
    return vin ? `<a class="text-blue-200 underline" href="https://www.google.com/search?q=%22${vinQuery}%22" target="_blank">${vin}</a>` : '—';
  }
  const value = row?.[key];
  return (value === null || value === undefined || value === '') ? '—' : String(value);
};

const renderAlertsDealsList = (rows) => {
  const list = document.getElementById('alerts-deals-list');
  if (!list) return;
  list.innerHTML = '';
  if (!rows?.length) {
    list.innerHTML = '<p class="text-xs text-slate-400">No matching deals found.</p>';
    return;
  }
  rows.forEach((row) => {
    const vin = row.VIN || '';
    const vinQuery = encodeURIComponent(vin);
    const storageKey = vin ? `${ALERTS_STORAGE_PREFIX}:${vin}` : '';
    const storedNote = storageKey ? localStorage.getItem(`${storageKey}:note`) : '';
    const storedClick = storageKey ? localStorage.getItem(`${storageKey}:lastClick`) : '';
    const visibleColumns = alertsDealsColumns.length ? alertsDealsColumns : ['VIN', 'Vehicle Status', 'Current Stock No', 'Physical Location', 'Inventory Preparation Status'];
    const columnMarkup = visibleColumns.map((key) => `<span><span class="text-slate-400">${getAlertsColumnLabel(key)}:</span> ${getAlertsColumnValue(row, key, vin, vinQuery)}</span>`).join('');
    
    const item = document.createElement('div');
    item.className = 'rounded-xl border border-slate-800 bg-slate-950/40 p-3';
    item.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <span class="${getStatusBadgeClasses(row['Vehicle Status'])}">${row['Vehicle Status'] || 'Unknown'}</span>
        ${vin ? `<button data-alerts-google-button data-alerts-google-target="${vin}" class="text-[10px] uppercase border border-slate-700 px-2 py-1 rounded-full">Google</button>` : ''}
      </div>
      <div class="mt-2 text-xs text-slate-200 flex flex-wrap gap-2">${columnMarkup}</div>
      <div class="mt-2"><input type="text" class="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs" placeholder="Notes..." data-alerts-notes-key="${storageKey}" value="${storedNote || ''}"></div>
    `;
    list.appendChild(item);
  });
};

const fetchAlertsDealCount = async () => {
  if (!supabaseClient?.from) return;
  const { data, error } = await supabaseClient.from('DealsJP1').select('*');
  if (error || !Array.isArray(data)) return;
  const onlineRows = data.filter((row) => {
    const status = String(row['Vehicle Status'] || '').trim().toUpperCase();
    const prepStatus = String(row['Inventory Preparation Status'] || '').trim().toLowerCase();
    return ['ACTIVE', 'STOCK', 'STOLEN'].includes(status) && 
           ['out for repo', 'stolen', 'accidented', 'accident', 'stolen vehicle', 'third party repair shop'].includes(prepStatus);
  });
  setAlertsDealCount(onlineRows.length);
  alertsDealsRows = onlineRows;
  updateAlertsDealsList();
};

// ==========================================================
// 3) ESTADO DEL DASHBOARD Y NORMALIZACIÓN
// ==========================================================

const getVehicleKey = (vehicle) => vehicle.id ?? '';

const normalizeVehicle = (vehicle) => {
  const updatedAt = getField(vehicle, 'Updated At', 'Updated', 'Last Updated');
  const createdAt = getField(vehicle, 'Created At');
  const dateValue = getField(vehicle, 'Date') || updatedAt || createdAt;
  const vin = getField(vehicle, 'VIN');
  return {
    ...vehicle,
    id: vehicle.id || getField(vehicle, 'Current Stock No') || vin,
    vin,
    status: String(getField(vehicle, 'Vehicle Status') || 'Active'),
    isLastDeal: normalizeBoolean(getField(vehicle, 'Last Deal', 'last_deal')),
    'Physical Location': String(getField(vehicle, 'Physical Location') || ''),
  };
};

const getField = (row, ...keys) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') return row[key];
  }
  return '';
};

// ==========================================================
// 4) LÓGICA DE PERSISTENCIA Y LAYOUT
// ==========================================================

const persistDashboardPreferences = async () => {
  const payload = buildPreferencesPayload();
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(payload));
  if (supabaseClient && DashboardState.preferences.userId) {
    await supabaseClient.from(CONFIG_TABLE).upsert({ 
      user_id: DashboardState.preferences.userId, 
      table_name: CONFIG_TABLE_NAME, 
      config: payload 
    });
  }
};

const buildPreferencesPayload = () => ({
  layout: DashboardState.layout,
  table: DashboardState.table,
  filters: DashboardState.filters,
  chart: { chartSegments: DashboardState.chartSegments, chartVisibility: DashboardState.chartVisibility }
});

const schedulePersistPreferences = () => {
  if (DashboardState.preferences.saveTimer) clearTimeout(DashboardState.preferences.saveTimer);
  DashboardState.preferences.saveTimer = setTimeout(() => persistDashboardPreferences(), 500);
};

// ==========================================================
// 5) PANEL RESIZING (AQUÍ ESTÁ LA CORRECCIÓN DE LA 2DA FILA)
// ==========================================================

const initializeResizablePanels = () => {
  // Selectores Fila 1
  const container = document.getElementById('deal-alerts-layout');
  const handle = document.getElementById('panel-resizer');
  const dealPanel = document.getElementById('deal-status-panel');
  const alertsPanel = document.getElementById('alerts-panel');
  const chartHandle = document.getElementById('chart-resizer');
  const primaryChart = document.getElementById('status-primary-card');
  const secondaryChart = document.getElementById('status-secondary-card');
  const heightHandle = document.getElementById('panel-height-resizer');

  // Selectores Fila 2 (Ajustados al nuevo HTML)
  const fullChartsLayout = document.getElementById('full-charts-layout');
  const fullChartResizer = document.getElementById('full-chart-resizer');
  const fullChartCards = document.querySelectorAll('[data-full-chart-card]');
  const fullChartHeightHandle = document.getElementById('full-chart-height-resizer');

  if (!container || !handle) return;

  // --- Resizing Horizontal Fila 1 (Alerts) ---
  handle.addEventListener('pointerdown', (e) => {
    if (window.innerWidth < 1024) return;
    const startX = e.clientX;
    const startWidth = alertsPanel.getBoundingClientRect().width;
    const onMove = (em) => {
      const delta = startX - em.clientX;
      alertsPanel.style.flex = `0 0 ${Math.max(200, startWidth + delta)}px`;
    };
    const onUp = () => {
      DashboardState.layout.alertsPanelWidth = alertsPanel.getBoundingClientRect().width;
      schedulePersistPreferences();
      window.removeEventListener('pointermove', onMove);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });

  // --- Resizing Horizontal Fila 1 (Charts) ---
  chartHandle?.addEventListener('pointerdown', (e) => {
    const startX = e.clientX;
    const startWidth = primaryChart.getBoundingClientRect().width;
    const onMove = (em) => {
      const delta = em.clientX - startX;
      primaryChart.style.flex = `0 0 ${Math.max(200, startWidth + delta)}px`;
    };
    const onUp = () => {
      DashboardState.layout.chartSplitWidth = primaryChart.getBoundingClientRect().width;
      schedulePersistPreferences();
      window.removeEventListener('pointermove', onMove);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });

  // --- NUEVO: Resizing Horizontal Fila 2 ---
  fullChartResizer?.addEventListener('pointerdown', (e) => {
    const firstFullCard = fullChartCards[0];
    const secondFullCard = fullChartCards[1];
    if (!firstFullCard) return;
    const startX = e.clientX;
    const startWidth = firstFullCard.getBoundingClientRect().width;
    const onMove = (em) => {
      const delta = em.clientX - startX;
      firstFullCard.style.flex = `0 0 ${Math.max(200, startWidth + delta)}px`;
    };
    const onUp = () => {
      // Guardamos la preferencia si lo deseas o simplemente dejamos el estilo
      schedulePersistPreferences();
      window.removeEventListener('pointermove', onMove);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });

  // --- Resizing Vertical Fila 1 ---
  heightHandle?.addEventListener('pointerdown', (e) => {
    const startY = e.clientY;
    const startHeight = dealPanel.getBoundingClientRect().height;
    const onMove = (em) => {
      const h = Math.max(200, startHeight + (em.clientY - startY));
      dealPanel.style.height = `${h}px`;
      alertsPanel.style.height = `${h}px`;
    };
    const onUp = () => {
      DashboardState.layout.dealPanelHeight = dealPanel.getBoundingClientRect().height;
      schedulePersistPreferences();
      window.removeEventListener('pointermove', onMove);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });

  // --- NUEVO: Resizing Vertical Fila 2 ---
  fullChartHeightHandle?.addEventListener('pointerdown', (e) => {
    const startY = e.clientY;
    const startHeight = fullChartCards[0].getBoundingClientRect().height;
    const onMove = (em) => {
      const h = Math.max(200, startHeight + (em.clientY - startY));
      fullChartCards.forEach(card => card.style.height = `${h}px`);
    };
    const onUp = () => {
      DashboardState.layout.fullChartHeight = fullChartCards[0].getBoundingClientRect().height;
      schedulePersistPreferences();
      window.removeEventListener('pointermove', onMove);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });
};

// ==========================================================
// 6) INICIALIZACIÓN Y BOOT
// ==========================================================

const ui = initDashboardUI({
  applyFilters,
  getCurrentDataset,
  getSegmentOptions,
  getSegmentLabel,
  ensureChartVisibilityState,
  setChartHiddenValues,
  getOrderedColumns,
  getVehicleKey,
  PILL_CLASSES,
  syncTopScrollbar: () => {},
  createIcons: () => lucide?.createIcons?.(),
});

let { renderDashboard, openDrawer, closeDrawer } = ui;

(async () => {
  setConnectionStatus('Booting…');
  supabaseClient = await getSupabaseClient({ 
    supabaseUrl: SUPABASE_URL, 
    supabaseAnonKey: SUPABASE_ANON_KEY, 
    showDebug 
  });
  
  await loadDashboardPreferences();
  applyLayoutPreferencesToDom();
  
  if (supabaseClient) {
    await fetchAlertsDealCount();
    await hydrateVehiclesFromSupabase({
      supabaseClient,
      setConnectionStatus,
      renderDashboard,
      showDebug,
      buildSchemaFromData,
      setVehiclesFromArray,
      initializeTablePreferences,
      setupFilters,
      getField,
    });
    initializeSupabaseRealtime({ supabaseClient, setConnectionStatus, handleVehicleChange: (p) => {
      const record = p.new || p.old;
      const normalized = normalizeVehicle(record);
      DashboardState.vehiclesRaw.set(getVehicleKey(normalized), normalized);
      renderDashboard();
    }});
  }
  
  initializeResizablePanels();
})();

// Mobile nav & simple events
document.getElementById('mobile-menu-toggle')?.addEventListener('click', () => {
  document.getElementById('primary-nav')?.classList.toggle('hidden');
});
