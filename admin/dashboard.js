const dashboardConfigs = {
  'vehicles.html': {
    csv: '../assets/vehicles.csv',
    tableSelector: '#vehicles-table',
    emptyMessage: 'No vehicles found.',
  },
  'technicians.html': {
    csv: '../assets/technicians.csv',
    tableSelector: '#technicians-table',
    emptyMessage: 'No technicians found.',
  },
};

document.addEventListener('DOMContentLoaded', () => {
  const currentPage = getCurrentPage();
  const isAdminHome = window.location.pathname.includes('/admin/') && currentPage === 'index.html';

  if (isAdminHome) {
    initOperationalDashboard();
    return;
  }

  const config = dashboardConfigs[currentPage];
  if (!config) return;

  loadAndRenderDashboard(config);
});

function getCurrentPage() {
  return window.location.pathname.split('/').pop();
}

const technicianColumns = ['ID', 'Name', 'Status', 'State', 'Phone'];
const vehicleColumns = [
  'ShortVIN',
  'Model',
  'Unit Type',
  'Deal Status',
  'Inv. Prep. Stat.',
  'GPS Fix',
  'PT Status',
  'State Loc',
  'PT City',
];

let techniciansData = [];
let vehiclesData = [];

async function initOperationalDashboard() {
  try {
    const [technicians, vehicles] = await Promise.all([
      loadCsvAsObjects('../assets/technicians.csv'),
      loadCsvAsObjects('../assets/vehicles.csv'),
    ]);

    techniciansData = technicians;
    vehiclesData = vehicles;

    renderKpis(techniciansData, vehiclesData);
    renderTechnicianTable(getFilteredData(techniciansData, 'tech-search'));
    renderVehicleTable(getFilteredData(vehiclesData, 'vehicle-search'));

    setupSearch('tech-search', techniciansData, renderTechnicianTable);
    setupSearch('vehicle-search', vehiclesData, renderVehicleTable);

    setupDownload('tech-download', techniciansData, 'technicians-updated.csv', technicianColumns);
    setupDownload('vehicle-download', vehiclesData, 'vehicles-updated.csv');

    setupTabs();
  } catch (error) {
    console.error('Error initializing dashboard:', error);
  }
}

async function loadAndRenderDashboard(config) {
  try {
    const csvText = await fetchCsv(config.csv);
    const rows = parseCsv(csvText);

    if (!rows.length) {
      renderEmptyState(config.tableSelector, config.emptyMessage, 1);
      return;
    }

    const [headers, ...dataRows] = rows;
    if (!headers || !headers.length) {
      renderEmptyState(config.tableSelector, config.emptyMessage, 1);
      return;
    }

    renderTable(config.tableSelector, headers, dataRows);
  } catch (error) {
    console.error('Error loading CSV:', error);
    renderEmptyState(config.tableSelector, 'Unable to load the table.', 1);
  }
}

async function fetchCsv(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`CSV could not be retrieved from ${url}`);
  return response.text();
}

async function loadCsvAsObjects(url) {
  const text = await fetchCsv(url);
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const [headers, ...dataRows] = rows;
  const normalizedHeaders = headers.map((h) => (h || '').trim());
  return dataRows.map((row) => {
    const entry = {};
    normalizedHeaders.forEach((header, index) => {
      entry[header] = (row[index] || '').trim();
    });
    return entry;
  });
}

function parseCsv(text) {
  const rows = [];
  let current = '';
  let insideQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (insideQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && next === '\n') {
        i++;
      }
      row.push(current.trim());
      if (row.some((cell) => cell !== '')) {
        rows.push(row);
      }
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  if (current.length || row.length) {
    row.push(current.trim());
    if (row.some((cell) => cell !== '')) {
      rows.push(row);
    }
  }

  return rows;
}

function renderKpis(technicians, vehicles) {
  const totalTechs = technicians.length;
  const activeTechs = technicians.filter((tech) => normalizeStatus(tech) === 'active').length;
  const coverage = totalTechs ? Math.round((activeTechs / totalTechs) * 100) : 0;

  const vehiclesWithIssues = vehicles.filter(hasVehicleIssue).length;
  const pendingRepairs = vehicles.filter(needsVehicleRepair).length;

  setText('kpi-technicians', totalTechs || '--');
  setText('kpi-active', `${coverage}%`);
  setText('kpi-issues', vehiclesWithIssues || '--');
  setText('kpi-pending', pendingRepairs || '--');
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function renderTechnicianTable(technicians = []) {
  const tbody = document.getElementById('tech-body');
  if (!tbody) return;

  if (!technicians.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-slate-400">No technicians available.</td></tr>';
    return;
  }

  const rows = technicians.map((tech) => {
    const status = tech.estate || tech.Status || tech.status || tech.Estate || '';
    const baseIndex = techniciansData.indexOf(tech);
    return `
      <tr class="hover:bg-slate-900/50 transition-colors ${getRowStatusClass(status)}" data-index="${baseIndex}" data-type="tech">
        <td class="px-6 py-3 text-slate-100">${tech.ID || '—'}</td>
        <td class="px-6 py-3 text-slate-100">${tech.Name || '—'}</td>
        <td class="px-6 py-3 ${getStatusClass(status)}">${status || '—'}</td>
        <td class="px-6 py-3 text-slate-100">${tech.State || '—'}</td>
        <td class="px-6 py-3 text-slate-100">${tech.Phone || '—'}</td>
        <td class="px-6 py-3">
          <button class="action-btn edit-btn">Edit</button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rows.join('');
  attachRowEditing(tbody, technicianColumns, 'tech');
}

function renderVehicleTable(vehicles = []) {
  const tbody = document.getElementById('vehicle-body');
  if (!tbody) return;

  if (!vehicles.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="px-6 py-4 text-slate-400">No vehicles available.</td></tr>';
    return;
  }

  const rows = vehicles.map((vehicle) => {
    const baseIndex = vehiclesData.indexOf(vehicle);
    const dealStatus = vehicle['Deal Status'] || '';
    const prepStatus = vehicle['Inv. Prep. Stat.'] || '';
    const ptStatus = vehicle['PT Status'] || '';
    const statusBadge = ptStatus || dealStatus || '—';
    return `
      <tr class="hover:bg-slate-900/50 transition-colors ${getVehicleRowClass(dealStatus, prepStatus, ptStatus)}" data-index="${baseIndex}" data-type="vehicle">
        <td class="px-6 py-3 text-slate-100">${vehicle.ShortVIN || '—'}</td>
        <td class="px-6 py-3 text-slate-100">${vehicle.Model || '—'}</td>
        <td class="px-6 py-3 text-slate-100">${vehicle['Unit Type'] || '—'}</td>
        <td class="px-6 py-3 ${getStatusClass(dealStatus)}">${dealStatus || '—'}</td>
        <td class="px-6 py-3 text-amber-200">${prepStatus || '—'}</td>
        <td class="px-6 py-3 text-slate-100">${vehicle['GPS Fix'] || '—'}</td>
        <td class="px-6 py-3 ${getStatusClass(ptStatus)}">${statusBadge}</td>
        <td class="px-6 py-3 text-slate-100">${vehicle['State Loc'] || '—'}</td>
        <td class="px-6 py-3 text-slate-100">${vehicle['PT City'] || '—'}</td>
        <td class="px-6 py-3 text-slate-100">${vehicle['PT Last Read'] || '—'}</td>
        <td class="px-6 py-3">
          <button class="action-btn edit-btn">Edit</button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rows.join('');
  attachRowEditing(tbody, vehicleColumns, 'vehicle');
}

function setupSearch(inputId, data, renderFn) {
  const input = document.getElementById(inputId);
  if (!input) return;

  input.addEventListener('input', (event) => {
    const filtered = getFilteredData(data, inputId, event.target.value);
    renderFn(filtered);
  });
}

function getFilteredData(data, inputId, overrideTerm) {
  const input = document.getElementById(inputId);
  const term = (overrideTerm ?? input?.value ?? '').toLowerCase();
  return data.filter((item) =>
    Object.values(item).some((value) => String(value || '').toLowerCase().includes(term)),
  );
}

function setupDownload(buttonId, data, filename, headers) {
  const button = document.getElementById(buttonId);
  if (!button) return;

  button.addEventListener('click', () => {
    // Note: to persist changes on GitHub Pages, upload the downloaded CSV manually.
    const csvContent = objectsToCsv(data, headers);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.click();
    URL.revokeObjectURL(url);
  });
}

function objectsToCsv(data, headers) {
  if (!data.length) return headers ? `${headers.join(',')}` : '';
  const columns = headers?.length ? headers : Object.keys(data[0]);
  const escapeValue = (value) => {
    if (value == null) return '';
    const needsQuotes = /[",\n]/.test(value);
    const cleaned = String(value).replace(/"/g, '""');
    return needsQuotes ? `"${cleaned}"` : cleaned;
  };
  const rows = data.map((row) => columns.map((col) => escapeValue(row[col])).join(','));
  return [columns.join(','), ...rows].join('\n');
}

function setupTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');
  if (!buttons.length || !panels.length) return;

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-tab');
      buttons.forEach((btn) => btn.classList.remove('active', 'text-white', 'bg-slate-800'));
      panels.forEach((panel) => panel.classList.add('hidden'));

      button.classList.add('active', 'text-white', 'bg-slate-800');
      const panel = document.getElementById(`tab-${target}`);
      if (panel) panel.classList.remove('hidden');
    });
  });
}

function parseCsvLine(line = '') {
  return (line.match(/(".*?"|[^",]+)(?=,|$)/g) || []).map((value) => value.replace(/^"|"$/g, ''));
}

function renderTable(selector, headers, data) {
  const table = document.querySelector(selector);
  if (!table) return;

  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  if (thead) {
    thead.innerHTML = `
      <tr>
        ${headers
          .map((header) => `<th class="px-6 py-3 text-left font-semibold">${header || '—'}</th>`)
          .join('')}
      </tr>
    `;
  }

  if (tbody) {
    const rowsHtml = data.map((row) => {
      const cells = headers
        .map((header, index) => {
          const value = row[index] || '';
          const display = value || '—';
          const isStatus = header?.trim().toLowerCase() === 'status';
          const statusClass = isStatus ? getStatusClass(value) : 'text-slate-200';
          return `<td class="px-6 py-3 ${statusClass}">${display}</td>`;
        })
        .join('');

      return `<tr class="hover:bg-slate-900/50 transition-colors">${cells}</tr>`;
    });

    if (!rowsHtml.length) {
      renderEmptyState(selector, 'No records to display.', headers.length);
      return;
    }

    tbody.innerHTML = rowsHtml.join('');
  }
}

function renderEmptyState(selector, message, columns) {
  const table = document.querySelector(selector);
  if (!table) return;

  const tbody = table.querySelector('tbody');
  if (tbody) {
    tbody.innerHTML = `<tr><td class="px-6 py-4 text-slate-400" colspan="${columns}">${message}</td></tr>`;
  }
}

function getStatusClass(status = '') {
  const normalized = status.trim().toLowerCase();
  if (['active', 'activo', 'enabled'].includes(normalized)) return 'text-emerald-400 font-semibold';
  if (
    normalized === 'inactive' ||
    normalized === 'inactivo' ||
    normalized === 'critical' ||
    normalized === 'disabled' ||
    normalized.includes('repo')
  )
    return 'text-red-400 font-semibold';
  return 'text-slate-200';
}

function getRowStatusClass(status = '') {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'critical') return 'row-alert row-critical';
  if (normalized === 'inactive' || normalized === 'inactivo') return 'row-alert row-inactive';
  return '';
}

function getVehicleRowClass(dealStatus = '', prepStatus = '', ptStatus = '') {
  const status = (ptStatus || dealStatus || '').trim().toLowerCase();
  const prep = (prepStatus || '').trim().toLowerCase();

  if (status.includes('disabled') || prep.includes('repo')) return 'row-alert row-critical';
  if (status && status !== 'active' && status !== 'enabled') return 'row-alert row-inactive';
  return '';
}

function hasVehicleIssue(vehicle = {}) {
  const prepStatus = (vehicle['Inv. Prep. Stat.'] || '').trim().toLowerCase();
  const ptStatus = (vehicle['PT Status'] || '').trim().toLowerCase();
  const gpsFix = (vehicle['GPS Fix'] || '').trim().toLowerCase();

  const prepProblem = prepStatus && prepStatus !== 'available';
  const deviceProblem = ptStatus && ptStatus !== 'enabled';
  const trackingProblem = gpsFix && gpsFix !== 'all';
  return prepProblem || deviceProblem || trackingProblem;
}

function needsVehicleRepair(vehicle = {}) {
  const ptStatus = (vehicle['PT Status'] || '').trim().toLowerCase();
  const gpsFix = (vehicle['GPS Fix'] || '').trim().toLowerCase();
  return (ptStatus && ptStatus !== 'enabled') || (gpsFix && gpsFix !== 'all');
}

function normalizeStatus(tech) {
  return (tech.estate || tech.Status || tech.status || tech.Estate || '').trim().toLowerCase();
}

function attachRowEditing(tbody, columns, type) {
  tbody.querySelectorAll('.edit-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      const row = event.target.closest('tr');
      if (!row) return;

      const isEditing = row.classList.contains('editing');
      if (isEditing) {
        saveRowEdits(row, columns, type);
        return;
      }

      row.classList.add('editing');
      button.textContent = 'Save';

      const cells = Array.from(row.querySelectorAll('td')).slice(0, columns.length);
      cells.forEach((cell, index) => {
        const originalValue = cell.textContent.trim() === '—' ? '' : cell.textContent.trim();
        cell.innerHTML = `<input class="inline-input" type="text" value="${originalValue}" aria-label="${columns[index]}">`;
      });
    });
  });
}

function saveRowEdits(row, columns, type) {
  const index = Number(row.getAttribute('data-index'));
  const dataSource = type === 'tech' ? techniciansData : vehiclesData;
  const target = dataSource[index];
  if (!target) return;

  const inputs = Array.from(row.querySelectorAll('input.inline-input'));
  inputs.forEach((input, idx) => {
    target[columns[idx]] = input.value.trim();
  });

  row.classList.remove('editing');

  const renderFn = type === 'tech' ? renderTechnicianTable : renderVehicleTable;
  const searchId = type === 'tech' ? 'tech-search' : 'vehicle-search';
  renderFn(getFilteredData(dataSource, searchId));

  renderKpis(techniciansData, vehiclesData);
}
