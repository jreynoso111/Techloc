drop function if exists public.finalize_pt_lastping_upload(text[]);

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
  r record;
  v_updated_rows integer := 0;
  v_processed_vins integer := 0;
  v_batch_result jsonb := '{}'::jsonb;
begin
  with target_vins as (
    select distinct right(upper(trim(vin)), 6) as vin6
    from unnest(coalesce(p_vins, array[]::text[])) as vin
    where trim(coalesce(vin, '')) <> ''
  ), target_rows as (
    select
      p.id,
      p."VIN",
      p."Serial",
      p."Date",
      p."Lat",
      p."Long"
    from public."PT-LastPing" p
    join target_vins tv
      on right(upper(trim(coalesce(p."VIN", ''))), 6) = tv.vin6
    where (
      (p_min_id_exclusive is not null and p.id > p_min_id_exclusive)
      or (
        p_min_id_exclusive is null
        and (
          p.moved is null
          or p.days_stationary is null
          or p.moved_v2 is null
        )
      )
    )
  ), computed as (
    select
      tr.id,
      public.compute_pt_lastping_moved(
        tr."VIN",
        tr."Serial",
        tr."Date",
        tr."Lat",
        tr."Long",
        tr.id
      ) as moved_calc,
      public.compute_pt_lastping_moved_v2(
        tr."VIN",
        tr."Serial",
        tr."Date",
        tr."Lat",
        tr."Long",
        tr.id
      ) as moved_v2_calc
    from target_rows tr
  )
  update public."PT-LastPing" p
  set moved = c.moved_calc,
      days_stationary = public.compute_pt_lastping_days_stationary(
        p."VIN",
        p."Serial",
        p."Date",
        c.moved_calc,
        p.id
      ),
      moved_v2 = c.moved_v2_calc
  from computed c
  where p.id = c.id;

  get diagnostics v_updated_rows = row_count;

  for r in
    select distinct trim(vin) as vin
    from unnest(coalesce(p_vins, array[]::text[])) as vin
    where trim(coalesce(vin, '')) <> ''
  loop
    perform public.refresh_vehicle_from_pt_lastping_legacy(r.vin);
    v_processed_vins := v_processed_vins + 1;
  end loop;

  v_batch_result := public.refresh_vehicle_movement_v2_batch(p_vins);

  update public.vehicles
  set movement_days_stationary_v2 = null,
      movement_computed_at_v2 = timezone('utc', now())
  where movement_status_v2 = 'unknown'
    and movement_days_stationary_v2 is not null;

  return jsonb_build_object(
    'updated_rows', v_updated_rows,
    'processed_vins', coalesce((v_batch_result ->> 'targeted_vehicles')::integer, v_processed_vins),
    'updated_vehicles', coalesce((v_batch_result ->> 'updated_vehicles')::integer, 0)
  );
end;
$function$;
