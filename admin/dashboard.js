const sources = {
  vehicles: {
    path: '../assets/vehicles.csv',
    tableId: 'vehicles-table',
    exportId: 'vehicles-export',
    refreshId: 'vehicles-refresh',
    filename: 'vehicles-updated.csv',
  },
  technicians: {
    path: '../assets/technicians.csv',
    tableId: 'technicians-table',
    exportId: 'technicians-export',
    refreshId: 'technicians-refresh',
    filename: 'technicians-updated.csv',
  },
};

document.addEventListener('DOMContentLoaded', () => {
  Object.values(sources).forEach((source) => {
    attachExportHandler(source);
    attachRefreshHandler(source);
    loadTable(source);
  });
});

async function loadTable({ path, tableId }) {
  const table = document.getElementById(tableId);
  if (!table) return;

  try {
    const csvText = await fetchCsv(path);
    const { headers, rows } = parseCsv(csvText);

    if (!headers.length) {
      table.innerHTML = `<tbody><tr><td class="empty-state">No se encontraron columnas en ${path}</td></tr></tbody>`;
      return;
    }

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headers.forEach((header) => {
      const th = document.createElement('th');
      th.textContent = header;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    if (!rows.length) {
      const emptyRow = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = headers.length;
      cell.className = 'empty-state';
      cell.textContent = 'El CSV está vacío.';
      emptyRow.appendChild(cell);
      tbody.appendChild(emptyRow);
    } else {
      rows.forEach((row) => {
        const tr = document.createElement('tr');
        headers.forEach((header, index) => {
          const td = document.createElement('td');
          td.contentEditable = 'true';
          td.dataset.header = header;
          td.textContent = row[index] ?? '';
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    table.innerHTML = '';
    table.appendChild(thead);
    table.appendChild(tbody);
  } catch (error) {
    console.error('Error al cargar CSV', error);
    table.innerHTML = `<tbody><tr><td class="empty-state">No se pudo cargar ${path}</td></tr></tbody>`;
  }
}

function attachExportHandler({ tableId, exportId, filename }) {
  const button = document.getElementById(exportId);
  if (!button) return;
  button.addEventListener('click', () => {
    const table = document.getElementById(tableId);
    if (!table) return;

    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent || '');
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? '')
    );

    const csv = toCsv(headers, rows);
    downloadCsv(csv, filename);
  });
}

function attachRefreshHandler(source) {
  const button = document.getElementById(source.refreshId);
  if (!button) return;
  button.addEventListener('click', () => loadTable(source));
}

function toCsv(headers, rows) {
  const escapeCell = (cell = '') => {
    const needsQuotes = [',', '\n', '\r', '"'].some((char) => cell.includes(char));
    const sanitized = cell.replace(/"/g, '""');
    return needsQuotes ? `"${sanitized}"` : sanitized;
  };

  const lines = [headers.map(escapeCell).join(',')];
  rows.forEach((row) => lines.push(row.map(escapeCell).join(',')));
  return lines.join('\n');
}

async function fetchCsv(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`No se pudo obtener ${path}`);
  }
  return response.text();
}

function parseCsv(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim().length);
  if (!lines.length) return { headers: [], rows: [] };

  const headers = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map(splitCsvLine);
  return { headers, rows };
}

function splitCsvLine(line) {
  const result = [];
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
    } else if (char === ',' && !insideQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
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
