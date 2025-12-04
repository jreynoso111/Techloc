const currentPage = window.location.pathname.split('/').pop();

async function loadCsv() {
  const endpoints = {
    'vehicles.html': { url: '/vehicles/csv', renderer: renderVehicleTable },
    'technicians.html': { url: '../assets/installers.csv', renderer: renderTechniciansTable },
  };

  const config = endpoints[currentPage];
  if (!config) return;

  try {
    const response = await fetch(config.url);
    if (!response.ok) throw new Error('No se pudo obtener el CSV');
    const text = await response.text();
    const rows = parseCsv(text);

    if (!rows.length) return;

    config.renderer(rows);
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

  const COMPANY = headers.indexOf('Installation Company');
  const NOTES = headers.indexOf('Notes');
  const STATE = headers.indexOf('State');
  const CITY = headers.indexOf('City');
  const ZIP = headers.indexOf('Zip');
  const EMAIL = headers.indexOf('Email');
  const PHONE = headers.indexOf('Phone');

  const rows = data.slice(0, 20).map((row) => {
    const name = row[COMPANY] || 'Sin nombre';
    const specialty = row[NOTES] || 'Instalador certificado';
    const status = row[STATE] || 'N/A';
    const statusClass = getStatusClass(status);
    const zone = [row[CITY], row[ZIP]].filter(Boolean).join(', ');
    const contact = [row[EMAIL], row[PHONE]].filter(Boolean).join(' • ');

    return `
      <tr class="hover:bg-slate-900/50 transition-colors">
        <td class="px-6 py-3 font-semibold text-white">${name}</td>
        <td class="px-6 py-3 text-slate-200">${specialty}</td>
        <td class="px-6 py-3 ${statusClass}">${status}</td>
        <td class="px-6 py-3 text-slate-200">${zone || '—'}</td>
        <td class="px-6 py-3 text-slate-400">${contact || 'No disponible'}</td>
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
