const dashboardConfigs = {
  'vehicles.html': {
    csv: '../assets/vehicles.csv',
    tableSelector: '#vehicles-table',
    emptyMessage: 'No hay vehículos registrados.',
  },
  'technicians.html': {
    csv: '../assets/installers.csv',
    tableSelector: '#technicians-table',
    emptyMessage: 'No hay técnicos registrados.',
  },
};

document.addEventListener('DOMContentLoaded', () => {
  const currentPage = getCurrentPage();
  const config = dashboardConfigs[currentPage];

  if (!config) return;

  loadAndRenderDashboard(config);
});

function getCurrentPage() {
  return window.location.pathname.split('/').pop();
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
    console.error('Error cargando el CSV:', error);
    renderEmptyState(config.tableSelector, 'No se pudo cargar la tabla.', 1);
  }
}

async function fetchCsv(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo obtener el CSV desde ${url}`);
  return response.text();
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
      renderEmptyState(selector, 'Sin registros para mostrar.', headers.length);
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
  if (normalized === 'active' || normalized === 'activo') return 'text-emerald-400 font-semibold';
  if (normalized === 'inactive' || normalized === 'inactivo') return 'text-red-400 font-semibold';
  return 'text-slate-200';
}
