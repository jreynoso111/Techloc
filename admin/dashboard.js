const currentPage = window.location.pathname.split('/').pop();

async function loadCsv() {
  try {
    const response = await fetch('../assets/vehicles.csv');
    if (!response.ok) throw new Error('No se pudo obtener el CSV');
    const text = await response.text();
    const rows = parseCsv(text);

    if (!rows.length) return;

    if (currentPage === 'vehicles.html') {
      renderVehicleTable(rows);
    } else if (currentPage === 'technicians.html') {
      renderTechniciansTable(rows);
    }
  } catch (error) {
    console.error('Error cargando el CSV:', error);
  }
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
      rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  if (current.length || row.length) {
    row.push(current.trim());
    rows.push(row);
  }

  return rows.filter((r) => r.length && r.some((cell) => cell !== ''));
}

function renderVehicleTable([headers, ...data]) {
  const tbody = document.querySelector('table tbody');
  if (!tbody) return;

  const DEAL_STATUS = headers.indexOf('Deal Status');
  const MODEL_YEAR = headers.indexOf('Model Year');
  const MODEL = headers.indexOf('Model');
  const VIN = headers.indexOf('ShortVIN');
  const PT_STATUS = headers.indexOf('PT Status');
  const LAST_READ = headers.indexOf('PT Last Read');

  const rows = data.map((row) => {
    const status = row[DEAL_STATUS] || '';
    const statusClass = getStatusClass(status);
    const model = `${row[MODEL_YEAR] || ''} ${row[MODEL] || ''}`.trim();

    return `
      <tr class="hover:bg-slate-900/50 transition-colors">
        <td class="px-6 py-3 font-semibold text-white">${row[VIN] || ''}</td>
        <td class="px-6 py-3 text-slate-200">${model}</td>
        <td class="px-6 py-3 ${statusClass}">${status || 'N/A'}</td>
        <td class="px-6 py-3 text-slate-200">${row[PT_STATUS] || 'Sin asignar'}</td>
        <td class="px-6 py-3 text-slate-400">${row[LAST_READ] || '—'}</td>
      </tr>
    `;
  });

  tbody.innerHTML = rows.join('');
}

function renderTechniciansTable([headers, ...data]) {
  const tbody = document.querySelector('table tbody');
  if (!tbody) return;

  const DEAL_STATUS = headers.indexOf('Deal Status');
  const UNIT_TYPE = headers.indexOf('Unit Type');
  const MODEL = headers.indexOf('Model');
  const PT_CITY = headers.indexOf('PT City');
  const STATE = headers.indexOf('State Loc');
  const PT_SERIAL = headers.indexOf('PT Serial ');

  const rows = data.slice(0, 20).map((row) => {
    const status = row[DEAL_STATUS] || '';
    const statusClass = getStatusClass(status);
    const zone = [row[PT_CITY], row[STATE]].filter(Boolean).join(', ');

    return `
      <tr class="hover:bg-slate-900/50 transition-colors">
        <td class="px-6 py-3 font-semibold text-white">${row[MODEL] || 'Sin nombre'}</td>
        <td class="px-6 py-3 text-slate-200">${row[UNIT_TYPE] || 'General'}</td>
        <td class="px-6 py-3 ${statusClass}">${status || 'N/A'}</td>
        <td class="px-6 py-3 text-slate-200">${zone || '—'}</td>
        <td class="px-6 py-3 text-slate-400">${row[PT_SERIAL] || 'No disponible'}</td>
      </tr>
    `;
  });

  tbody.innerHTML = rows.join('');
}

function getStatusClass(status = '') {
  const normalized = status.toLowerCase();
  if (normalized === 'active') return 'text-emerald-400 font-semibold';
  if (normalized === 'inactive') return 'text-red-400 font-semibold';
  return 'text-slate-200';
}

loadCsv();
