drop trigger if exists trg_refresh_vehicles_from_pt_lastping_legacy_insert on public."PT-LastPing";
drop trigger if exists trg_refresh_vehicles_from_pt_lastping_legacy_update on public."PT-LastPing";
drop trigger if exists trg_refresh_vehicles_from_pt_lastping_v2_insert on public."PT-LastPing";
drop trigger if exists trg_refresh_vehicles_from_pt_lastping_v2_update on public."PT-LastPing";
drop trigger if exists aaa_pt_lastping_keep_latest_8h_insert on public."PT-LastPing";
drop trigger if exists trg_pt_lastping_fill_city_bucket on public."PT-LastPing";
drop trigger if exists trigger_auto_update_location on public."PT-LastPing";
drop trigger if exists trigger_fill_ping_vehicle_id on public."PT-LastPing";
