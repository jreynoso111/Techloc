const buildRepairSnapshot = (vehicle, getRepairVehicleVin) => ({
  vehicle_id: vehicle?.vehicle_id ?? vehicle?.vehicleId ?? vehicle?.id,
  deal_status: vehicle?.deal_status ?? vehicle?.status,
  customer_id: vehicle?.customer_id ?? vehicle?.customerId,
  unit_type: vehicle?.unit_type ?? vehicle?.type,
  model_year: vehicle?.model_year ?? vehicle?.year,
  model: vehicle?.model,
  inv_prep_stat: vehicle?.inv_prep_stat ?? vehicle?.invPrepStatus,
  deal_completion: vehicle?.deal_completion ?? vehicle?.dealCompletion,
  pt_status: vehicle?.pt_status ?? vehicle?.ptStatus,
  pt_serial: vehicle?.pt_serial ?? vehicle?.ptSerial,
  encore_serial: vehicle?.encore_serial ?? vehicle?.encoreSerial,
  moving: vehicle?.moving,
  pt_last_read: vehicle?.pt_last_read ?? vehicle?.lastRead,
  lat: vehicle?.lat,
  long: vehicle?.long ?? vehicle?.lng,
  phys_loc: vehicle?.phys_loc ?? vehicle?.lastLocation,
  VIN: getRepairVehicleVin(vehicle),
  vehicle_status: vehicle?.vehicle_status ?? vehicle?.status,
  open_balance: vehicle?.open_balance ?? vehicle?.openBalance,
  days_stationary: vehicle?.days_stationary ?? vehicle?.daysStationary,
  short_location: vehicle?.short_location ?? vehicle?.shortLocation ?? vehicle?.city,
  current_stock_no: vehicle?.details?.['Current Stock No'] ?? vehicle?.current_stock_no,
  gps_fix: vehicle?.gps_fix ?? vehicle?.gpsFix,
  gps_fix_reason: vehicle?.gps_fix_reason ?? vehicle?.gpsReason
});

const getDefaultHelpers = () => ({
  escapeHTML: (value = '') => `${value}`,
  formatDateTime: (value) => value,
});

const getRepairVehicleVin = (vehicle) => {
  const vin = vehicle?.VIN ?? vehicle?.details?.VIN ?? '';
  return typeof vin === 'string' ? vin.trim() : '';
};

const createRepairHistoryManager = ({
  supabaseClient,
  startLoading,
  ensureSupabaseSession,
  runWithTimeout,
  timeoutMs = 10000,
  tableName,
  escapeHTML,
  formatDateTime
} = {}) => {
  const helpers = getDefaultHelpers();
  const safeEscape = escapeHTML || helpers.escapeHTML;
  const safeFormatDateTime = formatDateTime || helpers.formatDateTime;

  const fetchRepairs = async (VIN) => {
    if (!supabaseClient || !VIN) return [];
    try {
      await ensureSupabaseSession?.();
      const { data, error } = await runWithTimeout(
        supabaseClient
          .from(tableName)
          .select('*')
          .eq('VIN', VIN)
          .order('created_at', { ascending: false }),
        timeoutMs,
        'Repair history request timed out.'
      );
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to load repair history:', error);
      return [];
    }
  };

  const saveRepair = async (vehicle, formData, editId) => {
    try {
      if (!supabaseClient) {
        throw new Error('Supabase unavailable');
      }
      await ensureSupabaseSession?.();
      const cleanPrice = Number.parseFloat(`${formData.get('repair_price') || '0'}`.replace(/[$,]/g, '')) || 0;
      const payload = {
        ...buildRepairSnapshot(vehicle, getRepairVehicleVin),
        cs_contact_date: formData.get('cs_contact_date') || null,
        status: formData.get('status') || null,
        doc: formData.get('doc') || null,
        shipping_date: formData.get('shipping_date') || null,
        poc_name: formData.get('poc_name') || null,
        poc_phone: formData.get('poc_phone') || null,
        customer_availability: formData.get('customer_availability') || null,
        installer_request_date: formData.get('installer_request_date') || null,
        installation_company: formData.get('installation_company') || null,
        technician_availability_date: formData.get('technician_availability_date') || null,
        installation_place: formData.get('installation_place') || null,
        repair_price: cleanPrice,
        repair_notes: formData.get('repair_notes') || null
      };

      const query = supabaseClient.from(tableName);
      const { data, error } = editId
        ? await runWithTimeout(
          query.update(payload).eq('id', editId).select('*'),
          timeoutMs,
          'Repair update request timed out.'
        )
        : await runWithTimeout(
          query.insert(payload).select('*'),
          timeoutMs,
          'Repair create request timed out.'
        );
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to save repair entry:', error);
      throw error;
    }
  };

  const setupRepairHistoryUI = ({ vehicle, body, signal, setActiveTab }) => {
    const VIN = getRepairVehicleVin(vehicle);
    const historyBody = body.querySelector('[data-repair-history-body]');
    const historyEmpty = body.querySelector('[data-repair-empty]');
    const historyHead = body.querySelector('[data-repair-history-head]');
    const repairColumnsToggle = body.querySelector('[data-repair-columns-toggle]');
    const repairColumnsPanel = body.querySelector('[data-repair-columns-panel]');
    const repairColumnsList = body.querySelector('[data-repair-columns-list]');
    const repairSearchInput = body.querySelector('[data-repair-search]');
    const form = body.querySelector('[data-repair-form]');
    const statusText = body.querySelector('[data-repair-status]');
    const submitBtn = body.querySelector('[data-repair-submit]');

    let repairCache = [];
    let repairColumns = [];
    let repairColumnVisibility = {};
    let repairSearchQuery = '';
    let repairSortKey = '';
    let repairSortDirection = 'desc';
    const REPAIR_COLUMN_STORAGE_KEY = 'repairHistoryColumns';

    const DEFAULT_REPAIR_COLUMNS = [
      { key: 'cs_contact_date', label: 'Date' },
      { key: 'status', label: 'Status' },
      { key: 'doc', label: 'DOC' },
      { key: 'shipping_date', label: 'Shipping Date' },
      { key: 'poc_name', label: 'POC Name' },
      { key: 'poc_phone', label: 'POC Phone' },
      { key: 'customer_availability', label: 'Customer Availability' },
      { key: 'installer_request_date', label: 'Installer Request Date' },
      { key: 'installation_company', label: 'Installation Company' },
      { key: 'technician_availability_date', label: 'Technician Availability Date' },
      { key: 'installation_place', label: 'Installation Place' },
      { key: 'repair_notes', label: 'Notes' },
      { key: 'repair_price', label: 'Cost' }
    ];

    const formatRepairValue = (key, value) => {
      if (value === null || value === undefined || value === '') return '—';
      if (key.includes('date')) return safeFormatDateTime(value);
      return value;
    };

    const renderStatusBadge = (value) => {
      const text = value ? `${value}` : '—';
      const normalized = text.toLowerCase();
      let badgeClasses = 'bg-slate-800/70 text-slate-200 border-slate-700';
      if (normalized.includes('done') || normalized.includes('complete')) {
        badgeClasses = 'bg-emerald-500/15 text-emerald-200 border-emerald-400/40';
      } else if (normalized.includes('pending') || normalized.includes('open')) {
        badgeClasses = 'bg-amber-500/15 text-amber-200 border-amber-400/40';
      } else if (normalized.includes('cancel') || normalized.includes('fail')) {
        badgeClasses = 'bg-rose-500/15 text-rose-200 border-rose-400/40';
      }
      return `<span class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${badgeClasses}">${safeEscape(text)}</span>`;
    };

    const renderNotesCell = (value) => {
      if (value === null || value === undefined || value === '') return '—';
      return `
        <button type="button" class="max-w-[260px] truncate text-left text-slate-300 hover:text-slate-100 transition-colors" data-repair-notes>
          ${safeEscape(value)}
        </button>
      `;
    };

    const renderRepairCell = (columnKey, repair) => {
      if (columnKey === 'status') {
        return renderStatusBadge(repair?.[columnKey]);
      }
      if (columnKey === 'repair_notes') {
        return renderNotesCell(repair?.[columnKey]);
      }
      return safeEscape(formatRepairValue(columnKey, repair?.[columnKey]));
    };

    const titleCase = (value) => value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase());

    const CRITICAL_REPAIR_COLUMNS = new Set(['cs_contact_date', 'status', 'repair_notes']);
    const TECHNICAL_REPAIR_COLUMNS = new Set([
      'id',
      'vehicle_id',
      'vehicleId',
      'customer_id',
      'customerId',
      'created_at',
      'updated_at',
      'VIN',
      'vin'
    ]);

    const getDefaultRepairColumnVisibility = (key) => {
      if (CRITICAL_REPAIR_COLUMNS.has(key)) return true;
      if (TECHNICAL_REPAIR_COLUMNS.has(key)) return false;
      if (DEFAULT_REPAIR_COLUMNS.some((col) => col.key === key)) return true;
      return false;
    };

    const toggleRepairColumn = (key, isVisible) => {
      repairColumnVisibility[key] = isVisible;
      saveRepairColumnVisibility();
      renderRepairTableHead();
      renderRepairHistory(repairCache);
    };

    const loadRepairColumnVisibility = (columns) => {
      let saved = {};
      try {
        saved = JSON.parse(localStorage.getItem(REPAIR_COLUMN_STORAGE_KEY) || '{}');
      } catch (error) {
        saved = {};
      }
      repairColumnVisibility = columns.reduce((acc, col) => {
        acc[col.key] = saved[col.key] !== undefined ? saved[col.key] : getDefaultRepairColumnVisibility(col.key);
        return acc;
      }, {});
    };

    const saveRepairColumnVisibility = () => {
      localStorage.setItem(REPAIR_COLUMN_STORAGE_KEY, JSON.stringify(repairColumnVisibility));
    };

    const buildRepairColumns = (repairs) => {
      const columnMap = new Map(DEFAULT_REPAIR_COLUMNS.map((col) => [col.key, col]));
      repairs.forEach((repair) => {
        Object.keys(repair || {}).forEach((key) => {
          if (!columnMap.has(key)) {
            columnMap.set(key, { key, label: titleCase(key) });
          }
        });
      });
      const orderedKeys = [
        ...DEFAULT_REPAIR_COLUMNS.map((col) => col.key),
        ...[...columnMap.keys()].filter((key) => !DEFAULT_REPAIR_COLUMNS.some((col) => col.key === key))
      ];
      repairColumns = orderedKeys.map((key) => columnMap.get(key)).filter(Boolean);
      if (!Object.keys(repairColumnVisibility).length) {
        loadRepairColumnVisibility(repairColumns);
      } else {
        repairColumns.forEach((col) => {
          if (repairColumnVisibility[col.key] === undefined) {
            repairColumnVisibility[col.key] = getDefaultRepairColumnVisibility(col.key);
          }
        });
      }
    };

    const renderRepairColumnsList = () => {
      if (!repairColumnsList) return;
      if (!repairColumns.length) {
        repairColumnsList.innerHTML = '<p class="text-xs text-slate-400">No columns available.</p>';
        return;
      }
      repairColumnsList.innerHTML = repairColumns.map((col) => `
        <label class="flex items-center gap-2">
          <input type="checkbox" value="${col.key}" class="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950" ${repairColumnVisibility[col.key] ? 'checked' : ''} />
          <span class="text-slate-200">${safeEscape(col.label)}</span>
        </label>
      `).join('');
    };

    const getVisibleRepairColumns = () => repairColumns.filter((col) => repairColumnVisibility[col.key]);

    const renderRepairTableHead = () => {
      if (!historyHead) return;
      const visibleColumns = getVisibleRepairColumns();
      if (!visibleColumns.length) {
        historyHead.innerHTML = `
          <tr>
            <th class="py-2 pr-3">No columns selected</th>
            <th class="py-2">Actions</th>
          </tr>
        `;
        return;
      }
      historyHead.innerHTML = `
        <tr>
          ${visibleColumns.map((col) => `
            <th class="py-2 pr-3">
              <button type="button" class="group inline-flex items-center gap-1 text-left text-[10px] uppercase tracking-[0.08em] text-slate-400 hover:text-slate-200 transition-colors" data-repair-sort="${col.key}">
                <span>${safeEscape(col.label)}</span>
                <span class="text-[9px] text-slate-500 group-hover:text-slate-300">${repairSortKey === col.key ? (repairSortDirection === 'asc' ? '▲' : '▼') : ''}</span>
              </button>
            </th>
          `).join('')}
          <th class="py-2">Actions</th>
        </tr>
      `;
    };

    const getFilteredRepairs = (repairs) => {
      const query = repairSearchQuery.trim().toLowerCase();
      if (!query) return repairs;
      return repairs.filter((repair) => {
        const status = `${repair?.status || ''}`.toLowerCase();
        const notes = `${repair?.repair_notes || ''}`.toLowerCase();
        const company = `${repair?.installation_company || ''}`.toLowerCase();
        return status.includes(query) || notes.includes(query) || company.includes(query);
      });
    };

    const getSortedRepairs = (repairs) => {
      if (!repairSortKey) return repairs;
      const direction = repairSortDirection === 'asc' ? 1 : -1;
      return [...repairs].sort((a, b) => {
        const valueA = a?.[repairSortKey];
        const valueB = b?.[repairSortKey];
        if (valueA === valueB) return 0;
        if (valueA === null || valueA === undefined || valueA === '') return 1 * direction;
        if (valueB === null || valueB === undefined || valueB === '') return -1 * direction;
        if (typeof valueA === 'number' && typeof valueB === 'number') {
          return (valueA - valueB) * direction;
        }
        return `${valueA}`.localeCompare(`${valueB}`, undefined, { numeric: true, sensitivity: 'base' }) * direction;
      });
    };

    const renderRepairHistory = (repairs = []) => {
      if (!historyBody) return;
      repairCache = repairs;
      buildRepairColumns(repairs);
      renderRepairColumnsList();
      renderRepairTableHead();
      const visibleColumns = getVisibleRepairColumns();
      const filteredRepairs = getSortedRepairs(getFilteredRepairs(repairs));
      if (!filteredRepairs.length) {
        const colSpan = Math.max(visibleColumns.length + 1, 1);
        historyBody.innerHTML = `
          <tr data-repair-empty>
            <td class="py-2 pr-3 text-slate-400" colspan="${colSpan}">No repair records yet.</td>
          </tr>
        `;
        return;
      }
      historyBody.innerHTML = filteredRepairs.map((repair) => `
        <tr>
          ${visibleColumns.map((col) => `
            <td class="py-2 pr-3 text-slate-300">${renderRepairCell(col.key, repair)}</td>
          `).join('')}
          <td class="py-2">
            <div class="flex items-center gap-2">
              <button type="button" class="rounded border border-blue-400/50 bg-blue-500/10 px-2 py-1 text-[10px] font-semibold text-blue-100 hover:bg-blue-500/20 transition-colors" data-repair-edit="${repair?.id || ''}">Edit</button>
              <button type="button" class="rounded border border-rose-400/50 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-100 hover:bg-rose-500/20 transition-colors" data-repair-delete="${repair?.id || ''}">Delete</button>
            </div>
          </td>
        </tr>
      `).join('');
    };

    const deleteRepair = async (repairId) => {
      if (!supabaseClient) {
        throw new Error('Supabase unavailable');
      }
      if (!repairId) return;
      const confirmed = window.confirm('Are you sure you want to delete this repair entry?');
      if (!confirmed) return;
      const { error } = await supabaseClient
        .from(tableName)
        .delete()
        .eq('id', repairId);
      if (error) throw error;
      const repairs = await fetchRepairs(VIN);
      renderRepairHistory(repairs);
    };

    if (historyEmpty) historyEmpty.textContent = 'Loading history...';
    fetchRepairs(VIN).then(renderRepairHistory);

    if (repairColumnsToggle && repairColumnsPanel) {
      repairColumnsToggle.addEventListener('click', () => {
        repairColumnsPanel.classList.toggle('hidden');
      }, { signal });
    }

    if (repairColumnsList) {
      repairColumnsList.addEventListener('change', (event) => {
        const input = event.target;
        if (!input || input.tagName !== 'INPUT') return;
        toggleRepairColumn(input.value, input.checked);
      }, { signal });
    }

    if (historyHead) {
      historyHead.addEventListener('click', (event) => {
        const button = event.target.closest('[data-repair-sort]');
        if (!button) return;
        const sortKey = button.dataset.repairSort;
        if (!sortKey) return;
        if (repairSortKey === sortKey) {
          repairSortDirection = repairSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          repairSortKey = sortKey;
          repairSortDirection = 'asc';
        }
        renderRepairHistory(repairCache);
      }, { signal });
    }

    if (repairSearchInput) {
      repairSearchInput.addEventListener('input', (event) => {
        repairSearchQuery = event.target.value || '';
        renderRepairHistory(repairCache);
      }, { signal });
    }

    if (historyBody) {
      historyBody.addEventListener('click', async (event) => {
        const notesButton = event.target.closest('[data-repair-notes]');
        if (notesButton) {
          notesButton.classList.toggle('truncate');
          notesButton.classList.toggle('whitespace-normal');
          notesButton.classList.toggle('break-words');
          return;
        }
        const editButton = event.target.closest('[data-repair-edit]');
        const deleteButton = event.target.closest('[data-repair-delete]');
        if (editButton) {
          const repairId = editButton.dataset.repairEdit;
          const repair = repairCache.find((item) => `${item?.id}` === `${repairId}`);
          if (!repair || !form) return;
          form.dataset.editRepairId = repairId;
          const csContactInput = form.querySelector('[name="cs_contact_date"]');
          const statusInput = form.querySelector('[name="status"]');
          const docInput = form.querySelector('[name="doc"]');
          const shippingDateInput = form.querySelector('[name="shipping_date"]');
          const pocNameInput = form.querySelector('[name="poc_name"]');
          const pocPhoneInput = form.querySelector('[name="poc_phone"]');
          const customerAvailabilityInput = form.querySelector('[name="customer_availability"]');
          const installerRequestInput = form.querySelector('[name="installer_request_date"]');
          const installationCompanyInput = form.querySelector('[name="installation_company"]');
          const technicianAvailabilityInput = form.querySelector('[name="technician_availability_date"]');
          const installationPlaceInput = form.querySelector('[name="installation_place"]');
          const repairPriceInput = form.querySelector('[name="repair_price"]');
          const repairNotesInput = form.querySelector('[name="repair_notes"]');
          if (csContactInput) csContactInput.value = repair?.cs_contact_date || '';
          if (statusInput) statusInput.value = repair?.status || '';
          if (docInput) docInput.value = repair?.doc || '';
          if (shippingDateInput) shippingDateInput.value = repair?.shipping_date || '';
          if (pocNameInput) pocNameInput.value = repair?.poc_name || '';
          if (pocPhoneInput) pocPhoneInput.value = repair?.poc_phone || '';
          if (customerAvailabilityInput) customerAvailabilityInput.value = repair?.customer_availability || '';
          if (installerRequestInput) installerRequestInput.value = repair?.installer_request_date || '';
          if (installationCompanyInput) installationCompanyInput.value = repair?.installation_company || '';
          if (technicianAvailabilityInput) technicianAvailabilityInput.value = repair?.technician_availability_date || '';
          if (installationPlaceInput) installationPlaceInput.value = repair?.installation_place || '';
          if (repairPriceInput) repairPriceInput.value = repair?.repair_price ?? '';
          if (repairNotesInput) repairNotesInput.value = repair?.repair_notes || '';
          if (submitBtn) submitBtn.textContent = 'Update Record';
          if (statusText) statusText.textContent = '';
          setActiveTab('new-entry');
          return;
        }
        if (deleteButton) {
          try {
            await deleteRepair(deleteButton.dataset.repairDelete);
          } catch (error) {
            console.warn('Failed to delete repair:', error);
          }
        }
      }, { signal });
    }

    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!vehicle) return;
        const submitLabel = submitBtn?.textContent || 'Save entry';
        submitBtn && (submitBtn.disabled = true);
        if (submitBtn) submitBtn.textContent = 'Saving...';
        if (statusText) {
          statusText.textContent = 'Saving repair...';
          statusText.classList.remove('text-amber-200');
          statusText.classList.add('text-slate-400');
        }
        const stopLoading = startLoading('Saving repair...');
        try {
          const formData = new FormData(form);
          const editId = form?.dataset.editRepairId || '';
          await saveRepair(vehicle, formData, editId);
          form.reset();
          if (editId) {
            delete form.dataset.editRepairId;
            if (submitBtn) submitBtn.textContent = 'Save entry';
          }
          const repairs = await fetchRepairs(VIN);
          renderRepairHistory(repairs);
          if (statusText) {
            statusText.textContent = 'Entry saved successfully.';
            statusText.classList.remove('text-slate-400', 'text-amber-300');
            statusText.classList.add('text-amber-200');
          }
          setActiveTab('history');
        } catch (error) {
          console.warn('Failed to save repair:', error);
          if (statusText) {
            statusText.textContent = error?.message || 'Unable to save repair.';
            statusText.classList.remove('text-slate-400', 'text-amber-200');
            statusText.classList.add('text-amber-300');
          }
        } finally {
          stopLoading();
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitLabel;
          }
        }
      }, { signal });
    }
  };

  return {
    getRepairVehicleVin,
    fetchRepairs,
    saveRepair,
    setupRepairHistoryUI
  };
};

export { createRepairHistoryManager };
