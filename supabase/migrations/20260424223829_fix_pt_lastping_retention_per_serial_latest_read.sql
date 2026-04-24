create or replace function public.prune_pt_lastping_older_than_3_months()
returns bigint
language plpgsql
set search_path to 'public'
as $function$
declare
  v_deleted_by_serial bigint := 0;
  v_deleted_without_serial bigint := 0;
begin
  with latest_per_serial as (
    select
      "Serial",
      max("Date") as latest_date
    from public."PT-LastPing"
    where "Serial" is not null
      and trim("Serial") <> ''
      and "Date" is not null
    group by "Serial"
  ), deleted as (
    delete from public."PT-LastPing" p
    using latest_per_serial l
    where p."Serial" = l."Serial"
      and p."Date" < (l.latest_date - interval '3 months')
    returning 1
  )
  select count(*) into v_deleted_by_serial
  from deleted;

  delete from public."PT-LastPing"
  where ("Serial" is null or trim("Serial") = '')
    and "Date" < (now() - interval '3 months');

  get diagnostics v_deleted_without_serial = row_count;

  return coalesce(v_deleted_by_serial, 0) + coalesce(v_deleted_without_serial, 0);
end;
$function$;
