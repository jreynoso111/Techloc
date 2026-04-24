create or replace function public.handle_vin_duplicates_priority()
returns trigger
language plpgsql
as $function$
declare
  new_stock_key text := trim(upper(coalesce(new."Current Stock No", '')));
begin
  -- If the incoming row is ACTIVE, clean obsolete duplicates for the same short VIN,
  -- but keep the current stock row and any rows still referenced by child tables.
  if upper(trim(coalesce(new."deal status", ''))) = 'ACTIVE' then
    delete from public.vehicles v
    where v.shortvin = new.shortvin
      and v.id <> new.id
      and trim(upper(coalesce(v."Current Stock No", ''))) <> new_stock_key
      and not exists (
        select 1
        from public."PT-LastPing" p
        where p.vehicle_id = v.id
      )
      and not exists (
        select 1
        from public.repair_history r
        where r.vehicle_id = v.id
      );
    return new;
  end if;

  -- For non-ACTIVE rows, only block true duplicates from a different stock number.
  -- This keeps the DealsJP1 upsert path free to update the existing stock row
  -- from ACTIVE -> CLOSED (or similar) via ON CONFLICT.
  if exists (
    select 1
    from public.vehicles v
    where v.shortvin = new.shortvin
      and upper(trim(coalesce(v."deal status", ''))) = 'ACTIVE'
      and v.id <> new.id
      and trim(upper(coalesce(v."Current Stock No", ''))) <> new_stock_key
  ) then
    return null;
  end if;

  return new;
end;
$function$;
