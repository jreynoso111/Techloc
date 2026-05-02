grant usage on schema public to service_role;

grant select on table
  public."DealsJP1",
  public."Hotspots",
  public."PT-LastPing",
  public."Services",
  public."Services_Blacklist",
  public."Titles",
  public.admin_change_log,
  public.app_settings,
  public.control_map_vehicle_clicks,
  public.data_versions,
  public.gps_blacklist,
  public.profiles,
  public.repair_history,
  public.user_table_configs,
  public.vehicles
to service_role;

-- Pulse objects are intentionally not part of the TechLoc restore path, but
-- service_role can read them so old rows can be archived before removal.
grant select on table
  public.pulse_automations,
  public.pulse_board_items,
  public.pulse_boards,
  public.pulse_notifications,
  public.pulse_profiles,
  public.pulse_user_preferences,
  public.pulse_workspaces
to service_role;
