import { formatColumnLabel } from '../core/state.js';

export const createAlertsManager = ({ initializeLucideIcons, updateLucideIcon } = {}) => {
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
  let templatesMounted = false;
  let alertsSupabaseClient = null;

  const addListener = (element, event, handler, options) => {
    element?.addEventListener(event, handler, options);
  };

  const mountTemplates = () => {
    if (templatesMounted) return;
    const rowTemplate = document.getElementById('alerts-deals-row-template');
    const list = document.getElementById('alerts-list');
    if (rowTemplate && list && !document.getElementById('alerts-deals-row')) {
      list.prepend(rowTemplate.content.cloneNode(true));
      initializeLucideIcons?.(list);
    }

    const modalTemplate = document.getElementById('alerts-deals-modal-template');
    const modalRoot = document.getElementById('alerts-deals-modal-root') || document.body;
    if (modalTemplate && modalRoot && !document.getElementById('alerts-deals-modal')) {
      modalRoot.appendChild(modalTemplate.content.cloneNode(true));
      initializeLucideIcons?.(modalRoot);
    }
    templatesMounted = true;
  };

  const setAlertsDealCount = (count) => {
    const badge = document.getElementById('alerts-deals-count');
    const modalCount = document.querySelector('[data-alerts-deals-count]');
    const row = document.getElementById('alerts-deals-row');
    const rowCount = document.getElementById('alerts-deals-row-count');
    if (!badge) return;
    const safeCount = Number(count) || 0;
    if (safeCount <= 0) {
      badge.classList.add('hidden');
      badge.textContent = '';
      if (modalCount) modalCount.textContent = '0';
      if (rowCount) rowCount.textContent = '0';
      row?.classList.remove('hidden');
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
      const prepStatusRaw = row?.['Inventory Preparation Status'];
      const prepStatus = prepStatusRaw === null || prepStatusRaw === undefined || prepStatusRaw === ''
        ? '—'
        : String(prepStatusRaw);
      const prepBadge = `<span class="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase text-amber-200">Prep: ${prepStatus}</span>`;
      return vin
        ? `<a class="text-blue-200 underline decoration-transparent underline-offset-2 transition hover:decoration-blue-200" href="https://www.google.com/search?q=%22${vinQuery}%22" target="_blank" rel="noreferrer">${vin}</a>${prepBadge}`
        : '—';
    }
    const value = row?.[key];
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
  };

  const renderAlertsDealsList = (rows, limit = 500) => {
    const list = document.getElementById('alerts-deals-list');
    if (!list) return;
    list.innerHTML = '';
    if (!rows?.length) {
      list.innerHTML = '<p class="text-xs text-slate-400">No matching deals found.</p>';
      return;
    }
    const visibleRows = rows.slice(0, limit);
    const fragment = document.createDocumentFragment();
    visibleRows.forEach((row) => {
      const vin = row.VIN || '';
      const vinQuery = encodeURIComponent(vin);
      const storageKey = vin ? `${ALERTS_STORAGE_PREFIX}:${vin}` : '';
      const storedNote = storageKey ? localStorage.getItem(`${storageKey}:note`) : '';
      const storedClick = storageKey ? localStorage.getItem(`${storageKey}:lastClick`) : '';
      const visibleColumns = alertsDealsColumns.length
        ? alertsDealsColumns
        : ['VIN', 'Vehicle Status', 'Current Stock No', 'Physical Location', 'Inventory Preparation Status'];
      const columnMarkup = visibleColumns
        .map((key) => {
          const label = getAlertsColumnLabel(key);
          const value = getAlertsColumnValue(row, key, vin, vinQuery);
          return `<span><span class="text-slate-400">${label}:</span> ${value}</span>`;
        })
        .join('');
      const item = document.createElement('div');
      item.className = 'rounded-xl border border-slate-800 bg-slate-950/40 p-3';
      item.innerHTML = `
        <div class="flex items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em]">
            <span class="${getStatusBadgeClasses(row['Vehicle Status'])}">${row['Vehicle Status'] || 'Unknown'}</span>
          </div>
          ${vin ? `
          <a class="shrink-0 rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-blue-400 hover:text-white" href="https://www.google.com/search?q=%22${vinQuery}%22" target="_blank" rel="noreferrer" data-alerts-google-button data-alerts-google-target="${vin}">Google</a>
          ` : ''}
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-200">
          ${columnMarkup}
          <span class="text-slate-400" data-alerts-google-last="${vin}">Last Click: ${storedClick || '—'}</span>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-200">
          <label class="flex min-w-[220px] flex-1 items-center gap-2 text-slate-200">
            <span class="text-slate-400">Notes:</span>
            <input type="text" class="h-7 w-full rounded-lg border border-slate-800 bg-slate-950/70 px-2 text-xs text-slate-200" placeholder="Add notes" data-alerts-google-notes data-alerts-notes-key="${storageKey}" value="${storedNote || ''}">
          </label>
        </div>
      `;
      fragment.appendChild(item);
    });
    list.appendChild(fragment);

    if (rows.length > limit) {
      const loadMore = document.createElement('button');
      loadMore.type = 'button';
      loadMore.className = 'rounded-full border border-slate-800 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-blue-400 hover:text-white';
      loadMore.textContent = `Load More (${rows.length - limit} more)`;
      loadMore.addEventListener('click', () => {
        renderAlertsDealsList(rows, Math.min(rows.length, limit + 20));
        list.scrollTop = list.scrollHeight;
      }, { once: true });
      list.appendChild(loadMore);
    }
  };

  const sortAlertsDealsRows = (rows) => {
    if (!alertsDealsSortKey) return rows;
    const direction = alertsDealsSortDirection === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const valueA = String(a?.[alertsDealsSortKey] ?? '').toLowerCase();
      const valueB = String(b?.[alertsDealsSortKey] ?? '').toLowerCase();
      if (valueA < valueB) return -1 * direction;
      if (valueA > valueB) return 1 * direction;
      return 0;
    });
  };

  const getFilteredAlertsDealsRows = () => {
    if (alertsDealsFilter === 'all') return alertsDealsRows;
    return alertsDealsRows.filter((row) => {
      const prepStatus = String(row['Inventory Preparation Status'] || '').trim().toLowerCase();
      return prepStatus === alertsDealsFilter;
    });
  };

  const renderAlertsDealsFilters = () => {
    const container = document.getElementById('alerts-deals-filters');
    if (!container) return;
    container.innerHTML = '';
    const options = ['all', ...alertsDealsFilterOptions];
    options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.alertsDealsFilter = option;
      button.className = 'rounded-full border border-slate-800 px-3 py-1 transition hover:text-white';
      if (option === alertsDealsFilter) {
        button.classList.add('border-blue-400', 'text-white');
      }
      button.textContent = option;
      container.appendChild(button);
    });
  };

  const renderAlertsDealsColumnHeaders = () => {
    const container = document.getElementById('alerts-deals-column-headers');
    if (!container) return;
    container.innerHTML = '';
    alertsDealsColumns.forEach((key) => {
      const label = getAlertsColumnLabel(key);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.alertsDealsSortKey = key;
      const sortSuffix = alertsDealsSortKey === key ? (alertsDealsSortDirection === 'asc' ? ' ↑' : ' ↓') : '';
      button.textContent = `${label}${sortSuffix}`;
      button.className = 'rounded-full border border-slate-800 px-3 py-1 transition hover:text-white';
      if (alertsDealsSortKey === key) button.classList.add('border-blue-400', 'text-white');
      container.appendChild(button);
    });
  };

  const renderAlertsDealsColumns = () => {
    const list = document.getElementById('alerts-deals-columns-list');
    if (!list) return;
    list.innerHTML = '';
    alertsDealsAvailableColumns.forEach((key) => {
      const item = document.createElement('label');
      item.className = 'flex items-center gap-2';
      item.innerHTML = `
        <input type="checkbox" class="h-3 w-3 rounded border-slate-600 bg-slate-950/70 text-blue-400" data-alerts-column-key="${key}" ${alertsDealsColumns.includes(key) ? 'checked' : ''}>
        <input type="text" class="h-7 flex-1 rounded-lg border border-slate-800 bg-slate-950/70 px-2 text-xs text-slate-200" data-alerts-column-label="${key}" value="${getAlertsColumnLabel(key)}">
      `;
      list.appendChild(item);
    });
  };

  const updateAlertsDealsList = () => {
    renderAlertsDealsList(sortAlertsDealsRows(getFilteredAlertsDealsRows()));
  };

  const formatAlertsTimestamp = (date) => {
    if (!date) return '—';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const openAlertsDealsModal = () => {
    mountTemplates();
    bindAlertsDealsUi();
    const alertsDealsModal = document.getElementById('alerts-deals-modal');
    if (!alertsDealsModal) return;
    alertsDealsModal.classList.remove('hidden');
    alertsDealsModal.classList.add('flex');
    alertsDealsModal.setAttribute('aria-hidden', 'false');
    const alertsDealsList = document.getElementById('alerts-deals-list');
    if (alertsDealsList && !alertsDealsRows.length) {
      alertsDealsList.innerHTML = '<p class="text-xs text-slate-400">Loading deals...</p>';
    }
    void fetchAlertsDealsData();
  };

  const bindAlertsDealsUi = () => {
    mountTemplates();

    const alertsDealsModal = document.getElementById('alerts-deals-modal');
    const alertsDealsModalClose = document.getElementById('alerts-deals-modal-close');
    const alertsDealsRowButton = document.getElementById('alerts-deals-row-button');
    const alertsDealsBadge = document.getElementById('alerts-deals-count');
    const alertsDealsFilters = document.getElementById('alerts-deals-filters');
    const alertsDealsList = document.getElementById('alerts-deals-list');
    const alertsDealsColumnsToggle = document.getElementById('alerts-deals-columns-toggle');
    const alertsDealsColumnsPanel = document.getElementById('alerts-deals-columns-panel');
    const alertsDealsColumnsList = document.getElementById('alerts-deals-columns-list');
    const alertsDealsColumnHeaders = document.getElementById('alerts-deals-column-headers');

    if (alertsDealsModal) {
      const closeModal = () => {
        alertsDealsModal.classList.add('hidden');
        alertsDealsModal.classList.remove('flex');
        alertsDealsModal.setAttribute('aria-hidden', 'true');
      };

      addListener(alertsDealsRowButton, 'click', openAlertsDealsModal);
      addListener(alertsDealsBadge, 'click', openAlertsDealsModal);
      addListener(alertsDealsModalClose, 'click', closeModal);
      addListener(alertsDealsModal, 'click', (event) => {
        if (event.target === alertsDealsModal) closeModal();
      });
    }

    const setActiveFilter = (value) => {
      alertsDealsFilter = value;
      if (alertsDealsFilters) {
        alertsDealsFilters.querySelectorAll('[data-alerts-deals-filter]').forEach((button) => {
          const isActive = button.dataset.alertsDealsFilter === value;
          button.classList.toggle('border-blue-400', isActive);
          button.classList.toggle('text-white', isActive);
        });
      }
      updateAlertsDealsList();
    };

    if (alertsDealsFilters) {
      addListener(alertsDealsFilters, 'click', (event) => {
        const button = event.target.closest('[data-alerts-deals-filter]');
        if (!button) return;
        setActiveFilter(button.dataset.alertsDealsFilter);
      });
    }

    setActiveFilter(alertsDealsFilter);

    if (alertsDealsColumnsToggle && alertsDealsColumnsPanel) {
      addListener(alertsDealsColumnsToggle, 'click', () => {
        const isHidden = alertsDealsColumnsPanel.classList.toggle('hidden');
        alertsDealsColumnsToggle.setAttribute('aria-expanded', String(!isHidden));
      });
    }

    if (alertsDealsColumnsList) {
      addListener(alertsDealsColumnsList, 'change', (event) => {
        const checkbox = event.target.closest('[data-alerts-column-key]');
        if (!checkbox) return;
        const key = checkbox.dataset.alertsColumnKey;
        if (!key) return;
        if (checkbox.checked) {
          if (!alertsDealsColumns.includes(key)) alertsDealsColumns.push(key);
        } else {
          alertsDealsColumns = alertsDealsColumns.filter((value) => value !== key);
        }
        localStorage.setItem(ALERTS_COLUMNS_STORAGE_KEY, JSON.stringify(alertsDealsColumns));
        renderAlertsDealsColumns();
        updateAlertsDealsList();
      });

      addListener(alertsDealsColumnsList, 'input', (event) => {
        const input = event.target.closest('[data-alerts-column-label]');
        if (!input) return;
        const key = input.dataset.alertsColumnLabel;
        if (!key) return;
        alertsDealsColumnLabels[key] = input.value.trim() || formatColumnLabel(key);
        localStorage.setItem(ALERTS_COLUMNS_LABELS_KEY, JSON.stringify(alertsDealsColumnLabels));
        renderAlertsDealsColumnHeaders();
        updateAlertsDealsList();
      });
    }

    if (alertsDealsColumnHeaders) {
      addListener(alertsDealsColumnHeaders, 'click', (event) => {
        const button = event.target.closest('[data-alerts-deals-sort-key]');
        if (!button) return;
        const key = button.dataset.alertsDealsSortKey;
        if (!key) return;
        if (alertsDealsSortKey === key) {
          alertsDealsSortDirection = alertsDealsSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          alertsDealsSortKey = key;
          alertsDealsSortDirection = 'asc';
        }
        renderAlertsDealsColumnHeaders();
        updateAlertsDealsList();
      });
    }

    if (alertsDealsList) {
      addListener(alertsDealsList, 'click', (event) => {
        const target = event.target.closest('[data-alerts-google-button]');
        if (!target) return;
        const vinKey = target.dataset.alertsGoogleTarget;
        if (!vinKey) return;
        const label = alertsDealsList.querySelector(`[data-alerts-google-last="${vinKey}"]`);
        if (!label) return;
        const timestamp = formatAlertsTimestamp(new Date());
        label.textContent = `Last Click: ${timestamp}`;
        localStorage.setItem(`${ALERTS_STORAGE_PREFIX}:${vinKey}:lastClick`, timestamp);
      });

      addListener(alertsDealsList, 'input', (event) => {
        const input = event.target.closest('[data-alerts-notes-key]');
        if (!input) return;
        const key = input.dataset.alertsNotesKey;
        if (!key) return;
        localStorage.setItem(`${key}:note`, input.value);
      });
    }

  };

  const init = () => {
    mountTemplates();
    bindAlertsDealsUi();
    const alertsDealsRow = document.getElementById('alerts-deals-row');
    const alertsDealsRowButton = document.getElementById('alerts-deals-row-button');
    alertsDealsRow?.classList.remove('hidden');
    alertsDealsRowButton?.classList.remove('hidden');

    const alertsToggle = document.getElementById('alerts-toggle');
    const alertsList = document.getElementById('alerts-list');
    const alertsBadges = document.getElementById('alerts-badges');
    const alertsPanel = document.getElementById('alerts-panel');
    if (alertsToggle && alertsList && alertsBadges && alertsPanel) {
      addListener(alertsToggle, 'click', () => {
        const isCollapsed = alertsPanel.dataset.collapsed === 'true';
        const nextCollapsed = !isCollapsed;
        alertsPanel.dataset.collapsed = String(nextCollapsed);
        alertsList.classList.toggle('hidden', nextCollapsed);
        alertsBadges.classList.toggle('hidden', !nextCollapsed);
        alertsToggle.setAttribute('aria-expanded', String(!nextCollapsed));
        const icon = alertsToggle.querySelector('[data-lucide]');
        updateLucideIcon?.(icon, nextCollapsed ? 'chevron-down' : 'chevron-up');
      });
    }

  };

  const fetchAlertsDealsData = async () => {
    if (!alertsSupabaseClient?.from) {
      return;
    }
    const { data, error } = await alertsSupabaseClient
      .from('DealsJP1')
      .select('*');
    if (error || !Array.isArray(data)) {
      return;
    }
    const onlineRows = data;
    alertsDealsRows = onlineRows;
    alertsDealsFilterOptions = Array.from(
      new Set(
        onlineRows
          .map((row) => String(row['Inventory Preparation Status'] || '').trim().toLowerCase())
          .filter(Boolean),
      ),
    ).sort();
    alertsDealsAvailableColumns = Array.from(
      new Set(
        onlineRows.flatMap((row) => Object.keys(row || {})),
      ),
    ).sort();
    if (!alertsDealsColumns.length) {
      const storedColumns = localStorage.getItem(ALERTS_COLUMNS_STORAGE_KEY);
      alertsDealsColumns = storedColumns ? JSON.parse(storedColumns) : [
        'VIN',
        'Vehicle Status',
        'Current Stock No',
        'Physical Location',
        'Inventory Preparation Status',
      ];
    }
    alertsDealsColumns = alertsDealsColumns.filter((key) => alertsDealsAvailableColumns.includes(key));
    alertsDealsColumnLabels = {
      ...alertsDealsColumnLabels,
      ...JSON.parse(localStorage.getItem(ALERTS_COLUMNS_LABELS_KEY) || '{}'),
    };
    if (alertsDealsFilter !== 'all' && !alertsDealsFilterOptions.includes(alertsDealsFilter)) {
      alertsDealsFilter = 'all';
    }
    renderAlertsDealsFilters();
    renderAlertsDealsColumns();
    renderAlertsDealsColumnHeaders();
    updateAlertsDealsList();
  };

  const fetchAlertsDealCount = async (supabaseClient) => {
    alertsSupabaseClient = supabaseClient || null;
    if (!alertsSupabaseClient?.from) {
      setAlertsDealCount(0);
      alertsDealsRows = [];
      updateAlertsDealsList();
      return;
    }
    const { data, error } = await alertsSupabaseClient
      .from('DealsJP1')
      .select('*')
      .not('VIN', 'is', null);
    if (error) {
      return;
    }
    if (Array.isArray(data)) {
      console.table(data.slice(0, 10));
    }
    setAlertsDealCount(data?.length || 0);
    alertsDealsRows = [];
  };

  return {
    init,
    fetchAlertsDealCount,
    setAlertsDealCount,
  };
};
