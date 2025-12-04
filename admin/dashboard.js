const SOURCES = {
  vehicles: {
    label: 'Vehículos pendientes',
    path: '../assets/vehicles.csv',
    tableId: 'vehicles-table',
    statusId: 'vehicles-status',
    countId: 'vehicles-count',
    exportId: 'vehicles-export',
    refreshId: 'vehicles-refresh',
    addRowId: 'vehicles-add',
    replaceId: 'vehicles-replace',
    filename: 'vehicles.csv',
  },
  technicians: {
    label: 'Red de técnicos',
    path: '../assets/technicians.csv',
    tableId: 'technicians-table',
    statusId: 'technicians-status',
    countId: 'technicians-count',
    exportId: 'technicians-export',
    refreshId: 'technicians-refresh',
    addRowId: 'technicians-add',
    replaceId: 'technicians-replace',
    filename: 'technicians.csv',
  },
};

class CsvEditor {
  constructor(config) {
    this.config = config;
    this.headers = [];
    this.rows = [];
    this.dirty = false;
    this.table = document.getElementById(config.tableId);
    this.statusEl = document.getElementById(config.statusId);
    this.countEl = document.getElementById(config.countId);
    this.fileInput = this.createFilePicker(config.replaceId);
    this.wireControls();
    this.loadFromRemote();
  }

  wireControls() {
    const { addRowId, refreshId, exportId } = this.config;

    const addBtn = document.getElementById(addRowId);
    if (addBtn) {
      addBtn.addEventListener('click', () => this.addRow());
    }

    const refreshBtn = document.getElementById(refreshId);
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadFromRemote());
    }

    const exportBtn = document.getElementById(exportId);
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportCsv());
    }
  }

  createFilePicker(buttonId) {
    const trigger = document.getElementById(buttonId);
    if (!trigger) return null;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.style.display = 'none';
    trigger.insertAdjacentElement('afterend', input);

    trigger.addEventListener('click', () => input.click());
    input.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) {
        this.loadFromFile(file);
      }
      input.value = '';
    });

    return input;
  }

  async loadFromRemote() {
    this.setStatus('Cargando CSV…', 'info');
    try {
      const text = await fetchCsv(this.config.path);
      this.applyData(text);
      this.setStatus('CSV cargado desde assets', 'success');
      this.dirty = false;
    } catch (error) {
      console.error(`No se pudo cargar ${this.config.path}`, error);
      this.setStatus('Error al cargar el CSV', 'error');
      this.renderMessage('No se pudo leer el archivo.');
    }
  }

  loadFromFile(file) {
    this.setStatus('Leyendo archivo local…', 'info');
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result?.toString() ?? '';
      this.applyData(text);
      this.setStatus(`CSV reemplazado: ${file.name}`, 'success');
      this.dirty = true;
    };
    reader.onerror = () => {
      this.setStatus('No se pudo leer el archivo', 'error');
    };
    reader.readAsText(file);
  }

  applyData(text) {
    const { headers, rows } = parseCsv(text);
    this.headers = headers;
    this.rows = rows;
    this.renderTable();
  }

  renderTable() {
    if (!this.table) return;
    if (!this.headers.length) {
      this.renderMessage('El CSV no contiene columnas.');
      this.updateCount(0);
      return;
    }

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    this.headers.forEach((header) => {
      const th = document.createElement('th');
      th.textContent = header;
      headerRow.appendChild(th);
    });
    const actionsHeader = document.createElement('th');
    actionsHeader.className = 'row-actions';
    actionsHeader.textContent = 'Acciones';
    headerRow.appendChild(actionsHeader);
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');
    if (!this.rows.length) {
      const emptyRow = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = this.headers.length + 1;
      td.className = 'empty-state';
      td.textContent = 'Sin registros en el CSV.';
      emptyRow.appendChild(td);
      tbody.appendChild(emptyRow);
    } else {
      this.rows.forEach((row) => tbody.appendChild(this.renderRow(row)));
    }

    this.table.innerHTML = '';
    this.table.appendChild(thead);
    this.table.appendChild(tbody);
    this.updateCount(this.rows.length);
  }

  renderRow(row) {
    const tr = document.createElement('tr');
    this.headers.forEach((header, index) => {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.dataset.header = header;
      td.textContent = row[index] ?? '';
      td.addEventListener('input', () => this.markDirty());
      tr.appendChild(td);
    });
    const action = document.createElement('td');
    action.className = 'row-actions';
    action.innerHTML = '<button type="button" class="pill pill--subtle">Eliminar</button>';
    const removeBtn = action.querySelector('button');
    removeBtn.addEventListener('click', () => {
      tr.remove();
      this.syncRowsFromDom();
      this.markDirty();
    });
    tr.appendChild(action);
    return tr;
  }

  addRow() {
    if (!this.table || !this.headers.length) return;
    const tbody = this.table.querySelector('tbody') || document.createElement('tbody');
    const emptyState = tbody.querySelector('.empty-state');
    if (emptyState) emptyState.parentElement?.remove();
    const emptyRow = new Array(this.headers.length).fill('');
    const tr = this.renderRow(emptyRow);
    tbody.appendChild(tr);
    if (!this.table.contains(tbody)) this.table.appendChild(tbody);
    this.updateCount(tbody.querySelectorAll('tr').length);
    this.markDirty();
  }

  syncRowsFromDom() {
    const body = this.table?.querySelector('tbody');
    if (!body) return;
    const dataRows = Array.from(body.querySelectorAll('tr'));
    this.rows = dataRows.map((tr) =>
      this.headers.map((header) => tr.querySelector(`td[data-header="${CSS.escape(header)}"]`)?.textContent ?? '')
    );
    this.updateCount(this.rows.length);
  }

  markDirty() {
    this.dirty = true;
    this.setStatus('Cambios sin exportar', 'warning');
  }

  exportCsv() {
    if (!this.table || !this.headers.length) return;
    this.syncRowsFromDom();
    const csv = toCsv(this.headers, this.rows);
    downloadCsv(csv, this.config.filename);
    this.setStatus('CSV exportado', 'success');
    this.dirty = false;
  }

  renderMessage(message) {
    if (!this.table) return;
    this.table.innerHTML = `<tbody><tr><td class="empty-state" colspan="1">${message}</td></tr></tbody>`;
  }

  setStatus(message, variant = 'info') {
    if (!this.statusEl) return;
    this.statusEl.textContent = message;
    this.statusEl.className = `pill pill--${variant}`;
  }

  updateCount(total) {
    if (!this.countEl) return;
    this.countEl.textContent = `${total} fila${total === 1 ? '' : 's'}`;
  }
}

function parseCsv(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nonEmpty = lines.filter((line, index) => line.trim().length || index === 0);
  if (!nonEmpty.length || !nonEmpty[0].trim()) return { headers: [], rows: [] };

  const headers = splitCsvLine(nonEmpty[0]);
  const rows = nonEmpty.slice(1).filter(Boolean).map(splitCsvLine);
  return { headers, rows };
}

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (insideQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === ',' && !insideQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function toCsv(headers, rows) {
  const escapeCell = (cell = '') => {
    const needsQuotes = /[",\n\r]/.test(cell);
    const normalized = cell.replace(/"/g, '""');
    return needsQuotes ? `"${normalized}"` : normalized;
  };

  const lines = [headers.map(escapeCell).join(',')];
  rows.forEach((row) => lines.push(row.map(escapeCell).join(',')));
  return lines.join('\n');
}

async function fetchCsv(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`No se pudo obtener ${path}`);
  return response.text();
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
  Object.values(SOURCES).forEach((config) => {
    if (document.getElementById(config.tableId)) {
      new CsvEditor(config);
    }
  });
});
