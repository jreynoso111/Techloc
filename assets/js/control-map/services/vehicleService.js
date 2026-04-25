export const createVehicleService = ({ client, tableName }) => {
  const VEHICLE_SELECT_COLUMNS = [
    'id',
    'deal status',
    'Vehicle Status',
    'customer id',
    'unit type',
    'model year',
    'model',
    'VIN',
    'shortvin',
    'inv. prep. stat.',
    'deal completion',
    'gps fix',
    'gps fix reason',
    'pt status',
    'pt serial',
    'encore serial',
    'moving',
    'pt first read',
    'pt last read',
    'days_stationary',
    'short_location',
    'state loc',
    'pt city',
    'pt zipcode',
    'lat',
    'long',
    'phys_loc',
    'Current Stock No',
    'Open Balance',
    'movement_status_v2',
    'movement_days_stationary_v2',
    'movement_threshold_meters_v2',
    'movement_unit_type_v2',
    'movement_computed_at_v2'
  ];

  const DEFAULT_PAGE_SIZE = 1000;

  const quoteColumn = (column = '') => {
    const normalized = `${column ?? ''}`.trim();
    if (!normalized) return '';
    if (/^[a-z_][a-z0-9_]*$/i.test(normalized)) return normalized;
    return `"${normalized.replace(/"/g, '""')}"`;
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isTransientVehicleReadError = (error) => {
    const message = `${error?.message || ''}`.toLowerCase();
    const details = `${error?.details || ''}`.toLowerCase();
    return (
      message.includes('socket hang up')
      || message.includes('econnreset')
      || message.includes('timeout')
      || details.includes('socket hang up')
      || details.includes('econnreset')
    );
  };

  const getVehicleSelectClause = () => VEHICLE_SELECT_COLUMNS.map(quoteColumn).join(',');

  const listVehicles = async ({ pageSize = DEFAULT_PAGE_SIZE, maxRows = 25000 } = {}) => {
    if (!client?.from) {
      throw new Error('Vehicle data provider unavailable.');
    }

    const selectClause = getVehicleSelectClause();
    const safePageSize = Math.max(1, Math.min(Number(pageSize) || DEFAULT_PAGE_SIZE, 1000));
    const safeMaxRows = Math.max(safePageSize, Number(maxRows) || 25000);
    const rows = [];
    let offset = 0;

    while (offset < safeMaxRows) {
      const upper = Math.min(offset + safePageSize - 1, safeMaxRows - 1);
      const { data, error } = await client
        .from(tableName)
        .select(selectClause)
        .range(offset, upper);
      if (error) throw error;
      const pageRows = Array.isArray(data) ? data : [];
      if (!pageRows.length) break;
      rows.push(...pageRows);
      if (pageRows.length < safePageSize) break;
      offset += safePageSize;
    }

    return rows;
  };

  const getVehicleById = async (vehicleId) => {
    if (!client?.from) {
      throw new Error('Vehicle data provider unavailable.');
    }

    const normalizedVehicleId = `${vehicleId ?? ''}`.trim();
    if (!normalizedVehicleId) {
      throw new Error('Vehicle id is required.');
    }

    const selectClause = getVehicleSelectClause();
    const maxAttempts = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const { data, error } = await client
        .from(tableName)
        .select(selectClause)
        .eq('id', normalizedVehicleId)
        .maybeSingle();
      if (!error) return data || null;
      lastError = error;
      if (!isTransientVehicleReadError(error) || attempt === maxAttempts) {
        throw error;
      }
      await wait(150 * attempt);
    }

    throw lastError || new Error('Vehicle row lookup failed.');
  };

  return { listVehicles, getVehicleById, getVehicleSelectClause };
};
