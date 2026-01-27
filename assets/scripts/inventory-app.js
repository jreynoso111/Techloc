import {
  DashboardState,
  DEFAULT_SEGMENT_KEY,
  COLUMN_STORAGE_KEY,
  PREFERENCES_STORAGE_KEY,
  buildSchemaFromData,
  detectSalesChannelKey,
  detectLastLeadKey,
  detectUnitTypeKey,
  detectVehicleStatusKey,
  getColumnLabel,
  getUniqueValues,
  formatRelativeTime,
  applyColumnLabelOverrides,
  setColumnLabelOverride,
} from './core/state.js';
import { initDashboardUI } from './ui/uiController.js';
import { getSupabaseClient, hydrateVehiclesFromSupabase, initializeSupabaseRealtime } from './api/supabase.js';
import { getField } from './dataMapper.js';

const PILL_CLASSES = 'inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]';
const PAGE_SIZE_DEFAULT = 8;
const RESIZE_MIN_WIDTH = 120;

const createIcons = () => {
  if (window.lucide?.createIcons) {
    window.lucide.createIcons();
  }
};

const safeParse = (value, fallback = null) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

const normalizeValue = (value) => String(value ?? '').trim();

const showDebug = (title, message, payload = {}) => {
  const banner = document.getElementById('debug-banner');
  if (!banner) return;
  const text = document.getElementById('debug-text');
  const pre = document.getElementById('debug-pre');
  banner.classList.remove('hidden');
  banner.querySelector('h3').textContent = title;
  if (text) text.textContent = message;
  if (pre) pre.textContent = JSON.stringify(payload, null, 2);
  const copyBtn = document.getElementById('debug-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const payloadText = pre?.textContent || '';
      navigator.clipboard?.writeText(payloadText);
    });
  }
};

const setConnectionStatus = (statusText) => {
  const statusEl = document.getElementById('connection-status');
  const dot = document.getElementById('connection-dot');
  if (statusEl) statusEl.textContent = statusText;
  if (!dot) return;
  dot.className = 'h-2.5 w-2.5 rounded-full';
  if (statusText === 'Live') {
    dot.classList.add('bg-emerald-400', 'shadow-[0_0_10px_rgba(52,211,153,0.8)]');
  } else if (statusText === 'Offline') {
    dot.classList.add('bg-rose-400', 'shadow-[0_0_10px_rgba(244,63,94,0.6)]');
  } else {
    dot.classList.add('bg-amber-400', 'shadow-[0_0_10px_rgba(251,191,36,0.8)]');
  }
};

const schedulePersistPreferences = (() => {
  let timeoutId = null;
  return () => {
    if (timeoutId) window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      persistPreferences();
      timeoutId = null;
    }, 350);
  };
})();

const persistPreferences = () => {
  const payload = {
    filters: DashboardState.filters,
    table: DashboardState.table,
    layout: DashboardState.layout,
    chartSegments: DashboardState.chartSegments,
    chartVisibility: DashboardState.chartVisibility,
  };
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(payload));
  localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(DashboardState.table.columns));
};

const hydratePreferences = () => {
  const saved = safeParse(localStorage.getItem(PREFERENCES_STORAGE_KEY), {});
  if (saved?.filters) DashboardState.filters = { ...DashboardState.filters, ...saved.filters };
  if (saved?.table) DashboardState.table = { ...DashboardState.table, ...saved.table };
  if (saved?.layout) DashboardState.layout = { ...DashboardState.layout, ...saved.layout };
  if (saved?.chartSegments) DashboardState.chartSegments = { ...DashboardState.chartSegments, ...saved.chartSegments };
  if (saved?.chartVisibility) DashboardState.chartVisibility = { ...DashboardState.chartVisibility, ...saved.chartVisibility };

  const columnPrefs = safeParse(localStorage.getItem(COLUMN_STORAGE_KEY), null);
  if (columnPrefs && typeof columnPrefs === 'object') {
    DashboardState.table.columns = { ...DashboardState.table.columns, ...columnPrefs };
  }
};

const getVehicleKey = (item) => {
  const key = item?.stockNo
    || item?.stock_no
    || item?.vin
    || item?.VIN
    || item?.id;
  return normalizeValue(key) || `row-${Math.random().toString(36).slice(2)}`;
};

const setVehiclesFromArray = (rows = []) => {
  DashboardState.vehiclesRaw = new Map();
  rows.forEach((row) => {
    DashboardState.vehiclesRaw.set(getVehicleKey(row), row);
  });
};

const getCurrentDataset = () => Array.from(DashboardState.vehiclesRaw.values());

const getOrderedColumns = (schema) => {
  const keys = schema.map((col) => col.key);
  const order = Array.isArray(DashboardState.table.columnOrder) ? DashboardState.table.columnOrder : [];
  const ordered = order.filter((key) => keys.includes(key));
  const remaining = keys.filter((key) => !ordered.includes(key));
  const fullOrder = [...ordered, ...remaining];
  return fullOrder.map((key) => schema.find((col) => col.key === key)).filter(Boolean);
};

const ensureChartVisibilityState = (chartId, segmentKey) => {
  if (!DashboardState.chartVisibility[chartId]) DashboardState.chartVisibility[chartId] = {};
  if (!DashboardState.chartVisibility[chartId][segmentKey]) DashboardState.chartVisibility[chartId][segmentKey] = [];
  return DashboardState.chartVisibility[chartId][segmentKey];
};

const setChartHiddenValues = (chartId, segmentKey, hiddenValues = []) => {
  if (!DashboardState.chartVisibility[chartId]) DashboardState.chartVisibility[chartId] = {};
  DashboardState.chartVisibility[chartId][segmentKey] = hiddenValues;
  schedulePersistPreferences();
};

const normalizeBoolean = (value) => {
  if (value === true || value === 'true' || value === 'TRUE' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 'FALSE' || value === 0 || value === '0') return false;
  return null;
};

const applyFilters = ({ ignoreChartId } = {}) => {
  const { filters } = DashboardState;
  const dataset = getCurrentDataset();
  return dataset.filter((row) => {
    if (filters.salesChannelKey && filters.salesChannels.length) {
      const raw = normalizeValue(row?.[filters.salesChannelKey]);
      if (!filters.salesChannels.map(normalizeValue).includes(raw)) return false;
    }

    if (filters.lastLeadKey && filters.lastLeadSelection !== 'all') {
      const current = normalizeBoolean(row?.[filters.lastLeadKey]);
      const selected = normalizeBoolean(filters.lastLeadSelection);
      if (selected !== null && current !== selected) return false;
    }

    if (filters.unitTypeKey && filters.unitTypeSelection.length) {
      const value = normalizeValue(row?.[filters.unitTypeKey]);
      if (!filters.unitTypeSelection.map(normalizeValue).includes(value)) return false;
    }

    if (filters.vehicleStatusKey && filters.vehicleStatusSelection.length) {
      const value = normalizeValue(row?.[filters.vehicleStatusKey]);
      if (!filters.vehicleStatusSelection.map(normalizeValue).includes(value)) return false;
    }

    const categoryFilters = filters.categoryFilters || {};
    for (const [key, value] of Object.entries(categoryFilters)) {
      if (value === 'all') continue;
      const rowValue = normalizeValue(row?.[key]);
      if (rowValue !== normalizeValue(value)) return false;
    }

    const columnFilters = filters.columnFilters || {};
    for (const [key, entry] of Object.entries(columnFilters)) {
      if (!entry) continue;
      const rowValue = normalizeValue(row?.[key]);
      if (entry.select && entry.select !== 'all' && rowValue !== normalizeValue(entry.select)) return false;
      if (entry.search && !rowValue.toLowerCase().includes(entry.search.toLowerCase())) return false;
    }

    const chartFilters = filters.chartFilters || {};
    for (const [chartId, filter] of Object.entries(chartFilters)) {
      if (chartId === ignoreChartId) continue;
      if (!filter?.key || !Array.isArray(filter.values) || !filter.values.length) continue;
      const rowValue = normalizeValue(row?.[filter.key]);
      if (!filter.values.map(normalizeValue).includes(rowValue)) return false;
    }

    return true;
  });
};

const buildSegmentOptions = () => {
  const schema = DashboardState.schema;
  const options = [];
  const findKey = (regex) => schema.find((col) => regex.test(col.key) || regex.test(col.label))?.key || '';

  const statusKey = findKey(/deal\s*status|status/i);
  const salesChannelKey = findKey(/sales\s*channel/i);
  const unitTypeKey = findKey(/unit\s*type/i);
  const vehicleStatusKey = findKey(/vehicle\s*status/i);

  if (statusKey) options.push({ key: statusKey, label: getColumnLabel(statusKey) });
  if (salesChannelKey && salesChannelKey !== statusKey) options.push({ key: salesChannelKey, label: getColumnLabel(salesChannelKey) });
  if (unitTypeKey && unitTypeKey !== statusKey) options.push({ key: unitTypeKey, label: getColumnLabel(unitTypeKey) });
  if (vehicleStatusKey && ![statusKey, unitTypeKey, salesChannelKey].includes(vehicleStatusKey)) {
    options.push({ key: vehicleStatusKey, label: getColumnLabel(vehicleStatusKey) });
  }

  if (!options.length && schema.length) {
    options.push({ key: schema[0].key, label: schema[0].label });
  }

  return options;
};

const getSegmentOptions = () => buildSegmentOptions();

const getSegmentLabel = (value, _segmentKey) => {
  const normalized = normalizeValue(value);
  return normalized || 'Unknown';
};

const initializeTablePreferences = () => {
  if (!DashboardState.schema.length) return;

  if (!DashboardState.table.perPage) DashboardState.table.perPage = PAGE_SIZE_DEFAULT;

  const savedColumns = DashboardState.table.columns;
  if (!savedColumns || Object.keys(savedColumns).length === 0) {
    DashboardState.table.columns = DashboardState.schema.reduce((acc, col) => {
      acc[col.key] = true;
      return acc;
    }, {});
  } else {
    DashboardState.table.columns = {
      ...DashboardState.schema.reduce((acc, col) => ({ ...acc, [col.key]: savedColumns[col.key] ?? true }), {}),
      ...savedColumns,
    };
  }

  if (!Array.isArray(DashboardState.table.columnOrder) || !DashboardState.table.columnOrder.length) {
    DashboardState.table.columnOrder = DashboardState.schema.map((col) => col.key);
  }

  applyColumnLabelOverrides();
};

const setupFilters = ({ preserveSelections = false } = {}) => {
  const salesChannelKey = detectSalesChannelKey(DashboardState.schema);
  const lastLeadKey = detectLastLeadKey(DashboardState.schema);
  const unitTypeKey = detectUnitTypeKey(DashboardState.schema);
  const vehicleStatusKey = detectVehicleStatusKey(DashboardState.schema);

  DashboardState.filters.salesChannelKey = salesChannelKey;
  DashboardState.filters.lastLeadKey = lastLeadKey;
  DashboardState.filters.unitTypeKey = unitTypeKey;
  DashboardState.filters.vehicleStatusKey = vehicleStatusKey;

  if (!preserveSelections) {
    DashboardState.filters.salesChannels = salesChannelKey
      ? getUniqueValues(getCurrentDataset(), salesChannelKey).slice(0, 1)
      : [];
    DashboardState.filters.unitTypeSelection = [];
    DashboardState.filters.vehicleStatusSelection = [];
  }
};

const renderSalesChannelFilters = () => {
  const panel = document.getElementById('sales-channel-panel');
  const optionsContainer = document.getElementById('sales-channel-options');
  const summary = document.getElementById('sales-channel-summary');
  const label = document.getElementById('sales-channel-label');
  if (!panel || !optionsContainer || !summary || !label) return;

  const key = DashboardState.filters.salesChannelKey;
  if (!key) {
    panel.classList.add('hidden');
    optionsContainer.innerHTML = '<p class="text-[11px] text-slate-400">No sales channel column found.</p>';
    summary.textContent = '0';
    label.textContent = 'Sales Channel';
    return;
  }

  const values = getUniqueValues(getCurrentDataset(), key);
  const selections = DashboardState.filters.salesChannels.filter((value) => values.includes(value));
  DashboardState.filters.salesChannels = selections;

  summary.textContent = String(selections.length);
  label.textContent = selections.length === 1 ? selections[0] : 'Sales Channel';

  if (!values.length) {
    optionsContainer.innerHTML = '<p class="text-[11px] text-slate-400">No options found.</p>';
    return;
  }

  optionsContainer.innerHTML = values.map((value) => `
    <label class="flex items-center gap-2">
      <input type="checkbox" value="${value}" class="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950" ${selections.includes(value) ? 'checked' : ''} />
      <span>${value}</span>
    </label>
  `).join('');
};

const mapRowForDrawer = (row) => {
  const gpsStatus = getField(row, 'GPS Status', 'gps_status');
  const gpsFlag = getField(row, 'GPS Flag', 'gps_flag');
  const completion = getField(row, 'Deal Completion', 'completion', 'deal_completion');
  const yard = getField(row, 'Yard', 'yard');
  const state = getField(row, 'State', 'state', 'state_code');
  const brand = getField(row, 'Brand', 'brand', 'make');
  const unitType = getField(row, 'Unit Type', 'unit_type');
  const createdAt = getField(row, 'Created At', 'created_at');
  const updatedAt = getField(row, 'Updated At', 'updated_at', 'Last Updated');
  return {
    vin: getField(row, 'VIN', 'vin', 'ShortVIN'),
    status: getField(row, 'Deal Status', 'status'),
    gpsStatus,
    gpsFlag,
    completion,
    yard,
    state,
    brand,
    unitType,
    createdAt,
    updatedAt,
    gpsOffline: normalizeBoolean(getField(row, 'GPS Offline', 'gps_offline')) === true,
    hold: normalizeBoolean(getField(row, 'Hold', 'hold')) === true,
    lien: normalizeBoolean(getField(row, 'Lien', 'lien')) === true,
    recoveryPriority: normalizeBoolean(getField(row, 'Recovery Priority', 'recovery_priority')) === true,
  };
};

const syncTopScrollbar = () => {
  const topScroll = document.getElementById('inventory-table-scroll-top');
  const topInner = document.getElementById('inventory-table-scroll-top-inner');
  const bodyScroll = document.getElementById('inventory-table-scroll');
  const table = document.querySelector('#inventory-table-scroll table');
  if (!topScroll || !topInner || !bodyScroll || !table) return;

  const width = table.scrollWidth;
  topInner.style.width = `${width}px`;

  const syncFromTop = () => { bodyScroll.scrollLeft = topScroll.scrollLeft; };
  const syncFromBody = () => { topScroll.scrollLeft = bodyScroll.scrollLeft; };

  topScroll.removeEventListener('scroll', syncFromTop);
  bodyScroll.removeEventListener('scroll', syncFromBody);

  topScroll.addEventListener('scroll', syncFromTop);
  bodyScroll.addEventListener('scroll', syncFromBody);
};

const initializeResizablePanels = () => {
  const container = document.getElementById('deal-alerts-layout');
  const handle = document.getElementById('panel-resizer');
  const dealPanel = document.getElementById('deal-status-panel');
  const alertsPanel = document.getElementById('alerts-panel');

  const chartsLayout = document.getElementById('deal-charts-layout');
  const chartHandle = document.getElementById('chart-resizer');
  const primaryChart = document.getElementById('status-primary-card');
  const secondaryChart = document.getElementById('status-secondary-card');
  const heightHandle = document.getElementById('panel-height-resizer');

  const fullChartsLayout = document.getElementById('full-charts-layout');
  const fullChartResizer = document.getElementById('full-chart-resizer');
  const fullChartHeightHandle = document.getElementById('full-chart-height-resizer');
  const fullChartCards = document.querySelectorAll('[data-full-chart-card]');

  if (!container || !handle) return;

  const minWidth = 220;
  const minHeight = 220;

  handle.addEventListener('pointerdown', (e) => {
    if (window.innerWidth < 1024) return;
    document.body.classList.add('select-none', 'resize-col');
    const startX = e.clientX;
    const startAlertsWidth = alertsPanel.getBoundingClientRect().width;

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(minWidth, startAlertsWidth - delta);
      alertsPanel.style.flex = `0 0 ${nextWidth}px`;
    };

    const onUp = () => {
      document.body.classList.remove('select-none', 'resize-col');
      DashboardState.layout.alertsPanelWidth = alertsPanel.getBoundingClientRect().width;
      schedulePersistPreferences();
      window.removeEventListener('pointermove', onMove);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });

  if (chartHandle && chartsLayout && primaryChart && secondaryChart) {
    chartHandle.addEventListener('pointerdown', (e) => {
      document.body.classList.add('select-none', 'resize-col');
      const startX = e.clientX;
      const startWidth = primaryChart.getBoundingClientRect().width;

      const onMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = Math.max(minWidth, startWidth + delta);
        primaryChart.style.flex = `0 0 ${nextWidth}px`;
        secondaryChart.style.flex = '1 1 auto';
      };

      const onUp = () => {
        document.body.classList.remove('select-none', 'resize-col');
        DashboardState.layout.chartSplitWidth = primaryChart.getBoundingClientRect().width;
        schedulePersistPreferences();
        window.removeEventListener('pointermove', onMove);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    });
  }

  if (heightHandle && dealPanel) {
    heightHandle.addEventListener('pointerdown', (e) => {
      document.body.classList.add('select-none', 'resize-row');
      const startY = e.clientY;
      const startHeight = dealPanel.getBoundingClientRect().height;

      const onMove = (moveEvent) => {
        const delta = moveEvent.clientY - startY;
        const nextHeight = Math.max(minHeight, startHeight + delta);
        dealPanel.style.height = `${nextHeight}px`;
      };

      const onUp = () => {
        document.body.classList.remove('select-none', 'resize-row');
        DashboardState.layout.dealPanelHeight = dealPanel.getBoundingClientRect().height;
        schedulePersistPreferences();
        window.removeEventListener('pointermove', onMove);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    });
  }

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
        schedulePersistPreferences();
        window.removeEventListener('pointermove', onMove);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    });
  }

  if (fullChartHeightHandle && fullChartCards.length) {
    fullChartHeightHandle.addEventListener('pointerdown', (e) => {
      if (fullChartCards[0].dataset.collapsed === 'true') return;

      document.body.classList.add('select-none', 'resize-row');
      const startY = e.clientY;
      const startHeight = fullChartCards[0].getBoundingClientRect().height;

      const onMove = (moveEvent) => {
        const delta = moveEvent.clientY - startY;
        const nextHeight = Math.max(minHeight, startHeight + delta);
        fullChartCards.forEach((card) => { card.style.height = `${nextHeight}px`; });
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

  if (typeof DashboardState.layout.fullChartHeight === 'number') {
    fullChartCards.forEach((card) => { card.style.height = `${DashboardState.layout.fullChartHeight}px`; });
  }
};

const setupTableInteractions = ({ renderDashboard, openDrawer, closeDrawer }) => {
  const tableHead = document.getElementById('inventory-table-head');
  const tableBody = document.getElementById('inventory-table');

  tableHead.querySelectorAll('[data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      if (!key) return;
      const current = DashboardState.table.sort;
      if (current.key === key) {
        current.direction = current.direction === 'asc' ? 'desc' : 'asc';
      } else {
        DashboardState.table.sort = { key, direction: 'asc' };
      }
      renderDashboard();
      schedulePersistPreferences();
    });
  });

  tableHead.querySelectorAll('[data-column-filter-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const key = toggle.dataset.columnFilterToggle;
      const panel = tableHead.querySelector(`[data-column-filter-panel="${key}"]`);
      if (panel) panel.classList.toggle('hidden');
    });
  });

  tableHead.querySelectorAll('[data-column-filter]').forEach((select) => {
    select.addEventListener('change', () => {
      const key = select.dataset.columnFilter;
      DashboardState.filters.columnFilters[key] = {
        ...(DashboardState.filters.columnFilters[key] || { select: 'all', search: '' }),
        select: select.value,
      };
      DashboardState.table.page = 1;
      renderDashboard();
      schedulePersistPreferences();
    });
  });

  tableHead.querySelectorAll('[data-column-search]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.columnSearch;
      DashboardState.filters.columnFilters[key] = {
        ...(DashboardState.filters.columnFilters[key] || { select: 'all', search: '' }),
        search: input.value,
      };
      DashboardState.table.page = 1;
      renderDashboard();
      schedulePersistPreferences();
    });
  });

  tableBody.querySelectorAll('[data-row-key]').forEach((row) => {
    row.addEventListener('click', () => {
      const key = row.dataset.rowKey;
      const record = DashboardState.vehiclesRaw.get(key);
      if (!record) return;
      openDrawer(mapRowForDrawer(record));
    });
  });

  const drawerClose = document.getElementById('drawer-close');
  if (drawerClose) {
    drawerClose.addEventListener('click', closeDrawer);
  }
};

const setupColumnResize = ({ renderDashboard }) => {
  const tableHead = document.getElementById('inventory-table-head');
  tableHead.querySelectorAll('[data-resize-handle]').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => {
      const key = handle.dataset.resizeHandle;
      if (!key) return;
      const th = handle.closest('th');
      if (!th) return;
      const startX = event.clientX;
      const startWidth = th.getBoundingClientRect().width;
      document.body.classList.add('select-none');

      const onMove = (moveEvent) => {
        const nextWidth = Math.max(RESIZE_MIN_WIDTH, startWidth + moveEvent.clientX - startX);
        DashboardState.table.columnWidths[key] = nextWidth;
        th.style.width = `${nextWidth}px`;
        th.style.minWidth = `${nextWidth}px`;
      };

      const onUp = () => {
        document.body.classList.remove('select-none');
        window.removeEventListener('pointermove', onMove);
        schedulePersistPreferences();
        renderDashboard();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    });
  });
};

const setupColumnDrag = ({ renderDashboard }) => {
  const tableHead = document.getElementById('inventory-table-head');
  tableHead.querySelectorAll('th[draggable="true"]').forEach((th) => {
    th.addEventListener('dragstart', (event) => {
      const key = th.dataset.colKey;
      if (!key) return;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', key);
      th.classList.add('dragging');
    });

    th.addEventListener('dragend', () => {
      th.classList.remove('dragging');
      tableHead.querySelectorAll('th').forEach((target) => target.classList.remove('drop-target'));
    });

    th.addEventListener('dragover', (event) => {
      event.preventDefault();
      th.classList.add('drop-target');
    });

    th.addEventListener('dragleave', () => {
      th.classList.remove('drop-target');
    });

    th.addEventListener('drop', (event) => {
      event.preventDefault();
      const fromKey = event.dataTransfer.getData('text/plain');
      const toKey = th.dataset.colKey;
      if (!fromKey || !toKey || fromKey === toKey) return;
      const order = [...DashboardState.table.columnOrder];
      const fromIndex = order.indexOf(fromKey);
      const toIndex = order.indexOf(toKey);
      if (fromIndex === -1 || toIndex === -1) return;
      order.splice(fromIndex, 1);
      order.splice(toIndex, 0, fromKey);
      DashboardState.table.columnOrder = order;
      renderDashboard();
      schedulePersistPreferences();
    });
  });
};

const initializeFilterControls = ({ renderDashboard }) => {
  const salesToggle = document.getElementById('sales-channel-toggle');
  const salesPanel = document.getElementById('sales-channel-panel');
  if (salesToggle && salesPanel) {
    salesToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      salesPanel.classList.toggle('hidden');
      salesToggle.setAttribute('aria-expanded', salesPanel.classList.contains('hidden') ? 'false' : 'true');
    });
  }

  document.addEventListener('click', () => {
    if (salesPanel && !salesPanel.classList.contains('hidden')) {
      salesPanel.classList.add('hidden');
      salesToggle?.setAttribute('aria-expanded', 'false');
    }
  });

  const salesOptions = document.getElementById('sales-channel-options');
  if (salesOptions) {
    salesOptions.addEventListener('change', (event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      const checked = [...salesOptions.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
      DashboardState.filters.salesChannels = checked;
      DashboardState.table.page = 1;
      renderDashboard();
      schedulePersistPreferences();
    });
  }

  const lastDealSelect = document.getElementById('last-deal-select');
  if (lastDealSelect) {
    lastDealSelect.addEventListener('change', () => {
      DashboardState.filters.lastLeadSelection = lastDealSelect.value;
      DashboardState.filters.lastLeadFilterActive = lastDealSelect.value !== 'all';
      DashboardState.table.page = 1;
      renderDashboard();
      schedulePersistPreferences();
    });
  }

  const unitTypeFilters = document.getElementById('unit-type-filters');
  if (unitTypeFilters) {
    unitTypeFilters.addEventListener('click', (event) => {
      const button = event.target.closest('#unit-type-toggle');
      if (button) {
        const panel = document.getElementById('unit-type-panel');
        panel?.classList.toggle('hidden');
        button.setAttribute('aria-expanded', panel?.classList.contains('hidden') ? 'false' : 'true');
      }
    });
    unitTypeFilters.addEventListener('change', (event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      const options = [...unitTypeFilters.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
      DashboardState.filters.unitTypeSelection = options;
      DashboardState.table.page = 1;
      renderDashboard();
      schedulePersistPreferences();
    });
  }

  const vehicleStatusFilters = document.getElementById('vehicle-status-filters');
  if (vehicleStatusFilters) {
    vehicleStatusFilters.addEventListener('click', (event) => {
      const button = event.target.closest('#vehicle-status-toggle');
      if (button) {
        const panel = document.getElementById('vehicle-status-panel');
        panel?.classList.toggle('hidden');
        button.setAttribute('aria-expanded', panel?.classList.contains('hidden') ? 'false' : 'true');
      }
    });
    vehicleStatusFilters.addEventListener('change', (event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      const options = [...vehicleStatusFilters.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
      DashboardState.filters.vehicleStatusSelection = options;
      DashboardState.table.page = 1;
      renderDashboard();
      schedulePersistPreferences();
    });
  }

  const eraseFilters = document.getElementById('erase-filters');
  if (eraseFilters) {
    eraseFilters.addEventListener('click', () => {
      DashboardState.filters.categoryFilters = {};
      DashboardState.filters.columnFilters = {};
      DashboardState.filters.chartFilters = {};
      DashboardState.filters.unitTypeSelection = [];
      DashboardState.filters.vehicleStatusSelection = [];
      DashboardState.filters.salesChannels = DashboardState.filters.salesChannelKey
        ? getUniqueValues(getCurrentDataset(), DashboardState.filters.salesChannelKey).slice(0, 1)
        : [];
      DashboardState.filters.lastLeadSelection = 'all';
      DashboardState.table.page = 1;
      renderDashboard();
      schedulePersistPreferences();
    });
  }

  const exportCsv = document.getElementById('export-csv');
  if (exportCsv) {
    exportCsv.addEventListener('click', () => {
      const rows = applyFilters();
      const visibleColumns = getOrderedColumns(DashboardState.schema)
        .filter((col) => DashboardState.table.columns[col.key]);
      const header = visibleColumns.map((col) => `"${col.label.replace(/\"/g, '"')}"`).join(',');
      const body = rows.map((row) => visibleColumns.map((col) => `"${String(row[col.key] ?? '').replace(/\"/g, '"')}"`).join(','));
      const csv = [header, ...body].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'inventory-control.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }

  const perPageSelect = document.getElementById('table-per-page');
  if (perPageSelect) {
    perPageSelect.addEventListener('change', () => {
      DashboardState.table.perPage = Number(perPageSelect.value);
      DashboardState.table.page = 1;
      renderDashboard();
      schedulePersistPreferences();
    });
  }

  const prevBtn = document.getElementById('table-prev');
  const nextBtn = document.getElementById('table-next');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      DashboardState.table.page = Math.max(1, DashboardState.table.page - 1);
      renderDashboard();
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      DashboardState.table.page += 1;
      renderDashboard();
    });
  }
};

const initializeColumnChooser = ({ renderDashboard }) => {
  const toggle = document.getElementById('column-chooser-toggle');
  const chooser = document.getElementById('column-chooser');
  if (!toggle || !chooser) return;

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    chooser.classList.toggle('hidden');
    toggle.setAttribute('aria-expanded', chooser.classList.contains('hidden') ? 'false' : 'true');
  });

  document.addEventListener('click', () => {
    if (!chooser.classList.contains('hidden')) {
      chooser.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  chooser.addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    const key = event.target.value;
    DashboardState.table.columns[key] = event.target.checked;
    renderDashboard();
    schedulePersistPreferences();
  });

  chooser.addEventListener('click', (event) => {
    const button = event.target.closest('[data-column-edit]');
    if (!button) return;
    const key = button.dataset.columnEdit;
    const label = prompt('Rename column label', getColumnLabel(key));
    if (label === null) return;
    setColumnLabelOverride(key, label);
    renderDashboard();
    schedulePersistPreferences();
  });
};

const initializeChartInteractions = ({ renderDashboard }) => {
  document.addEventListener('change', (event) => {
    if (!(event.target instanceof Element)) return;
    const select = event.target.closest('[data-segment-select]');
    if (select) {
      const chartId = select.dataset.chartId || 'default';
      DashboardState.chartSegments[chartId] = select.value;
      renderDashboard();
      schedulePersistPreferences();
      return;
    }

    const checkbox = event.target.closest('[data-segment-field-checkbox]');
    if (checkbox) {
      const chartId = checkbox.dataset.chartId;
      const segmentKey = checkbox.dataset.segmentKey;
      if (!chartId || !segmentKey) return;
      const hiddenValues = ensureChartVisibilityState(chartId, segmentKey).slice();
      if (checkbox.checked) {
        const next = hiddenValues.filter((value) => value !== checkbox.value);
        setChartHiddenValues(chartId, segmentKey, next);
      } else {
        if (!hiddenValues.includes(checkbox.value)) hiddenValues.push(checkbox.value);
        setChartHiddenValues(chartId, segmentKey, hiddenValues);
      }
      renderDashboard();
    }
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const toggle = event.target.closest('[data-segment-filter-toggle]');
    if (toggle) {
      event.stopPropagation();
      const chartId = toggle.dataset.chartId;
      const panel = document.querySelector(`[data-segment-filter-panel][data-chart-id="${chartId}"]`);
      if (panel) panel.classList.toggle('hidden');
      return;
    }

    const barButton = event.target.closest('button[data-status]');
    if (barButton) {
      const chartId = barButton.dataset.chartId;
      const segmentKey = barButton.dataset.segmentKey;
      const status = barButton.dataset.status;
      if (!chartId || !segmentKey || !status) return;
      const filter = DashboardState.filters.chartFilters[chartId] || { key: segmentKey, values: [] };
      const isActive = filter.key === segmentKey && filter.values.includes(status);
      DashboardState.filters.chartFilters[chartId] = isActive
        ? { key: segmentKey, values: [] }
        : { key: segmentKey, values: [status] };
      DashboardState.table.page = 1;
      renderDashboard();
      schedulePersistPreferences();
      return;
    }

    const fullToggle = event.target.closest('[data-full-chart-toggle]');
    if (fullToggle) {
      const targetId = fullToggle.dataset.fullChartTarget;
      const body = document.getElementById(targetId);
      if (!body) return;
      const isCollapsed = body.classList.toggle('hidden');
      fullToggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
      const card = fullToggle.closest('[data-full-chart-card]');
      if (card) card.dataset.collapsed = isCollapsed ? 'true' : 'false';
      DashboardState.layout.fullChartCollapsed = isCollapsed;
      schedulePersistPreferences();
      return;
    }

    const selectAll = event.target.closest('[data-segment-select-all]');
    if (selectAll) {
      const chartId = selectAll.dataset.chartId;
      const segmentKey = DashboardState.chartSegments[chartId];
      if (!chartId || !segmentKey) return;
      setChartHiddenValues(chartId, segmentKey, []);
      renderDashboard();
      return;
    }

    const clearAll = event.target.closest('[data-segment-clear-all]');
    if (clearAll) {
      const chartId = clearAll.dataset.chartId;
      const segmentKey = DashboardState.chartSegments[chartId];
      if (!chartId || !segmentKey) return;
      const options = DashboardState.chartVisibilityOptions?.[chartId]?.[segmentKey] || [];
      setChartHiddenValues(chartId, segmentKey, options.slice());
      renderDashboard();
    }
  });
};

const initializeAlerts = () => {
  const toggle = document.getElementById('alerts-toggle');
  const list = document.getElementById('alerts-list');
  const badges = document.getElementById('alerts-badges');
  if (!toggle || !list || !badges) return;

  toggle.addEventListener('click', () => {
    const isHidden = list.classList.toggle('hidden');
    badges.classList.toggle('hidden', isHidden);
    toggle.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
    toggle.innerHTML = isHidden
      ? '<i data-lucide="chevron-down" class="h-4 w-4"></i>'
      : '<i data-lucide="chevron-up" class="h-4 w-4"></i>';
    createIcons();
  });
};

const initializeInventoryApp = async () => {
  hydratePreferences();
  DashboardState.ui.isLoading = true;

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
    syncTopScrollbar,
    createIcons,
  });

  const renderDashboard = () => {
    ui.renderDashboard();
    renderSalesChannelFilters();
    ui.renderColumnChooser();
    setupTableInteractions({ renderDashboard, openDrawer: ui.openDrawer, closeDrawer: ui.closeDrawer });
    setupColumnResize({ renderDashboard });
    setupColumnDrag({ renderDashboard });
    syncTopScrollbar();
    createIcons();
  };

  initializeResizablePanels();
  initializeAlerts();
  initializeColumnChooser({ renderDashboard });
  initializeFilterControls({ renderDashboard });
  initializeChartInteractions({ renderDashboard });

  const supabaseUrl = window.SUPABASE_URL || window?.env?.SUPABASE_URL;
  const supabaseAnonKey = window.SUPABASE_ANON_KEY || window?.env?.SUPABASE_ANON_KEY;
  const supabaseClient = await getSupabaseClient({ supabaseUrl, supabaseAnonKey, showDebug });

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

  initializeSupabaseRealtime({
    supabaseClient,
    setConnectionStatus,
    handleVehicleChange: (payload) => {
      const record = payload?.new || payload?.old;
      if (!record) return;
      DashboardState.vehiclesRaw.set(getVehicleKey(record), record);
      DashboardState.schema = buildSchemaFromData(getCurrentDataset());
      initializeTablePreferences();
      setupFilters({ preserveSelections: true });
      DashboardState.ui.isLoading = false;
      renderDashboard();
    },
  });

  const updatedAt = document.querySelector('[data-updated-at]');
  if (updatedAt) {
    setInterval(() => {
      updatedAt.textContent = formatRelativeTime(Date.now());
    }, 30000);
  }
};

initializeInventoryApp();
