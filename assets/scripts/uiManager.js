export function initUiManager({ data, state, utils, config, callbacks, mapManager }) {
  let sidebarStateController = null;

  const getSidebarStateController = () => sidebarStateController;

  const toggleSelectionBanner = () => {
    const banner = document.getElementById('selection-banner');
    const text = document.getElementById('selection-text');
    if (!banner || !text) return;

    if (state.selectedVehicleId === null && state.selectedTechId === null) {
      banner.classList.add('hidden');
      return;
    }

    const vehicle = data.vehicles.find(v => v.id === state.selectedVehicleId);
    const tech = data.technicians.find(t => t.id === state.selectedTechId);
    const parts = [];
    if (vehicle) parts.push(`Vehicle ${vehicle.vin || vehicle.model}`);
    if (tech) parts.push(`Technician ${tech.company}`);
    text.textContent = `Filtered by ${parts.join(' & ')}`;
    banner.classList.remove('hidden');
  };

  const loadVehicleModalPrefs = () => {
    try {
      const raw = localStorage.getItem(config.VEHICLE_MODAL_STORAGE_KEY);
      if (!raw) return { order: [], hidden: [] };
      const parsed = JSON.parse(raw);
      return {
        order: Array.isArray(parsed?.order) ? parsed.order : [],
        hidden: Array.isArray(parsed?.hidden) ? parsed.hidden : []
      };
    } catch (error) {
      console.warn('Failed to load vehicle modal column preferences.', error);
      return { order: [], hidden: [] };
    }
  };

  const saveVehicleModalPrefs = (prefs) => {
    localStorage.setItem(config.VEHICLE_MODAL_STORAGE_KEY, JSON.stringify(prefs));
  };

  const getVehicleModalHeaders = () => {
    const prefs = loadVehicleModalPrefs();
    const rawHeaders = data.vehicleHeaders.filter((header) => header.toLowerCase() !== 'pt city');
    const ordered = prefs.order?.length
      ? prefs.order.filter((header) => rawHeaders.includes(header))
      : [];
    const remaining = rawHeaders.filter((header) => !ordered.includes(header));
    const headers = [...ordered, ...remaining];
    return { headers, hidden: new Set(prefs.hidden || []) };
  };

  const renderVehicleModalColumnsList = (headers, hiddenSet) => {
    const list = document.getElementById('vehicle-modal-columns-list');
    if (!list) return;
    list.innerHTML = '';
    headers.forEach((header) => {
      const id = `vehicle-col-${header.replace(/\s+/g, '-').toLowerCase()}`;
      const label = config.VEHICLE_HEADER_LABELS[header] || header;
      const item = document.createElement('label');
      item.className = 'flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1';
      item.innerHTML = `
        <input type="checkbox" class="rounded border-slate-700 bg-slate-900 text-amber-400 focus:ring-amber-400" id="${id}">
        <span class="text-[11px] text-slate-200">${label}</span>
      `;
      const checkbox = item.querySelector('input');
      checkbox.checked = !hiddenSet.has(header);
      checkbox.addEventListener('change', () => {
        const prefs = loadVehicleModalPrefs();
        const hidden = new Set(prefs.hidden || []);
        if (checkbox.checked) {
          hidden.delete(header);
        } else {
          hidden.add(header);
        }
        prefs.hidden = [...hidden];
        saveVehicleModalPrefs(prefs);
        const safeHeader = (window.CSS && CSS.escape) ? CSS.escape(header) : header.replace(/"/g, '\\"');
        const row = document.querySelector(`tr[data-header="${safeHeader}"]`);
        if (row) row.classList.toggle('hidden', !checkbox.checked);
      });
      list.appendChild(item);
    });
  };

  const attachVehicleModalRowDrag = () => {
    const modal = document.getElementById('vehicle-modal');
    if (!modal) return;
    const rows = modal.querySelectorAll('tr[data-header]');
    let draggedRow = null;

    rows.forEach((row) => {
      row.addEventListener('dragstart', (event) => {
        draggedRow = row;
        row.classList.add('opacity-50');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', row.dataset.header || '');
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('opacity-50');
        draggedRow = null;
      });

      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });

      row.addEventListener('drop', (event) => {
        event.preventDefault();
        if (!draggedRow || draggedRow === row) return;
        const tbody = row.parentElement;
        if (!tbody) return;
        const rowList = [...tbody.querySelectorAll('tr[data-header]')];
        const draggedIndex = rowList.indexOf(draggedRow);
        const targetIndex = rowList.indexOf(row);
        if (draggedIndex < targetIndex) {
          tbody.insertBefore(draggedRow, row.nextSibling);
        } else {
          tbody.insertBefore(draggedRow, row);
        }
        const prefs = loadVehicleModalPrefs();
        prefs.order = [...tbody.querySelectorAll('tr[data-header]')].map((entry) => entry.dataset.header);
        saveVehicleModalPrefs(prefs);
      });
    });
  };

  const attachVehicleModalEditors = async (vehicle) => {
    const modal = document.getElementById('vehicle-modal');
    if (!modal) return;
    const editButtons = modal.querySelectorAll('[data-edit-field]');
    editButtons.forEach((button) => {
      let saveInProgress = false;
      const saveEdit = async () => {
        if (saveInProgress) return;
        const fieldKey = button.dataset.editField;
        const headerKey = button.dataset.editHeader;
        const cell = button.closest('td');
        const valueNode = cell?.querySelector('[data-field-value]');
        if (!cell || !valueNode) return;

        const input = cell.querySelector('input[data-edit-input]');
        const newValue = input ? input.value.trim() : '';
        saveInProgress = true;
        button.disabled = true;
        button.textContent = 'Saving...';
        const stopLoading = callbacks.startLoading('Saving...');

        try {
          if (!utils.supabaseClient || !headerKey || vehicle?.id === undefined) {
            throw new Error('Supabase unavailable');
          }

          const { error } = await utils.supabaseClient
            .from(config.TABLES.vehicles)
            .update({ [headerKey]: newValue })
            .eq('id', vehicle.id);

          if (error) throw error;

          valueNode.textContent = newValue || '—';
          button.dataset.editing = 'false';
          if (input) input.remove();

          if (vehicle?.details) {
            vehicle.details[headerKey] = newValue;
          }
          if (fieldKey && vehicle) {
            vehicle[fieldKey] = newValue;
          }
          callbacks.renderVehicles();
          return;
        } catch (error) {
          console.warn('Failed to update vehicle field:', error);
          alert(error?.message || 'Failed to save vehicle update.');
        } finally {
          stopLoading();
          saveInProgress = false;
          button.disabled = false;
          button.textContent = button.dataset.editing === 'true' ? 'Save' : 'Edit';
        }
      };

      button.onclick = async () => {
        const cell = button.closest('td');
        const valueNode = cell?.querySelector('[data-field-value]');
        if (!cell || !valueNode) return;

        if (button.dataset.editing === 'true') {
          await saveEdit();
          return;
        }

        const currentValue = valueNode.textContent === '—' ? '' : valueNode.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentValue;
        input.dataset.editInput = 'true';
        input.className = 'flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-100';
        valueNode.textContent = '';
        valueNode.appendChild(input);
        button.dataset.editing = 'true';
        button.textContent = 'Save';
        input.focus();
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            saveEdit();
          }
        });
      };
    });
  };

  const openVehicleModal = (vehicle) => {
    const modal = document.getElementById('vehicle-modal');
    const title = document.getElementById('vehicle-modal-title');
    const vinDisplay = document.getElementById('vehicle-modal-vin');
    const body = document.getElementById('vehicle-modal-body');
    const columnsToggle = document.getElementById('vehicle-modal-columns-toggle');
    const columnsPanel = document.getElementById('vehicle-modal-columns-panel');
    if (!modal || !title || !body) return;

    const VIN = utils.repairHistoryManager.getRepairVehicleVin(vehicle);
    modal.dataset.vehicleId = vehicle.id;
    columnsToggle?.classList.remove('hidden');
    columnsPanel?.classList.add('hidden');
    title.textContent = `${vehicle.model || 'Vehicle'} ${vehicle.year || ''} • ${vehicle.vin || ''}`;
    if (vinDisplay) {
      vinDisplay.textContent = VIN ? `VIN: ${VIN}` : '';
    }
    const { headers, hidden } = getVehicleModalHeaders();
    const detailRows = headers.map(header => {
      const displayHeader = config.VEHICLE_HEADER_LABELS[header] || header;
      const fieldKey = config.EDITABLE_VEHICLE_FIELDS[header.toLowerCase()];
      const isEditable = Boolean(fieldKey);
      const value = vehicle.details?.[header] || vehicle[header] || vehicle[header.toLowerCase()] || '—';
      return `
        <tr class="border-b border-slate-800/80 ${hidden.has(header) ? 'hidden' : ''}" draggable="true" data-header="${header}">
          <th class="text-left text-xs font-semibold text-slate-300 py-2 pr-3">
            <span class="inline-flex items-center gap-2">
              <span class="text-slate-600 text-sm">⋮⋮</span>
              ${displayHeader}
            </span>
          </th>
          <td class="text-xs text-slate-100 py-2">
            <div class="flex items-center justify-between gap-2">
              <span data-field-value>${value || '—'}</span>
              ${isEditable ? `
                <button type="button" class="rounded border border-amber-400/40 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:border-amber-300 hover:text-amber-100 transition-colors" data-edit-field="${fieldKey}" data-edit-header="${header}">Edit</button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
    body.innerHTML = `<table class="w-full text-left">${detailRows}</table>`;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    renderVehicleModalColumnsList(headers, hidden);
    attachVehicleModalRowDrag();
    attachVehicleModalEditors(vehicle);
  };

  const openRepairModal = (vehicle) => {
    const modal = document.getElementById('vehicle-modal');
    const title = document.getElementById('vehicle-modal-title');
    const vinDisplay = document.getElementById('vehicle-modal-vin');
    const body = document.getElementById('vehicle-modal-body');
    const columnsToggle = document.getElementById('vehicle-modal-columns-toggle');
    const columnsPanel = document.getElementById('vehicle-modal-columns-panel');
    if (!modal || !title || !body) return;

    if (modal.repairModalController) {
      modal.repairModalController.abort();
    }
    const repairModalController = new AbortController();
    modal.repairModalController = repairModalController;
    const { signal } = repairModalController;

    const VIN = utils.repairHistoryManager.getRepairVehicleVin(vehicle);
    modal.dataset.vehicleId = vehicle.id;
    title.textContent = 'Repair Management';
    if (vinDisplay) {
      vinDisplay.textContent = VIN ? `VIN: ${VIN}` : '';
    }
    columnsToggle?.classList.add('hidden');
    columnsPanel?.classList.add('hidden');
    body.innerHTML = `
      <div class="space-y-4">
        <div class="sticky top-0 z-10 -mx-4 border-b border-slate-800 bg-slate-950/95 px-4 pb-3 pt-1 backdrop-blur">
          <div class="inline-flex rounded-lg border border-slate-800 bg-slate-950/70 p-1 text-[11px] font-semibold text-slate-300">
            <button type="button" class="repair-tab-btn rounded-md px-3 py-1.5 text-white bg-slate-800/80" data-tab="history">History</button>
            <button type="button" class="repair-tab-btn rounded-md px-3 py-1.5 text-slate-400 hover:text-white" data-tab="new-entry">New Entry</button>
          </div>
        </div>
        <div class="repair-tab-panel" data-tab-panel="history">
          <div class="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
            <div class="flex flex-wrap items-center justify-between gap-3 pb-3">
              <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Repair History</p>
              <div class="flex flex-wrap items-center gap-2">
                <input type="text" class="w-48 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-200 placeholder-slate-500" placeholder="Search notes, status, company" data-repair-search />
                <div class="relative">
                <button type="button" class="rounded border border-slate-700 bg-slate-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-200 hover:border-slate-500" data-repair-columns-toggle>
                  Columns
                </button>
                <div class="absolute right-0 z-10 mt-2 hidden w-64 rounded-lg border border-slate-800 bg-slate-950/95 p-3 text-[11px] text-slate-200 shadow-xl" data-repair-columns-panel>
                  <p class="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-400">Show columns</p>
                  <div class="mt-2 grid gap-2" data-repair-columns-list></div>
                </div>
                </div>
              </div>
            </div>
            <table class="w-full text-left text-[11px] text-slate-200">
              <thead class="text-[10px] uppercase text-slate-500" data-repair-history-head></thead>
              <tbody class="divide-y divide-slate-800/80" data-repair-history-body>
                <tr data-repair-empty>
                  <td class="py-2 pr-3 text-slate-400" colspan="1">Loading history...</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="repair-tab-panel hidden" data-tab-panel="new-entry">
          <form class="space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4 text-[11px] text-slate-200" data-repair-form>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="space-y-1">
                <span class="text-[10px] uppercase text-slate-500 font-semibold">Status</span>
                <input type="text" name="status" placeholder="Pending" class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100" />
              </label>
              <label class="space-y-1">
                <span class="text-[10px] uppercase text-slate-500 font-semibold">DOC</span>
                <input type="text" name="doc" placeholder="DOC-12345" class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100" />
              </label>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="space-y-1">
                <span class="text-[10px] uppercase text-slate-500 font-semibold">Date</span>
                <input type="date" name="cs_contact_date" class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100" />
              </label>
              <label class="space-y-1">
                <span class="text-[10px] uppercase text-slate-500 font-semibold">Shipping Date</span>
                <input type="date" name="shipping_date" class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100" />
              </label>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="space-y-1">
                <span class="text-[10px] uppercase text-slate-500 font-semibold">POC Name</span>
                <input type="text" name="poc_name" placeholder="Primary contact" class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100" />
              </label>
              <label class="space-y-1">
                <span class="text-[10px] uppercase text-slate-500 font-semibold">POC Phone</span>
                <input type="tel" name="poc_phone" placeholder="(555) 555-5555" class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100" />
              </label>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="space-y-1">
                <span class="text-[10px] uppercase text-slate-500 font-semibold">Customer Availability</span>
                <input type="text" name="customer_availability" placeholder="Mon-Fri afternoons" class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100" />
              </label>
              <label class="space-y-1">
                <span class="text-[10px] uppercase text-slate-500 font-semibold">Installer Request Date</span>
                <input type="date" name="installer_request_date" class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100" />
              </label>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="space-y-1">
                <span class="text-[10px] uppercase text-slate-500 font-semibold">Installation Company</span>
                <input type="text" name="installation_company" placeholder="Techloc Installers" class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100" />
              </label>
              <label class="space-y-1">
                <span class="text-[10px] uppercase text-slate-500 font-semibold">Technician Availability</span>
                <input type="date" name="technician_availability_date" class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100" />
              </label>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="space-y-1">
                <span class="text-[10px] uppercase text-slate-500 font-semibold">Installation Place</span>
                <input type="text" name="installation_place" placeholder="123 Main St" class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100" />
              </label>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="space-y-1 block">
                <span class="text-[10px] uppercase text-slate-500 font-semibold">Cost</span>
                <input type="text" name="repair_price" placeholder="$0.00" class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100" />
              </label>
              <label class="space-y-1 block">
                <span class="text-[10px] uppercase text-slate-500 font-semibold">Notes</span>
                <input type="text" name="repair_notes" placeholder="Internal notes..." class="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100" />
              </label>
            </div>
            <div class="flex items-center justify-between gap-3">
              <p class="text-[10px] text-slate-400" data-repair-status></p>
              <button type="submit" data-repair-submit class="rounded-lg border border-blue-400/50 bg-blue-500/20 px-4 py-1.5 text-[11px] font-semibold text-blue-100 hover:bg-blue-500/30 transition-colors">Save entry</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const tabButtons = body.querySelectorAll('.repair-tab-btn');
    const tabPanels = body.querySelectorAll('.repair-tab-panel');
    const setActiveTab = (tabKey) => {
      tabButtons.forEach((button) => {
        const isActive = button.dataset.tab === tabKey;
        button.classList.toggle('bg-slate-800/80', isActive);
        button.classList.toggle('text-white', isActive);
        button.classList.toggle('text-slate-400', !isActive);
      });
      tabPanels.forEach((panel) => {
        panel.classList.toggle('hidden', panel.dataset.tabPanel !== tabKey);
      });
    };

    tabButtons.forEach((button) => {
      button.addEventListener('click', () => setActiveTab(button.dataset.tab), { signal });
    });

    setActiveTab('history');

    utils.repairHistoryManager.setupRepairHistoryUI({
      vehicle,
      body,
      signal,
      setActiveTab
    });

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  };

  const closeVehicleModal = () => {
    const modal = document.getElementById('vehicle-modal');
    if (!modal) return;
    if (modal.repairModalController) {
      modal.repairModalController.abort();
      modal.repairModalController = null;
    }
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    const panel = document.getElementById('vehicle-modal-columns-panel');
    panel?.classList.add('hidden');
  };

  const attachPopupHandlers = () => {
    const btn = document.querySelector('.vehicle-popup button[data-view-more-popup]');
    if (btn) {
      btn.addEventListener('click', () => {
        const vehicleId = state.selectedVehicleId;
        const vehicle = data.vehicles.find(v => v.id === vehicleId);
        if (vehicle) openVehicleModal(vehicle);
      });
    }
  };

  const setupResizableSidebars = () => {
    const layout = document.getElementById('map-layout');
    const leftSidebar = document.getElementById('left-sidebar');
    const rightSidebar = document.getElementById('right-sidebar');
    if (!layout || !leftSidebar || !rightSidebar) return;

    const rootStyle = document.documentElement.style;
    const minWidth = 260;
    const maxWidth = 720;
    let activeDrag = null;
    let resizePending = false;

    const clampWidth = (value) => Math.min(Math.max(value, minWidth), maxWidth);

    const applyWidth = (side, width) => {
      rootStyle.setProperty(side === 'left' ? '--left-sidebar-width' : '--right-sidebar-width', `${width}px`);
      if (!resizePending) {
        resizePending = true;
        requestAnimationFrame(() => {
          mapManager.invalidateSize();
          resizePending = false;
        });
      }
    };

    const handleMove = (clientX) => {
      if (!activeDrag) return;
      const bounds = layout.getBoundingClientRect();

      if (activeDrag === 'left') {
        const newWidth = clampWidth(clientX - bounds.left);
        applyWidth('left', newWidth);
      }

      if (activeDrag === 'right') {
        const newWidth = clampWidth(bounds.right - clientX);
        applyWidth('right', newWidth);
      }
    };

    const onMouseMove = (event) => handleMove(event.clientX);
    const onTouchMove = (event) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      handleMove(touch.clientX);
    };

    const stopDrag = () => {
      activeDrag = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stopDrag);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', stopDrag);
    };

    const startDrag = (side, event) => {
      event.preventDefault();
      activeDrag = side;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', stopDrag);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', stopDrag);
    };

    const attachHandle = (element, side) => {
      const handle = element.querySelector('.resize-handle');
      if (!handle) return;

      handle.addEventListener('mousedown', (e) => startDrag(side, e));
      handle.addEventListener('touchstart', (e) => startDrag(side, e), { passive: false });
    };

    attachHandle(leftSidebar, 'left');
    attachHandle(rightSidebar, 'right');
  };

  const setupSidebarToggles = () => {
    const leftSidebar = document.getElementById('left-sidebar');
    const rightSidebar = document.getElementById('right-sidebar');
    const resellerSidebar = document.getElementById('reseller-sidebar');
    const repairSidebar = document.getElementById('repair-sidebar');
    const customSidebar = document.getElementById('dynamic-service-sidebar');
    const openLeft = document.getElementById('open-left-sidebar');
    const openRight = document.getElementById('open-right-sidebar');
    const openReseller = document.getElementById('open-reseller-sidebar');
    const openRepair = document.getElementById('open-repair-sidebar');
    const openCustom = state.customToggleRef || document.querySelector('#custom-category-toggles .sidebar-toggle-btn');
    const collapseLeft = document.getElementById('collapse-left');
    const collapseRight = document.getElementById('collapse-right');
    const collapseReseller = document.getElementById('collapse-reseller');
    const collapseRepair = document.getElementById('collapse-repair');
    const collapseCustom = document.getElementById('collapse-dynamic');

    const defaultLeftOffset = 12;
    const defaultRightOffset = 12;
    const syncSidebarVisibility = () => {
      const previousCustomVisible = state.customSidebarVisible;
      state.techSidebarVisible = callbacks.isServiceSidebarVisible('tech');
      state.resellerSidebarVisible = callbacks.isServiceSidebarVisible('reseller');
      state.repairSidebarVisible = callbacks.isServiceSidebarVisible('repair');
      state.customSidebarVisible = callbacks.isServiceSidebarVisible('custom');

      const layers = mapManager.getLayers();

      if (!state.techSidebarVisible) {
        mapManager.renderTechMarkers([]);
        mapManager.clearConnections();
      } else if (layers.techLayer) {
        mapManager.setLayerVisible(layers.techLayer, true);
      }

      if (!state.resellerSidebarVisible) {
        mapManager.renderPartnerMarkers({ partners: [], layer: layers.resellerLayer, type: 'reseller', accentColor: '#34d399', markerLimit: 0 });
      } else if (layers.resellerLayer) {
        mapManager.setLayerVisible(layers.resellerLayer, true);
      }

      if (!state.repairSidebarVisible) {
        mapManager.renderPartnerMarkers({ partners: [], layer: layers.repairLayer, type: 'repair', accentColor: '#fb923c', markerLimit: 0 });
      } else if (layers.repairLayer) {
        mapManager.setLayerVisible(layers.repairLayer, true);
      }

      if (!state.customSidebarVisible) {
        if (layers.customServiceLayer) {
          mapManager.setLayerVisible(layers.customServiceLayer, false);
        }
        mapManager.renderCustomServiceMarkers({ partners: [], customCategories: data.customCategories, markersAllowed: false });
      } else if (layers.customServiceLayer) {
        mapManager.setLayerVisible(layers.customServiceLayer, true);
        data.customCategories.forEach(({ layer }) => mapManager.setLayerVisible(layer, true));
      }

      if (state.customSidebarVisible !== previousCustomVisible) {
        state.lastCustomSidebarVisible = state.customSidebarVisible;
        if (state.customSidebarVisible) callbacks.renderCategorySidebar(state.selectedCustomCategoryKey, data.customServices);
      }

      const leftSideKeys = Object.keys(configs).filter((key) => configs[key]?.group === 'left');
      state.activeLeftPanel = leftSideKeys.find(key => {
        const cfg = configs[key];
        return cfg?.sidebar && !cfg.sidebar.classList.contains(cfg.collapsedClass);
      }) || null;

      callbacks.renderVisibleSidebars();

      if (!callbacks.isAnyServiceSidebarOpen()) {
        mapManager.clearServiceLayers();
      } else {
        const origin = callbacks.getCurrentOrigin();
        if (origin) {
          mapManager.showServicesFromOrigin(origin, { forceType: callbacks.getActivePartnerType() });
        }
      }
    };

    const getSidebarWidth = (sidebar) => sidebar?.getBoundingClientRect().width || 0;

    const rawConfigs = {
      left: { sidebar: leftSidebar, toggle: openLeft, collapse: collapseLeft, collapsedClass: 'collapsed-left', group: 'left' },
      reseller: { sidebar: resellerSidebar, toggle: openReseller, collapse: collapseReseller, collapsedClass: 'collapsed-reseller', group: 'left', type: 'reseller' },
      repair: { sidebar: repairSidebar, toggle: openRepair, collapse: collapseRepair, collapsedClass: 'collapsed-repair', group: 'left', type: 'repair' },
      custom: { sidebar: customSidebar, toggle: openCustom, collapse: collapseCustom, collapsedClass: 'collapsed-dynamic', group: 'left', type: 'custom' },
      right: { sidebar: rightSidebar, toggle: openRight, collapse: collapseRight, collapsedClass: 'collapsed-right', group: 'right' }
    };

    const configs = Object.fromEntries(
      Object.entries(rawConfigs).filter(([, cfg]) => {
        if (!cfg.sidebar || !cfg.toggle) return false;
        if (!cfg.type) return true;
        return callbacks.isServiceTypeEnabled(cfg.type);
      })
    );

    const syncMap = () => { setTimeout(() => mapManager.invalidateSize(), 320); };

    const leftSideKeys = Object.keys(configs).filter((key) => configs[key]?.group === 'left');

    const updateTogglePositions = () => {
      const expandedEntry = leftSideKeys
        .map((key) => configs[key])
        .find(cfg => cfg?.sidebar && !cfg.sidebar.classList.contains(cfg.collapsedClass));

      const anchorLeft = expandedEntry
        ? getSidebarWidth(expandedEntry.sidebar) + defaultLeftOffset
        : defaultLeftOffset;

      leftSideKeys.forEach(key => {
        const toggle = configs[key]?.toggle;
        if (toggle) toggle.style.left = `${anchorLeft}px`;
      });

      const customSlot = document.getElementById('custom-toggle-slot');
      if (customSlot) customSlot.style.left = `${anchorLeft}px`;
      document.querySelectorAll('#custom-category-toggles .sidebar-toggle-btn').forEach((btn) => {
        btn.style.left = `${anchorLeft}px`;
      });

      const rightSidebarIsCollapsed = configs.right?.sidebar?.classList.contains(configs.right.collapsedClass);
      const anchorRight = rightSidebarIsCollapsed
        ? defaultRightOffset
        : getSidebarWidth(configs.right.sidebar) + defaultRightOffset;

      const rightToggleGroup = document.getElementById('right-toggle-group');
      if (rightToggleGroup) {
        rightToggleGroup.style.right = `${anchorRight}px`;
      }
    };

    const applyState = (side, expanded) => {
      const configEntry = configs[side];
      if (!configEntry?.sidebar || !configEntry?.toggle) return false;
      const wasCollapsed = configEntry.sidebar.classList.contains(configEntry.collapsedClass);
      const shouldCollapse = !expanded;
      if (shouldCollapse && !wasCollapsed) {
        configEntry.sidebar.classList.add(configEntry.collapsedClass);
        configEntry.toggle.classList.remove('active');
        configEntry.toggle.setAttribute('aria-pressed', 'false');
      } else if (!shouldCollapse && wasCollapsed) {
        configEntry.sidebar.classList.remove(configEntry.collapsedClass);
        configEntry.toggle.classList.add('active');
        configEntry.toggle.setAttribute('aria-pressed', 'true');
      }
      return wasCollapsed !== shouldCollapse;
    };

    const setState = (side, expanded) => {
      const changed = applyState(side, expanded);
      if (!changed) return;

      if (expanded && configs[side]?.group === 'left') {
        leftSideKeys.forEach(key => {
          if (key !== side) applyState(key, false);
        });

        const origin = callbacks.getCurrentOrigin();
        if (origin) {
          const newType = configs[side].type || config.SIDEBAR_TYPE_BY_KEY[side];
          setTimeout(() => {
            mapManager.showServicesFromOrigin(origin, { forceType: newType });
          }, 50);
        }
      }

      updateTogglePositions();
      syncSidebarVisibility();
      syncMap();
    };

    sidebarStateController = { setState, updateTogglePositions };

    Object.entries(configs).forEach(([side, configEntry]) => {
      if (configEntry.toggle) configEntry.toggle.addEventListener('click', () => setState(side, true));
      if (configEntry.collapse) configEntry.collapse.addEventListener('click', () => setState(side, false));
      setState(side, state.defaultSidebarVisible);
    });

    updateTogglePositions();
    window.addEventListener('resize', updateTogglePositions);
  };

  const bindModalEvents = () => {
    document.getElementById('vehicle-modal-close')?.addEventListener('click', closeVehicleModal);
    document.getElementById('vehicle-modal-columns-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('vehicle-modal-columns-panel');
      if (!panel) return;
      panel.classList.toggle('hidden');
    });
    document.getElementById('vehicle-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'vehicle-modal') closeVehicleModal();
    });
  };

  return {
    toggleSelectionBanner,
    openVehicleModal,
    openRepairModal,
    closeVehicleModal,
    attachPopupHandlers,
    setupResizableSidebars,
    setupSidebarToggles,
    bindModalEvents,
    getSidebarStateController
  };
}
