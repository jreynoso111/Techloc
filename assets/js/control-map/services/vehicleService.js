export const createVehicleService = ({ client, tableName }) => {
  const VEHICLE_LIST_COLUMNS = [
    'id',
    '"Deal Status"',
    'deal_status',
    '"Vehicle Status"',
    'vehicle_status',
    '"Inventory Preparation Status"',
    'inventory_preparation_status',
    '"INV Prep Stat"',
    '"Inv. Prep. Stat."',
    '"Inv Prep Stat"',
    '"Physical Location"',
    'physical_location',
    '"Deal Completion"',
    '"Unit Type"',
    'type',
    '"Model Year"',
    'year',
    '"Model"',
    'model',
    '"VIN"',
    'vin',
    '"ShortVIN"',
    'shortvin',
    '"GPS Fix"',
    'gps_fix',
    '"GPS Fix Reason"',
    'gps_fix_reason',
    '"GPS Moving"',
    'gps_moving',
    '"Moving"',
    'moving',
    'movement_status_v2',
    'movement_days_stationary_v2',
    'movement_threshold_meters_v2',
    'movement_unit_type_v2',
    '"Moving (Calc)"',
    'moving_calc',
    '"PT Status"',
    'pt_status',
    '"PT Serial"',
    '"PT Serial "',
    'pt_serial',
    '"Winner Serial"',
    'winner_serial',
    '"Encore Serial"',
    'encore_serial',
    '"PT First Read"',
    '"PT First Read "',
    'pt_first_read',
    '"PT Last Read"',
    '"PT Last Read "',
    'pt_last_read',
    'days_stationary',
    '"Days Stationary"',
    '"Days stationary"',
    '"Days Parked"',
    '"Current Stock No"',
    'current_stock_no',
    '"Open Balance"',
    'open_balance',
    'short_location',
    '"Short Location"',
    '"State Loc"',
    '"State"',
    'state',
    'state_code',
    '"PT ZipCode"',
    '"Zip"',
    'zip',
    '"PT City"',
    '"City"',
    'city',
    '"Customer ID"',
    'customer_id',
    '"Customer Name"',
    'customer_name',
    '"Customer"',
    '"Borrower Name"',
    'borrower_name',
    '"Payment Schedule"',
    'payment',
    '"Lat"',
    'lat',
    '"Long"',
    'long',
    'lng',
    'updated_at'
  ].join(',');

  const listVehicles = async () => {
    if (!client?.from) {
      throw new Error('Vehicle data provider unavailable.');
    }
    const { data, error } = await client.from(tableName).select(VEHICLE_LIST_COLUMNS);
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
    const { data, error } = await client
      .from(tableName)
      .select(VEHICLE_LIST_COLUMNS)
      .eq('id', normalizedVehicleId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  };

  return { listVehicles, getVehicleById };
};
