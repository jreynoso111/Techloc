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
  rowJson: document.getElementById('row-json'),
  formMode: document.getElementById('form-mode'),
  feedback: document.getElementById('feedback'),
  refreshBtn: document.getElementById('refresh-btn'),
  saveBtn: document.getElementById('save-btn'),
  newBtn: document.getElementById('new-btn'),
};

const state = {
  rows: [],
  columns: [],
  primaryKey: null,
  editingKey: null,
};

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
  if (!rows.length) return [];
  const merged = new Set();
  rows.forEach((row) => Object.keys(row || {}).forEach((key) => merged.add(key)));
  return [...merged];
};

const formatCell = (value) => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  const stringValue = String(value);
  return stringValue.length > 60 ? `${stringValue.slice(0, 57)}...` : stringValue;
};

const renderHeader = () => {
  if (!els.headRow) return;
  const selectedColumns = state.columns.slice(0, 6);
  const headers = selectedColumns
    .map(
      (col) =>
        `<th class="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-300">${col}</th>`,
    )
    .join('');
  els.headRow.innerHTML = `${headers}<th class="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-300">Actions</th>`;
};

const renderTable = () => {
  renderHeader();
  if (!els.body) return;

  if (!state.rows.length) {
    els.body.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500 italic">No hay registros en gps_blacklist.</td></tr>';
    return;
  }

  const visibleColumns = state.columns.slice(0, 6);

  els.body.innerHTML = state.rows
    .map((row) => {
      const keyValue = state.primaryKey ? row[state.primaryKey] : null;
      const cells = visibleColumns
        .map(
          (col) =>
            `<td class="max-w-[220px] truncate px-3 py-2 text-slate-200" title="${String(row[col] ?? '')}">${formatCell(row[col])}</td>`,
        )
        .join('');

      const disabledDelete = keyValue === null || keyValue === undefined ? 'disabled opacity-40 cursor-not-allowed' : '';

      return `
        <tr class="hover:bg-slate-800/40">
          ${cells}
          <td class="px-3 py-2">
            <div class="flex justify-end gap-2">
              <button type="button" data-edit="${state.primaryKey ? String(keyValue ?? '') : ''}" class="rounded-md border border-blue-700/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-200 hover:bg-blue-600/20">Edit</button>
              <button type="button" data-delete="${state.primaryKey ? String(keyValue ?? '') : ''}" class="rounded-md border border-red-700/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-200 hover:bg-red-600/20 ${disabledDelete}">Delete</button>
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

const resetEditor = () => {
  state.editingKey = null;
  if (els.formMode) els.formMode.textContent = 'Modo: crear nuevo';
  if (els.rowJson) {
    els.rowJson.value = '{\n  "serial": "",\n  "reason": ""\n}';
  }
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

const handleSave = async () => {
  let payload;
  try {
    payload = JSON.parse(els.rowJson.value || '{}');
  } catch (error) {
    setFeedback('JSON inválido. Corrige el formato antes de guardar.', 'error');
    return;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    setFeedback('El payload debe ser un objeto JSON.', 'error');
    return;
  }

  setStatus('Guardando…');

  if (state.editingKey !== null && state.primaryKey) {
    const updatePayload = { ...payload };
    delete updatePayload[state.primaryKey];

    const { error } = await supabaseClient.from(TABLE_NAME).update(updatePayload).eq(state.primaryKey, state.editingKey);
    if (error) {
      setStatus('Error al actualizar', 'error');
      setFeedback(error.message || 'No fue posible actualizar el registro.', 'error');
      return;
    }

    setFeedback('Registro actualizado correctamente.', 'success');
  } else {
    const { error } = await supabaseClient.from(TABLE_NAME).insert([payload]);
    if (error) {
      setStatus('Error al insertar', 'error');
      setFeedback(error.message || 'No fue posible insertar el registro.', 'error');
      return;
    }

    setFeedback('Registro insertado correctamente.', 'success');
  }

  resetEditor();
  await fetchRows();
};

const handleRowActions = async (event) => {
  const editValue = event.target.closest('[data-edit]')?.dataset.edit;
  const deleteValue = event.target.closest('[data-delete]')?.dataset.delete;

  if (editValue !== undefined) {
    if (!state.primaryKey) {
      setFeedback('No se detectó columna llave para editar.', 'error');
      return;
    }

    const row = state.rows.find((entry) => String(entry[state.primaryKey]) === String(editValue));
    if (!row) return;

    state.editingKey = row[state.primaryKey];
    els.rowJson.value = JSON.stringify(row, null, 2);
    els.formMode.textContent = `Modo: editando ${state.primaryKey}=${String(state.editingKey)}`;
    setFeedback('Registro cargado en el editor.', 'neutral');
    return;
  }

  if (deleteValue !== undefined) {
    if (!state.primaryKey) {
      setFeedback('No se detectó columna llave para eliminar.', 'error');
      return;
    }

    if (!window.confirm(`¿Eliminar ${state.primaryKey}=${deleteValue}?`)) return;

    setStatus('Eliminando…');
    const { error } = await supabaseClient.from(TABLE_NAME).delete().eq(state.primaryKey, deleteValue);
    if (error) {
      setStatus('Error al eliminar', 'error');
      setFeedback(error.message || 'No fue posible eliminar el registro.', 'error');
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
    els.saveBtn?.addEventListener('click', handleSave);
    els.newBtn?.addEventListener('click', () => {
      resetEditor();
      setFeedback('Editor reiniciado para nuevo registro.', 'neutral');
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
