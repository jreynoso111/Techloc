create or replace function public.resolve_vehicle_winner_serial_v2(
  p_vin text,
  p_now timestamp with time zone default now()
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_shortvin text;
  v_winner_serial text;
begin
  if p_vin is null or trim(p_vin) = '' then
    return '';
  end if;

  v_shortvin := right(
    regexp_replace(upper(trim(p_vin)), '[^A-Z0-9]', '', 'g'),
    6
  );

  if length(coalesce(v_shortvin, '')) <> 6 then
    return '';
  end if;

  select trim(coalesce(p."Serial", '')) as serial
  into v_winner_serial
  from public."PT-LastPing" p
  where right(
      regexp_replace(upper(trim(coalesce(p."VIN", ''))), '[^A-Z0-9]', '', 'g'),
      6
    ) = v_shortvin
    and trim(coalesce(p."Serial", '')) <> ''
    and not public.is_gps_serial_blacklisted_now_v2(p."Serial", p_now)
  order by p."Date" desc nulls last, p.id desc nulls last
  limit 1;

  return coalesce(v_winner_serial, '');
end;
$function$;

create or replace function public.refresh_vehicle_movement_v2_batch(
  p_vins text[] default null::text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated integer := 0;
  v_targeted integer := 0;
begin
  with settings as (
    select public.get_control_map_settings_v2() as settings
  ), target_vin6 as (
    select distinct right(
      regexp_replace(upper(trim(vin)), '[^A-Z0-9]', '', 'g'),
      6
    ) as shortvin
    from unnest(coalesce(p_vins, array[]::text[])) as vin
    where trim(coalesce(vin, '')) <> ''
  ), target_vehicles as (
    select
      v."VIN",
      v.shortvin,
      public.resolve_vehicle_unit_type_for_vin_v2(v."VIN") as unit_type,
      public.get_vehicle_movement_threshold_meters_v2(v."VIN") as threshold_meters,
      coalesce((s.settings ->> 'vehicleMarkerStalePingDays')::integer, 3) as stale_days
    from public.vehicles v
    cross join settings s
    where (p_vins is null or array_length(p_vins, 1) is null)
       or exists (select 1 from target_vin6 tv6 where tv6.shortvin = v.shortvin)
  ), valid_pings as (
    select
      tv."VIN" as vehicle_vin,
      tv.shortvin,
      trim(coalesce(p."Serial", '')) as serial,
      p.id,
      p."Date",
      p."Lat",
      p."Long",
      p.address,
      p.moved_v2,
      p.days_stationary_v2
    from target_vehicles tv
    join public."PT-LastPing" p
      on right(
          regexp_replace(upper(trim(coalesce(p."VIN", ''))), '[^A-Z0-9]', '', 'g'),
          6
        ) = tv.shortvin
    left join public.gps_blacklist b
      on b.is_active is distinct from false
     and trim(coalesce(b.serial, '')) = trim(coalesce(p."Serial", ''))
     and (
       b.effective_from is null
       or b.effective_from <= (now() at time zone 'utc')::date
     )
    where trim(coalesce(p."Serial", '')) <> ''
      and b.serial is null
  ), latest_rows as (
    select distinct on (vp.shortvin)
      vp.vehicle_vin,
      vp.shortvin,
      vp.serial as winner_serial,
      vp.id,
      vp."Date" as pt_last_read,
      vp."Lat" as lat,
      vp."Long" as long,
      vp.address as short_location,
      coalesce(
        vp.moved_v2,
        public.compute_pt_lastping_moved_v2(vp.vehicle_vin, vp.serial, vp."Date", vp."Lat", vp."Long", vp.id)
      ) as latest_moved_v2,
      vp.days_stationary_v2
    from valid_pings vp
    order by vp.shortvin, vp."Date" desc nulls last, vp.id desc nulls last
  ), first_rows as (
    select distinct on (vp.shortvin)
      vp.shortvin,
      vp."Date" as pt_first_read
    from valid_pings vp
    join latest_rows lr
      on lr.shortvin = vp.shortvin
     and lr.winner_serial = vp.serial
    order by vp.shortvin, vp."Date" asc nulls last, vp.id asc nulls last
  ), payload as (
    select
      tv."VIN",
      tv.shortvin,
      lr.winner_serial,
      fr.pt_first_read,
      lr.pt_last_read,
      lr.lat,
      lr.long,
      lr.short_location,
      tv.unit_type,
      tv.threshold_meters,
      case
        when lr.winner_serial is null or lr.winner_serial = '' then 'unknown'
        when lr.pt_last_read is null then 'unknown'
        when lr.pt_last_read < (now() - make_interval(days => greatest(0, tv.stale_days))) then 'unknown'
        when coalesce(lr.latest_moved_v2, -1) = 1 then 'moving'
        else 'stopped'
      end as movement_status_v2,
      case
        when lr.winner_serial is null or lr.winner_serial = '' then null
        when lr.pt_last_read is null then null
        when lr.pt_last_read < (now() - make_interval(days => greatest(0, tv.stale_days))) then null
        when coalesce(lr.latest_moved_v2, -1) = 1 then 0
        when lr.days_stationary_v2 is not null then lr.days_stationary_v2
        when fr.pt_first_read is not null then greatest(0, floor(extract(epoch from (lr.pt_last_read - fr.pt_first_read)) / 86400)::int)
        else 0
      end as movement_days_stationary_v2
    from target_vehicles tv
    left join latest_rows lr on lr.shortvin = tv.shortvin
    left join first_rows fr on fr.shortvin = tv.shortvin
  ), normalized_payload as (
    select
      p.*,
      case
        when p.movement_status_v2 = 'moving' then 1::bigint
        when p.movement_status_v2 = 'stopped' then -1::bigint
        else null::bigint
      end as moving_legacy
    from payload p
  )
  update public.vehicles v
  set "pt serial" = p.winner_serial,
      "pt first read" = p.pt_first_read,
      "pt last read" = p.pt_last_read,
      lat = p.lat,
      long = p.long,
      short_location = p.short_location,
      moving = p.moving_legacy,
      days_stationary = p.movement_days_stationary_v2,
      movement_status_v2 = p.movement_status_v2,
      movement_days_stationary_v2 = p.movement_days_stationary_v2,
      movement_computed_at_v2 = timezone('utc', now()),
      movement_threshold_meters_v2 = p.threshold_meters,
      movement_unit_type_v2 = p.unit_type
  from normalized_payload p
  where v.shortvin = p.shortvin
    and (
      v."pt serial" is distinct from p.winner_serial
      or v."pt first read" is distinct from p.pt_first_read
      or v."pt last read" is distinct from p.pt_last_read
      or v.lat is distinct from p.lat
      or v.long is distinct from p.long
      or v.short_location is distinct from p.short_location
      or v.moving is distinct from p.moving_legacy
      or v.days_stationary is distinct from p.movement_days_stationary_v2
      or v.movement_status_v2 is distinct from p.movement_status_v2
      or v.movement_days_stationary_v2 is distinct from p.movement_days_stationary_v2
      or v.movement_threshold_meters_v2 is distinct from p.threshold_meters
      or v.movement_unit_type_v2 is distinct from p.unit_type
      or v.movement_computed_at_v2 is null
    );

  get diagnostics v_updated = row_count;

  select count(*) into v_targeted
  from public.vehicles v
  where p_vins is null
     or array_length(p_vins, 1) is null
     or exists (
        select 1
        from unnest(p_vins) as vin
        where right(
            regexp_replace(upper(trim(coalesce(vin, ''))), '[^A-Z0-9]', '', 'g'),
            6
          ) = v.shortvin
     );

  return jsonb_build_object('updated_vehicles', v_updated, 'targeted_vehicles', v_targeted);
end;
$function$;

create or replace function public.refresh_vehicle_movement_v2(p_vin text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_vin is null or trim(p_vin) = '' then
    return;
  end if;

  perform public.refresh_vehicle_movement_v2_batch(array[p_vin]);
end;
$function$;

create or replace function public.refresh_vehicle_from_pt_lastping_legacy(p_vin text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_vin is null or trim(p_vin) = '' then
    return;
  end if;

  perform public.refresh_vehicle_movement_v2_batch(array[p_vin]);
end;
$function$;

create or replace function public.refresh_all_vehicle_movement_v2()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_batch_result jsonb := '{}'::jsonb;
begin
  v_batch_result := public.refresh_vehicle_movement_v2_batch(null::text[]);
  return coalesce((v_batch_result ->> 'targeted_vehicles')::integer, 0);
end;
$function$;

create or replace function public.finalize_pt_lastping_upload(
  p_vins text[] default null::text[],
  p_min_id_exclusive bigint default null::bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated_rows integer := 0;
  v_batch_result jsonb := '{}'::jsonb;
begin
  v_batch_result := public.refresh_vehicle_movement_v2_batch(p_vins);

  update public.vehicles
  set movement_days_stationary_v2 = null,
      days_stationary = null,
      moving = null,
      movement_computed_at_v2 = timezone('utc', now())
  where movement_status_v2 = 'unknown'
    and (
      movement_days_stationary_v2 is not null
      or days_stationary is not null
      or moving is not null
    );

  return jsonb_build_object(
    'updated_rows', v_updated_rows,
    'processed_vins', coalesce((v_batch_result ->> 'targeted_vehicles')::integer, 0),
    'updated_vehicles', coalesce((v_batch_result ->> 'updated_vehicles')::integer, 0)
  );
end;
$function$;
