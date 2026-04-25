-- Harden public schema access for Supabase Data API.
-- This migration intentionally does not move existing functions out of public
-- to avoid breaking existing RPC URLs and triggers.

create or replace function public.is_active_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and lower(coalesce(p.status, 'active')) <> 'suspended'
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_user(auth.uid());
$$;

create or replace function public.is_active_administrator(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and lower(coalesce(p.role::text, '')) = 'administrator'
      and lower(coalesce(p.status, 'active')) = 'active'
  );
$$;

create or replace function public.is_active_administrator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_administrator(auth.uid());
$$;

create or replace function public.require_active_administrator_for_client()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Trigger/maintenance executions have no end-user JWT. Client RPC executions do.
  if auth.uid() is not null or auth.role() in ('anon', 'authenticated') then
    if not public.is_active_administrator(auth.uid()) then
      raise exception 'Active administrator role is required.' using errcode = '42501';
    end if;
  end if;
end;
$$;

create or replace function public.profiles_guard_non_admin_sensitive_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.is_active_administrator(auth.uid()) then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.email is distinct from old.email
    or new.role is distinct from old.role
    or new.status is distinct from old.status
  then
    raise exception 'Only administrators can change profile identity, role, or status.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_non_admin_sensitive_update on public.profiles;
create trigger profiles_guard_non_admin_sensitive_update
before update on public.profiles
for each row
execute function public.profiles_guard_non_admin_sensitive_update();

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
  perform public.require_active_administrator_for_client();

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

create or replace function public.refresh_vehicle_movement_v2(p_vin text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.require_active_administrator_for_client();

  if p_vin is null or trim(p_vin) = '' then
    return;
  end if;

  perform public.refresh_vehicle_movement_v2_batch(array[p_vin]);
end;
$$;

create or replace function public.finalize_pt_lastping_upload(
  p_vins text[] default null::text[],
  p_min_id_exclusive bigint default null::bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated_rows integer := 0;
  v_batch_result jsonb := '{}'::jsonb;
begin
  perform public.require_active_administrator_for_client();

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
$$;

create or replace function public.recalc_dealsjp1_last_deal()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  updated_rows bigint := 0;
begin
  perform public.require_active_administrator_for_client();

  with normalized as (
    select
      d.id,
      trim(upper(coalesce(d."VIN", ''))) as vin_key,
      case when upper(trim(coalesce(d."Deal Status", ''))) = 'ACTIVE' then 1 else 0 end as is_active_rank,
      trim(upper(coalesce(d."Current Stock No", ''))) as stock_key,
      nullif(trim(split_part(trim(upper(coalesce(d."Current Stock No", ''))), '-', 1)), '') as stock_base_text,
      nullif(trim(split_part(trim(upper(coalesce(d."Current Stock No", ''))), '-', 2)), '') as stock_version_text,
      case
        when trim(coalesce(d."Deal Date"::text, '')) ~ '^\d{1,2}/\d{1,2}/\d{4}$'
          then to_date(trim(d."Deal Date"::text), 'MM/DD/YYYY')
        when trim(coalesce(d."Deal Date"::text, '')) ~ '^\d{4}-\d{1,2}-\d{1,2}$'
          then trim(d."Deal Date"::text)::date
        when trim(coalesce(d."Deal Date"::text, '')) ~ '^\d{4}-\d{1,2}-\d{1,2}[ T].*$'
          then left(trim(d."Deal Date"::text), 10)::date
        else null
      end as parsed_deal_date
    from public."DealsJP1" d
  ),
  ranked as (
    select
      n.id,
      row_number() over (
        partition by n.vin_key
        order by
          n.is_active_rank desc,
          case
            when n.stock_base_text is not null and regexp_replace(n.stock_base_text, '[^0-9]', '', 'g') <> ''
              then regexp_replace(n.stock_base_text, '[^0-9]', '', 'g')::numeric
            else null
          end desc nulls last,
          n.stock_base_text desc nulls last,
          coalesce(
            case
              when n.stock_version_text is not null and regexp_replace(n.stock_version_text, '[^0-9]', '', 'g') <> ''
                then regexp_replace(n.stock_version_text, '[^0-9]', '', 'g')::numeric
              else null
            end,
            0
          ) desc,
          n.stock_version_text desc nulls last,
          n.parsed_deal_date desc nulls last,
          n.stock_key desc nulls last,
          n.id desc
      ) as rn
    from normalized n
    where n.vin_key <> ''
  ),
  desired as (
    select
      d.id,
      coalesce(r.rn = 1, false) as should_be_last
    from public."DealsJP1" d
    left join ranked r on r.id = d.id
  )
  update public."DealsJP1" d
  set "Last Deal" = desired.should_be_last
  from desired
  where d.id = desired.id
    and coalesce(d."Last Deal", false) is distinct from desired.should_be_last;

  get diagnostics updated_rows = row_count;
  return updated_rows;
end;
$$;

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
      right(d."VIN", 6) as shortvin,
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

do $$
declare
  p record;
begin
  for p in
    select pr.oid::regprocedure::text as signature
    from pg_proc pr
    join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', p.signature);
  end loop;
end;
$$;

grant execute on function public.is_active_user(uuid) to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_active_administrator(uuid) to authenticated;
grant execute on function public.is_active_administrator() to authenticated;
grant execute on function public.update_vehicle_gps_fields(uuid, text, text) to authenticated;
grant execute on function public.refresh_vehicle_movement_v2(text) to authenticated;
grant execute on function public.finalize_pt_lastping_upload(text[], bigint) to authenticated;
grant execute on function public.recalc_dealsjp1_last_deal() to authenticated;
grant execute on function public.sync_vehicles_from_dealsjp1_lastdeal() to authenticated;

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'public."DealsJP1"'::regclass,
    'public."Hotspots"'::regclass,
    'public."PT-LastPing"'::regclass,
    'public."Services"'::regclass,
    'public."Services_Blacklist"'::regclass,
    'public.admin_change_log'::regclass,
    'public.app_settings'::regclass,
    'public.control_map_vehicle_clicks'::regclass,
    'public.gps_blacklist'::regclass,
    'public.profiles'::regclass,
    'public.repair_history'::regclass,
    'public.user_table_configs'::regclass,
    'public.vehicles'::regclass
  ] loop
    execute format('alter table %s enable row level security', t);
    execute format('revoke all on table %s from anon, authenticated', t);
  end loop;
end;
$$;

grant select on public."Services" to authenticated;
grant insert, update, delete on public."Services" to authenticated;

grant select on public."Hotspots" to authenticated;
grant insert, update, delete on public."Hotspots" to authenticated;

grant select on public."Services_Blacklist" to authenticated;
grant insert, update, delete on public."Services_Blacklist" to authenticated;

grant select on public.gps_blacklist to authenticated;
grant insert, update, delete on public.gps_blacklist to authenticated;

grant select on public.app_settings to authenticated;
grant insert, update, delete on public.app_settings to authenticated;

grant select on public.control_map_vehicle_clicks to authenticated;
grant insert, update, delete on public.control_map_vehicle_clicks to authenticated;

grant select on public.profiles to authenticated;
grant update (email, name, role, status, background_mode, last_connection) on public.profiles to authenticated;

grant select, insert, update, delete on public.admin_change_log to authenticated;
grant select, insert, update, delete on public.repair_history to authenticated;
grant select, insert, update, delete on public.user_table_configs to authenticated;

grant select on public.vehicles to authenticated;
grant insert, delete on public.vehicles to authenticated;
grant update (
  "Current Stock No", "VIN", shortvin, "deal status", "customer id", "unit type", "model year", model,
  "inv. prep. stat.", "deal completion", "gps fix", "gps fix reason", "pt status", "pt serial",
  "encore serial", moving, "pt last read", "pt first read", lat, long, phys_loc, "Vehicle Status",
  "Open Balance", "Oldest Invoice (Open)", days_stationary, short_location, movement_status_v2,
  movement_days_stationary_v2, movement_computed_at_v2, movement_threshold_meters_v2,
  movement_unit_type_v2
) on public.vehicles to authenticated;

grant select, insert, update, delete on public."DealsJP1" to authenticated;
grant select, insert, update, delete on public."PT-LastPing" to authenticated;

do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'DealsJP1', 'Hotspots', 'PT-LastPing', 'Services', 'Services_Blacklist',
        'admin_change_log', 'app_settings', 'control_map_vehicle_clicks',
        'gps_blacklist', 'profiles', 'repair_history', 'user_table_configs', 'vehicles'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end;
$$;

create policy "services_select_active" on public."Services"
  for select to authenticated using (public.is_active_user());
create policy "services_write_admin" on public."Services"
  for all to authenticated using (public.is_active_administrator()) with check (public.is_active_administrator());

create policy "hotspots_select_active" on public."Hotspots"
  for select to authenticated using (public.is_active_user());
create policy "hotspots_write_admin" on public."Hotspots"
  for all to authenticated using (public.is_active_administrator()) with check (public.is_active_administrator());

create policy "services_blacklist_select_active" on public."Services_Blacklist"
  for select to authenticated using (public.is_active_user());
create policy "services_blacklist_write_admin" on public."Services_Blacklist"
  for all to authenticated using (public.is_active_administrator()) with check (public.is_active_administrator());

create policy "gps_blacklist_select_active" on public.gps_blacklist
  for select to authenticated using (public.is_active_user());
create policy "gps_blacklist_write_admin" on public.gps_blacklist
  for all to authenticated using (public.is_active_administrator()) with check (public.is_active_administrator());

create policy "app_settings_select_active" on public.app_settings
  for select to authenticated using (public.is_active_user());
create policy "app_settings_write_admin" on public.app_settings
  for all to authenticated using (public.is_active_administrator()) with check (public.is_active_administrator());

create policy "profiles_select_self_or_admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_active_administrator());
create policy "profiles_update_self_active" on public.profiles
  for update to authenticated using (id = auth.uid() and public.is_active_user()) with check (id = auth.uid() and public.is_active_user());
create policy "profiles_update_admin" on public.profiles
  for update to authenticated using (public.is_active_administrator()) with check (public.is_active_administrator());

create policy "admin_change_log_select_admin" on public.admin_change_log
  for select to authenticated using (public.is_active_administrator());
create policy "admin_change_log_insert_admin" on public.admin_change_log
  for insert to authenticated with check (public.is_active_administrator());

create policy "control_map_vehicle_clicks_select_own" on public.control_map_vehicle_clicks
  for select to authenticated using (user_id = auth.uid());
create policy "control_map_vehicle_clicks_insert_own" on public.control_map_vehicle_clicks
  for insert to authenticated with check (user_id = auth.uid());
create policy "control_map_vehicle_clicks_update_own" on public.control_map_vehicle_clicks
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "control_map_vehicle_clicks_delete_own" on public.control_map_vehicle_clicks
  for delete to authenticated using (user_id = auth.uid());

create policy "vehicles_select_active" on public.vehicles
  for select to authenticated using (public.is_active_user());
create policy "vehicles_write_admin" on public.vehicles
  for all to authenticated using (public.is_active_administrator()) with check (public.is_active_administrator());

create policy "dealsjp1_select_active" on public."DealsJP1"
  for select to authenticated using (public.is_active_user());
create policy "dealsjp1_write_admin" on public."DealsJP1"
  for all to authenticated using (public.is_active_administrator()) with check (public.is_active_administrator());

create policy "pt_lastping_select_active" on public."PT-LastPing"
  for select to authenticated using (public.is_active_user());
create policy "pt_lastping_write_admin" on public."PT-LastPing"
  for all to authenticated using (public.is_active_administrator()) with check (public.is_active_administrator());

create policy "repair_history_select_active" on public.repair_history
  for select to authenticated using (public.is_active_user());
create policy "repair_history_insert_active" on public.repair_history
  for insert to authenticated with check (public.is_active_user());
create policy "repair_history_update_active" on public.repair_history
  for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy "repair_history_delete_active" on public.repair_history
  for delete to authenticated using (public.is_active_user());

create policy "user_table_configs_select_own" on public.user_table_configs
  for select to authenticated using (user_id = auth.uid());
create policy "user_table_configs_insert_own" on public.user_table_configs
  for insert to authenticated with check (user_id = auth.uid());
create policy "user_table_configs_update_own" on public.user_table_configs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_table_configs_delete_own" on public.user_table_configs
  for delete to authenticated using (user_id = auth.uid());

-- Verification SQL for post-migration review:
--
-- 1) Public security definer functions and executable grants:
-- select
--   p.oid::regprocedure as function_signature,
--   p.prosecdef as security_definer,
--   p.proacl
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.prosecdef
-- order by 1;
--
-- 2) Public tables exposed through the Data API, RLS status, and table ACLs:
-- select
--   c.oid::regclass as table_name,
--   c.relrowsecurity as rls_enabled,
--   c.relforcerowsecurity as rls_forced,
--   c.relacl
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relkind in ('r', 'p')
-- order by 1;
--
-- 3) RLS policies, confirming no user_metadata/auth.jwt role checks remain:
-- select schemaname, tablename, policyname, roles, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
-- order by tablename, policyname;
--
-- 4) Any remaining direct UPDATE grant on vehicles:
-- select grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name = 'vehicles'
--   and privilege_type = 'UPDATE'
-- order by grantee;
