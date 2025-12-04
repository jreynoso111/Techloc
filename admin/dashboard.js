const currentPage = window.location.pathname.split('/').pop();

async function loadCsv() {
  const endpoints = {
    'vehicles.html': { url: '/vehicles/csv', renderer: renderFullTable },
    'technicians.html': { url: '../assets/installers.csv', renderer: renderFullTable },
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

function renderFullTable([headers, ...data]) {
  const table = document.querySelector('table');
  if (!table || !headers) return;

  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  if (thead) {
    thead.innerHTML = `
      <tr>
        ${headers.map((header) => `<th class="px-6 py-3 text-left font-semibold">${header || '—'}</th>`).join('')}
      </tr>
    `;
  }

  if (tbody) {
    const rows = data.map((row) => {
      const cells = headers
        .map((header, index) => {
          const value = row[index] || '';
          const displayValue = value || '—';
          const isStatus = header?.trim().toLowerCase() === 'status';
          const baseClass = 'px-6 py-3';
          const textClass = isStatus ? getStatusClass(value) : 'text-slate-200';

          return `<td class="${baseClass} ${textClass}">${displayValue}</td>`;
        })
        .join('');

      return `<tr class="hover:bg-slate-900/50 transition-colors">${cells}</tr>`;
    });

    tbody.innerHTML = rows.join('');
  }
}

function getStatusClass(status = '') {
  const normalized = status.toLowerCase();
  if (normalized === 'active') return 'text-emerald-400 font-semibold';
  if (normalized === 'inactive') return 'text-red-400 font-semibold';
  return 'text-slate-200';
}

loadCsv();
