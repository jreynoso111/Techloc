create or replace function public.update_vehicle_gps_fields(
  p_vehicle_id uuid,
  p_gps_fix text,
  p_gps_fix_reason text
)
returns public.vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle public.vehicles;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  update public.vehicles
  set "gps fix" = p_gps_fix,
      "gps fix reason" = p_gps_fix_reason
  where id = p_vehicle_id
  returning * into v_vehicle;

  if not found then
    raise exception 'Vehicle not found.' using errcode = 'P0002';
  end if;

  return v_vehicle;
end;
$$;

revoke all on function public.update_vehicle_gps_fields(uuid, text, text) from public;
grant execute on function public.update_vehicle_gps_fields(uuid, text, text) to authenticated;
