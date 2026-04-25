-- Performance hardening for vehicle/GPS scale.
--
-- Existing coverage observed before this migration:
-- - public.vehicles.id is already covered by vehicles_id_unique.
-- - public."DealsJP1"("Current Stock No") is already covered by two unique indexes.
-- - public."PT-LastPing"("Serial", "Date" desc) already exists.
--
-- This migration adds missing lookup paths and replaces repeated VIN suffix
-- expressions in hot SQL functions with stored generated vin6 columns.

alter table public."PT-LastPing"
  add column if not exists vin6 text generated always as (
    right(regexp_replace(upper(trim(coalesce("VIN", ''))), '[^A-Z0-9]', '', 'g'), 6)
  ) stored;

alter table public."DealsJP1"
  add column if not exists vin6 text generated always as (
    right(regexp_replace(upper(trim(coalesce("VIN", ''))), '[^A-Z0-9]', '', 'g'), 6)
  ) stored;

alter table public.repair_history
  add column if not exists vin6 text generated always as (
    right(
      regexp_replace(
        upper(trim(coalesce(nullif("VIN", ''), nullif(shortvin, ''), ''))),
        '[^A-Z0-9]',
        '',
        'g'
      ),
      6
    )
  ) stored;

create index if not exists idx_vehicles_shortvin
  on public.vehicles (shortvin)
  where shortvin is not null and trim(shortvin) <> '';

create index if not exists idx_pt_lastping_vehicle_id_date_desc
  on public."PT-LastPing" (vehicle_id, "Date" desc, id desc)
  where vehicle_id is not null and "Date" is not null;

create index if not exists idx_pt_lastping_vin6_date_desc_col
  on public."PT-LastPing" (vin6, "Date" desc, id desc)
  where vin6 is not null and vin6 <> '' and "Date" is not null;

create index if not exists idx_pt_lastping_vin6_serial_date_desc_col
  on public."PT-LastPing" (vin6, "Serial", "Date" desc, id desc)
  where vin6 is not null
    and vin6 <> ''
    and "Serial" is not null
    and trim("Serial") <> ''
    and "Date" is not null;

create index if not exists idx_dealsjp1_vin6_last_deal_id
  on public."DealsJP1" (vin6, "Last Deal" desc, id desc)
  where vin6 is not null and vin6 <> '';

create index if not exists idx_gps_blacklist_serial_active_effective
  on public.gps_blacklist (serial, is_active, effective_from)
  where serial is not null and trim(serial) <> '';

create index if not exists idx_repair_history_vin_created_at
  on public.repair_history ("VIN", created_at desc)
  where "VIN" is not null and trim("VIN") <> '';

create index if not exists idx_repair_history_shortvin_created_at
  on public.repair_history (shortvin, created_at desc)
  where shortvin is not null and trim(shortvin) <> '';

create index if not exists idx_repair_history_vin6_created_at
  on public.repair_history (vin6, created_at desc)
  where vin6 is not null and vin6 <> '';

create index if not exists idx_services_category_state_city
  on public."Services" (category, state, city);

create index if not exists idx_hotspots_state_city_zip
  on public."Hotspots" ("State", "City", "Zip");

create index if not exists idx_services_blacklist_category_state_city
  on public."Services_Blacklist" (category, "State", "City");

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
  where p.vin6 = v_shortvin
    and trim(coalesce(p."Serial", '')) <> ''
    and not public.is_gps_serial_blacklisted_now_v2(p."Serial", p_now)
  order by p."Date" desc nulls last, p.id desc nulls last
  limit 1;

  return coalesce(v_winner_serial, '');
end;
$function$;

create or replace function public.resolve_vehicle_unit_type_for_vin_v2(p_vin text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_last6 text;
  v_unit_type text;
begin
  v_last6 := right(regexp_replace(upper(coalesce(trim(p_vin), '')), '[^A-Z0-9]', '', 'g'), 6);
  if v_last6 is null or length(v_last6) <> 6 then
    return null;
  end if;

  select trim(d."Unit Type")
  into v_unit_type
  from public."DealsJP1" d
  where d.vin6 = v_last6
  order by coalesce(d."Last Deal", false) desc, d.id desc
  limit 1;

  return nullif(v_unit_type, '');
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
      on p.vin6 = tv.shortvin
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

create or replace function public.sync_vehicles_from_dealsjp1_lastdeal()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  upserted_count bigint := 0;
  deleted_count bigint := 0;
begin
  perform public.require_active_administrator_for_client();

  with allowed_stock as (
    select trim(upper(coalesce(d."Current Stock No", ''))) as stock_key
    from public."DealsJP1" d
    where coalesce(d."Last Deal", false) is true
      and upper(trim(coalesce(d."Vehicle Status", ''))) in ('ACTIVE', 'STOCK', 'STOLEN')
      and d."Current Stock No" is not null
      and trim(d."Current Stock No") <> ''
  ),
  removable as (
    select v.id
    from public.vehicles v
    where not exists (
      select 1
      from allowed_stock a
      where a.stock_key = trim(upper(coalesce(v."Current Stock No", '')))
    )
  )
  update public."PT-LastPing" p
  set vehicle_id = null
  where p.vehicle_id in (select id from removable);

  with allowed_stock as (
    select trim(upper(coalesce(d."Current Stock No", ''))) as stock_key
    from public."DealsJP1" d
    where coalesce(d."Last Deal", false) is true
      and upper(trim(coalesce(d."Vehicle Status", ''))) in ('ACTIVE', 'STOCK', 'STOLEN')
      and d."Current Stock No" is not null
      and trim(d."Current Stock No") <> ''
  ),
  removable as (
    select v.id
    from public.vehicles v
    where not exists (
      select 1
      from allowed_stock a
      where a.stock_key = trim(upper(coalesce(v."Current Stock No", '')))
    )
  )
  update public.repair_history r
  set vehicle_id = null
  where r.vehicle_id in (select id from removable);

  with allowed_stock as (
    select trim(upper(coalesce(d."Current Stock No", ''))) as stock_key
    from public."DealsJP1" d
    where coalesce(d."Last Deal", false) is true
      and upper(trim(coalesce(d."Vehicle Status", ''))) in ('ACTIVE', 'STOCK', 'STOLEN')
      and d."Current Stock No" is not null
      and trim(d."Current Stock No") <> ''
  )
  delete from public.vehicles v
  where not exists (
    select 1
    from allowed_stock a
    where a.stock_key = trim(upper(coalesce(v."Current Stock No", '')))
  );

  get diagnostics deleted_count = row_count;

  with source_rows as (
    select
      d."Current Stock No" as current_stock_no,
      d."VIN" as vin,
      d.vin6 as shortvin,
      d."Deal Status" as deal_status,
      d."Customer" as customer_id,
      d."Unit Type" as unit_type,
      d."Model Year"::text as model_year,
      d."Model" as model,
      d."Inventory Preparation Status" as inv_prep_stat,
      d."PassTime Vehicle Status" as pt_status,
      d."PassTime Serial No" as pt_serial,
      d."Encore Serial Number" as encore_serial,
      d."Physical Location" as phys_loc,
      d."Vehicle Status" as vehicle_status,
      d."Open Balance"::numeric as open_balance,
      d."Oldest Invoice (Open)"::text as oldest_invoice_open
    from public."DealsJP1" d
    where coalesce(d."Last Deal", false) is true
      and upper(trim(coalesce(d."Vehicle Status", ''))) in ('ACTIVE', 'STOCK', 'STOLEN')
      and d."Current Stock No" is not null
      and trim(d."Current Stock No") <> ''
  ),
  upserted as (
    insert into public.vehicles (
      "Current Stock No", "VIN", "shortvin",
      "deal status", "customer id", "unit type", "model year", "model",
      "inv. prep. stat.", "pt status", "pt serial", "encore serial",
      "phys_loc", "Vehicle Status", "Open Balance", "Oldest Invoice (Open)"
    )
    select
      current_stock_no,
      vin,
      shortvin,
      deal_status,
      customer_id,
      unit_type,
      model_year,
      model,
      inv_prep_stat,
      pt_status,
      pt_serial,
      encore_serial,
      phys_loc,
      vehicle_status,
      open_balance,
      oldest_invoice_open
    from source_rows
    on conflict ("Current Stock No")
    do update set
      "VIN"                   = excluded."VIN",
      "shortvin"              = excluded."shortvin",
      "deal status"           = excluded."deal status",
      "customer id"           = excluded."customer id",
      "unit type"             = excluded."unit type",
      "model year"            = excluded."model year",
      "model"                 = excluded."model",
      "inv. prep. stat."      = excluded."inv. prep. stat.",
      "pt status"             = excluded."pt status",
      "pt serial"             = excluded."pt serial",
      "encore serial"         = excluded."encore serial",
      "phys_loc"              = excluded."phys_loc",
      "Vehicle Status"        = excluded."Vehicle Status",
      "Open Balance"          = excluded."Open Balance",
      "Oldest Invoice (Open)" = excluded."Oldest Invoice (Open)"
    returning 1
  )
  select count(*) into upserted_count from upserted;

  return upserted_count + deleted_count;
end;
$$;

-- Verification helpers. Run manually after applying the migration.
--
-- select schemaname, tablename, indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename in (
--     'vehicles', 'PT-LastPing', 'DealsJP1', 'gps_blacklist',
--     'repair_history', 'Services', 'Hotspots', 'Services_Blacklist'
--   )
-- order by tablename, indexname;
--
-- select table_name, column_name, generation_expression
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name in ('PT-LastPing', 'DealsJP1', 'repair_history')
--   and column_name = 'vin6';
--
-- explain (analyze, buffers)
-- select id, "Serial", "Date"
-- from public."PT-LastPing"
-- where "Serial" = '<serial>'
-- order by "Date" desc
-- limit 50;
--
-- explain (analyze, buffers)
-- select id, vehicle_id, "Date"
-- from public."PT-LastPing"
-- where vehicle_id = '<vehicle_uuid>'::uuid
-- order by "Date" desc
-- limit 50;
--
-- explain (analyze, buffers)
-- select id, vin6, "Serial", "Date"
-- from public."PT-LastPing"
-- where vin6 = '<VIN6>'
-- order by "Date" desc, id desc
-- limit 50;
--
-- explain (analyze, buffers)
-- select id, "Current Stock No"
-- from public."DealsJP1"
-- where "Current Stock No" = '<stock_no>';
--
-- explain (analyze, buffers)
-- select id, vin6, created_at
-- from public.repair_history
-- where vin6 = '<VIN6>'
-- order by created_at desc
-- limit 50;
