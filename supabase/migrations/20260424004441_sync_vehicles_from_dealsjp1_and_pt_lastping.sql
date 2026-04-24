create or replace function public.refresh_vehicles_from_dealsjp1_stmt()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.sync_vehicles_from_dealsjp1_lastdeal();
  return null;
end;
$function$;

drop trigger if exists trg_refresh_vehicles_from_dealsjp1 on public."DealsJP1";
create trigger trg_refresh_vehicles_from_dealsjp1
after insert or update or delete on public."DealsJP1"
for each statement
execute function public.refresh_vehicles_from_dealsjp1_stmt();

drop trigger if exists trg_refresh_vehicles_from_pt_lastping_legacy on public."PT-LastPing";
create trigger trg_refresh_vehicles_from_pt_lastping_legacy_insert
after insert on public."PT-LastPing"
referencing new table as new_rows
for each statement
execute function public.sync_vehicles_from_pt_lastping_stmt();

create trigger trg_refresh_vehicles_from_pt_lastping_legacy_update
after update on public."PT-LastPing"
referencing new table as new_rows
for each statement
execute function public.sync_vehicles_from_pt_lastping_stmt();

drop trigger if exists trg_refresh_vehicles_from_pt_lastping_v2_insert on public."PT-LastPing";
create trigger trg_refresh_vehicles_from_pt_lastping_v2_insert
after insert on public."PT-LastPing"
referencing new table as new_rows
for each statement
execute function public.sync_vehicles_from_pt_lastping_v2_stmt();

drop trigger if exists trg_refresh_vehicles_from_pt_lastping_v2_update on public."PT-LastPing";
create trigger trg_refresh_vehicles_from_pt_lastping_v2_update
after update on public."PT-LastPing"
referencing new table as new_rows
for each statement
execute function public.sync_vehicles_from_pt_lastping_v2_stmt();

select public.sync_vehicles_from_dealsjp1_lastdeal();
select public.refresh_all_vehicle_movement_v2();
