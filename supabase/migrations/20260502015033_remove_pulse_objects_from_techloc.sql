do $$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'vehicles'
      and c.relkind in ('r', 'p')
  ) or not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'DealsJP1'
      and c.relkind in ('r', 'p')
  ) then
    raise exception 'Refusing to remove Pulse objects: this database does not look like TechLoc.';
  end if;
end;
$$;

do $$
declare
  object_name text;
begin
  for object_name in
    select format('%I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm')
      and (
        c.relname like 'pulse\_%' escape '\'
        or c.relname like 'fleetpulse\_%' escape '\'
      )
  loop
    execute format('drop view if exists %s cascade', object_name);
  end loop;
end;
$$;

do $$
declare
  object_name text;
begin
  for object_name in
    select format('%I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'f')
      and (
        c.relname like 'pulse\_%' escape '\'
        or c.relname like 'fleetpulse\_%' escape '\'
      )
  loop
    execute format('drop table if exists %s cascade', object_name);
  end loop;
end;
$$;

do $$
declare
  object_signature text;
begin
  for object_signature in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'pulse\_%' escape '\'
        or p.proname like 'fleetpulse\_%' escape '\'
      )
  loop
    execute format('drop function if exists %s cascade', object_signature);
  end loop;
end;
$$;

do $$
declare
  object_name text;
begin
  for object_name in
    select format('%I.%I', n.nspname, t.typname)
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and (
        t.typname like 'pulse\_%' escape '\'
        or t.typname like 'fleetpulse\_%' escape '\'
      )
  loop
    execute format('drop type if exists %s cascade', object_name);
  end loop;
end;
$$;
