import { requireSession, redirectToAdminHome, supabaseClient } from './admin-auth.js';

const TABLE_NAME = 'gps_blacklist';
const KEY_CANDIDATES = ['id', 'uuid', 'serial', 'device_id', 'gps_id'];

const els = {
  statusPill: document.getElementById('status-pill'),
  totalCount: document.getElementById('total-count'),
  pkLabel: document.getElementById('pk-label'),
  lastSync: document.getElementById('last-sync'),
  headRow: document.getElementById('table-head-row'),
  body: document.getElementById('table-body'),
  feedback: document.getElementById('feedback'),
  refreshBtn: document.getElementById('refresh-btn'),
  addNewBtn: document.getElementById('add-new-btn'),
  modal: document.getElementById('row-modal'),
  modalTitle: document.getElementById('modal-title'),
  modalClose: document.getElementById('modal-close'),
  modalCancel: document.getElementById('modal-cancel'),
  modalSave: document.getElementById('modal-save'),
  rowForm: document.getElementById('row-form'),
};

const state = {
  rows: [],
  columns: [],
  primaryKey: null,
  editingKey: null,
};

const ADDED_AT_COL = 'added_at';

const setStatus = (message, tone = 'neutral') => {
  if (!els.statusPill) return;
  const toneClasses = {
    neutral: 'border-slate-700 bg-slate-900 text-slate-300',
    success: 'border-emerald-700/60 bg-emerald-900/50 text-emerald-200',
    error: 'border-red-700/60 bg-red-900/50 text-red-100',
  };

  els.statusPill.textContent = message;
  els.statusPill.className = `rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${toneClasses[tone] || toneClasses.neutral}`;
};

const setFeedback = (message, tone = 'neutral') => {
  if (!els.feedback) return;
  const toneClasses = {
    neutral: 'text-slate-300',
    success: 'text-emerald-300',
    error: 'text-red-300',
  };
  els.feedback.textContent = message;
  els.feedback.className = `min-h-5 text-xs ${toneClasses[tone] || toneClasses.neutral}`;
};

const detectPrimaryKey = (columns) => KEY_CANDIDATES.find((key) => columns.includes(key)) || null;

const getDisplayColumns = (rows) => {
  const merged = new Set();
  rows.forEach((row) => Object.keys(row || {}).forEach((key) => merged.add(key)));
  return [...merged];
};

const formatAddedAt = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${mm}/${dd}/${yy} [${hh}:${min}]`;
};

const isAddedAtColumn = (columnName) => String(columnName || '').toLowerCase() === ADDED_AT_COL;

const formatCell = (columnName, value) => {
  if (value === null || value === undefined || value === '') return '—';
  if (isAddedAtColumn(columnName)) return formatAddedAt(value);
  if (typeof value === 'object') return JSON.stringify(value);
  const valueText = String(value);
  return valueText.length > 80 ? `${valueText.slice(0, 77)}...` : valueText;
};

const renderHeader = () => {
  if (!els.headRow) return;
  const headers = state.columns
    .map(
      (col) =>
        `<th class="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-300">${col.toUpperCase()}</th>`,
    )
    .join('');
  els.headRow.innerHTML = `${headers}<th class="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-300">ACCIONES</th>`;
};

const renderTable = () => {
  renderHeader();
  if (!els.body) return;

  if (!state.rows.length) {
    els.body.innerHTML = `<tr><td colspan="${Math.max(state.columns.length + 1, 2)}" class="px-4 py-8 text-center text-slate-500 italic">No hay registros en ${TABLE_NAME}.</td></tr>`;
    return;
  }

  els.body.innerHTML = state.rows
    .map((row) => {
      const rowKey = state.primaryKey ? row[state.primaryKey] : '';
      const cells = state.columns
        .map((col) => `<td class="max-w-[260px] truncate px-3 py-2 text-slate-200" title="${String(row[col] ?? '')}">${formatCell(col, row[col])}</td>`)
        .join('');

      return `
        <tr class="hover:bg-slate-800/40">
          ${cells}
          <td class="px-3 py-2">
            <div class="flex justify-end gap-2">
              <button type="button" title="Editar" data-edit="${String(rowKey ?? '')}" class="h-7 w-7 rounded-md border border-blue-700/60 text-sm text-blue-200 hover:bg-blue-600/20">✎</button>
              <button type="button" title="Eliminar" data-delete="${String(rowKey ?? '')}" class="h-7 w-7 rounded-md border border-red-700/60 text-sm text-red-200 hover:bg-red-600/20">🗑</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
};

const updateCounters = () => {
  if (els.totalCount) els.totalCount.textContent = String(state.rows.length);
  if (els.pkLabel) els.pkLabel.textContent = state.primaryKey || 'Not found';
  if (els.lastSync) els.lastSync.textContent = new Date().toLocaleString();
};

const openModal = (title, row = null) => {
  state.editingKey = row && state.primaryKey ? row[state.primaryKey] : null;
  els.modalTitle.textContent = title;
  els.rowForm.innerHTML = '';

  const editableColumns = state.columns.filter((col) => col !== state.primaryKey && !isAddedAtColumn(col));

  editableColumns.forEach((col) => {
    const value = row?.[col] ?? '';
    const fieldId = `field-${col}`;
    const inputType = typeof value === 'number' ? 'number' : 'text';
    els.rowForm.insertAdjacentHTML(
      'beforeend',
      `
      <label class="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-300" for="${fieldId}">
        <span>${col}</span>
        <input id="${fieldId}" data-field="${col}" type="${inputType}" value="${String(value).replaceAll('"', '&quot;')}" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none" />
      </label>
      `,
    );
  });

  els.modal.classList.remove('hidden');
  els.modal.classList.add('flex');
};

const closeModal = () => {
  state.editingKey = null;
  els.modal.classList.add('hidden');
  els.modal.classList.remove('flex');
};

const buildPayloadFromForm = () => {
  const payload = {};
  els.rowForm.querySelectorAll('[data-field]').forEach((input) => {
    const field = input.dataset.field;
    const raw = input.value;
    payload[field] = raw === '' ? null : raw;
  });
  return payload;
};

const saveModalRecord = async () => {
  const payload = buildPayloadFromForm();
  setStatus('Guardando…');

  if (state.editingKey !== null && state.primaryKey) {
    const { error } = await supabaseClient.from(TABLE_NAME).update(payload).eq(state.primaryKey, state.editingKey);
    if (error) {
      setStatus('Error al actualizar', 'error');
      setFeedback(error.message || 'No fue posible actualizar.', 'error');
      return;
    }
    setFeedback('Registro actualizado correctamente.', 'success');
  } else {
    const { error } = await supabaseClient.from(TABLE_NAME).insert([payload]);
    if (error) {
      setStatus('Error al insertar', 'error');
      setFeedback(error.message || 'No fue posible insertar.', 'error');
      return;
    }
    setFeedback('Registro insertado correctamente.', 'success');
  }

  closeModal();
  await fetchRows();
};

const fetchRows = async () => {
  setStatus('Cargando…');
  const { data, error } = await supabaseClient.from(TABLE_NAME).select('*').limit(500);

  if (error) {
    console.error(`Error loading ${TABLE_NAME}`, error);
    setStatus('Error al cargar', 'error');
    setFeedback(error.message || 'No fue posible consultar la tabla.', 'error');
    return;
  }

  state.rows = data || [];
  state.columns = getDisplayColumns(state.rows);
  state.primaryKey = detectPrimaryKey(state.columns);

  renderTable();
  updateCounters();
  setStatus(`Tabla ${TABLE_NAME} lista`, 'success');
  setFeedback(`Se cargaron ${state.rows.length} registros.`, 'success');
};

const validateAdminRole = async (session) => {
  const userId = session?.user?.id;
  if (!userId) return false;

  const { data, error } = await supabaseClient.from('profiles').select('role').eq('id', userId).single();
  if (error) {
    console.error('Unable to validate role for GPS blacklist page', error);
    return false;
  }

  return String(data?.role || '').toLowerCase() === 'administrator';
};

const handleRowActions = async (event) => {
  const editValue = event.target.closest('[data-edit]')?.dataset.edit;
  const deleteValue = event.target.closest('[data-delete]')?.dataset.delete;

  if (editValue !== undefined) {
    const row = state.rows.find((entry) => String(entry[state.primaryKey]) === String(editValue));
    if (!row) return;
    openModal('Editar registro', row);
    return;
  }

  if (deleteValue !== undefined) {
    if (!window.confirm(`¿Eliminar ${state.primaryKey}=${deleteValue}?`)) return;

    setStatus('Eliminando…');
    const { error } = await supabaseClient.from(TABLE_NAME).delete().eq(state.primaryKey, deleteValue);
    if (error) {
      setStatus('Error al eliminar', 'error');
      setFeedback(error.message || 'No fue posible eliminar.', 'error');
      return;
    }

    setFeedback('Registro eliminado correctamente.', 'success');
    await fetchRows();
  }
};

const initialize = async () => {
  try {
    const session = await requireSession();
    const isAdmin = await validateAdminRole(session);

    if (!isAdmin) {
      redirectToAdminHome();
      return;
    }

    els.refreshBtn?.addEventListener('click', fetchRows);
    els.addNewBtn?.addEventListener('click', () => openModal('Nuevo registro'));
    els.modalClose?.addEventListener('click', closeModal);
    els.modalCancel?.addEventListener('click', closeModal);
    els.modalSave?.addEventListener('click', () => {
      saveModalRecord().catch((error) => {
        console.error('Save failed', error);
        setFeedback('No fue posible guardar el registro.', 'error');
      });
    });

    els.body?.addEventListener('click', (event) => {
      handleRowActions(event).catch((error) => {
        console.error('Row action failed', error);
        setFeedback('No fue posible completar la acción.', 'error');
      });
    });

    await fetchRows();
    window.lucide?.createIcons();
  } catch (error) {
    console.error('GPS blacklist admin initialization failed', error);
    setStatus('Error de sesión', 'error');
  }
};

initialize();
