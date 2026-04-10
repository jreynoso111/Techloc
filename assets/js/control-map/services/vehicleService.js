export const createVehicleService = ({ client, tableName }) => {
  const VEHICLE_COLUMN_CANDIDATES = [
    ['id'],
    ['deal_status', 'Deal Status'],
    ['vehicle_status', 'Vehicle Status'],
    ['inventory_preparation_status', 'Inventory Preparation Status', 'INV Prep Stat', 'Inv. Prep. Stat.', 'Inv Prep Stat'],
    ['physical_location', 'Physical Location', 'phys_loc'],
    ['deal_completion', 'Deal Completion'],
    ['type', 'Unit Type'],
    ['year', 'Model Year'],
    ['model', 'Model'],
    ['vin', 'VIN'],
    ['shortvin', 'ShortVIN', 'Short Vin'],
    ['gps_fix', 'GPS Fix'],
    ['gps_fix_reason', 'GPS Fix Reason'],
    ['gps_moving', 'GPS Moving'],
    ['moving', 'Moving'],
    ['movement_status_v2'],
    ['movement_days_stationary_v2'],
    ['movement_threshold_meters_v2'],
    ['movement_unit_type_v2'],
    ['moving_calc', 'Moving (Calc)'],
    ['pt_status', 'PT Status'],
    ['pt_serial', 'PT Serial', 'PT Serial '],
    ['winner_serial', 'Winner Serial'],
    ['encore_serial', 'Encore Serial'],
    ['pt_first_read', 'PT First Read', 'PT First Read '],
    ['pt_last_read', 'PT Last Read', 'PT Last Read '],
    ['days_stationary', 'Days Stationary', 'Days stationary', 'Days Parked'],
    ['current_stock_no', 'Current Stock No', 'Stock No'],
    ['short_location', 'Short Location'],
    ['state', 'State', 'State Loc'],
    ['state_code'],
    ['zip', 'Zip', 'PT ZipCode'],
    ['city', 'City', 'PT City'],
    ['customer_id', 'Customer ID', 'Customer'],
    ['customer_name', 'Customer Name', 'Borrower Name'],
    ['borrower_name', 'Borrower Name'],
    ['payment', 'Payment Schedule'],
    ['lat', 'Lat'],
    ['long', 'Long'],
    ['lng', 'Lng'],
    ['updated_at']
  ];

  let resolvedVehicleColumnsPromise = null;

  const quoteColumn = (column = '') => {
    const normalized = `${column ?? ''}`.trim();
    if (!normalized) return '';
    if (/^[a-z_][a-z0-9_]*$/i.test(normalized)) return normalized;
    return `"${normalized.replace(/"/g, '""')}"`;
  };

  const normalizeName = (value = '') => `${value ?? ''}`.trim().toLowerCase();

  const resolveVehicleColumns = async () => {
    if (resolvedVehicleColumnsPromise) return resolvedVehicleColumnsPromise;
    resolvedVehicleColumnsPromise = (async () => {
      const probeResult = await client.from(tableName).select('*').limit(1);
      if (probeResult.error) throw probeResult.error;

      const firstRow = Array.isArray(probeResult.data) ? (probeResult.data[0] || {}) : {};
      const availableKeys = Object.keys(firstRow);
      if (!availableKeys.length) {
        return { selectClause: '*', columnsResolved: false };
      }

      const keyLookup = new Map(availableKeys.map((key) => [normalizeName(key), key]));
      const selectedColumns = [];
      VEHICLE_COLUMN_CANDIDATES.forEach((candidates) => {
        const hit = candidates.find((candidate) => keyLookup.has(normalizeName(candidate)));
        if (!hit) return;
        selectedColumns.push(quoteColumn(keyLookup.get(normalizeName(hit))));
      });

      const uniqueColumns = Array.from(new Set(selectedColumns.filter(Boolean)));
      return {
        selectClause: uniqueColumns.length ? uniqueColumns.join(',') : '*',
        columnsResolved: uniqueColumns.length > 0
      };
    })();
    return resolvedVehicleColumnsPromise;
  };

  const listVehicles = async () => {
    if (!client?.from) {
      throw new Error('Vehicle data provider unavailable.');
    }

    const { selectClause } = await resolveVehicleColumns();
    const { data, error } = await client.from(tableName).select(selectClause);
    if (error) throw error;
    return data || [];
  };

  const getVehicleById = async (vehicleId) => {
    if (!client?.from) {
      throw new Error('Vehicle data provider unavailable.');
    }

    const normalizedVehicleId = `${vehicleId ?? ''}`.trim();
    if (!normalizedVehicleId) {
      throw new Error('Vehicle id is required.');
    }

    const { selectClause } = await resolveVehicleColumns();
    const { data, error } = await client
      .from(tableName)
      .select(selectClause)
      .eq('id', normalizedVehicleId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  };

  return { listVehicles, getVehicleById };
};
