create table if not exists public.data_versions (
  scope text primary key,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  reason text not null default 'initial'
);

alter table public.data_versions enable row level security;

drop policy if exists "Anyone can read data versions" on public.data_versions;
create policy "Anyone can read data versions"
on public.data_versions
for select
to anon, authenticated
using (true);

grant select on public.data_versions to anon, authenticated;

create or replace function public.bump_data_version()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_scope text := coalesce(tg_argv[0], tg_table_name);
begin
  insert into public.data_versions (scope, version, updated_at, reason)
  values (target_scope, 1, now(), tg_op || ' ' || tg_table_name)
  on conflict (scope) do update
    set version = public.data_versions.version + 1,
        updated_at = excluded.updated_at,
        reason = excluded.reason;
  return null;
end;
$$;

do $$
declare
  target record;
begin
  for target in
    select *
    from (
      values
        ('vehicles', 'vehicles'),
        ('DealsJP1', 'dealsjp1'),
        ('Services', 'services'),
        ('Hotspots', 'hotspots'),
        ('Services_Blacklist', 'services_blacklist'),
        ('gps_blacklist', 'gps_blacklist'),
        ('app_settings', 'app_settings')
    ) as item(table_name, scope_name)
  loop
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = target.table_name
        and c.relkind in ('r', 'p')
    ) then
      execute format(
        'drop trigger if exists %I on public.%I',
        'data_versions_' || lower(regexp_replace(target.table_name, '[^a-zA-Z0-9]+', '_', 'g')),
        target.table_name
      );
      execute format(
        'create trigger %I after insert or update or delete or truncate on public.%I for each statement execute function public.bump_data_version(%L)',
        'data_versions_' || lower(regexp_replace(target.table_name, '[^a-zA-Z0-9]+', '_', 'g')),
        target.table_name,
        target.scope_name
      );
      execute format(
        'insert into public.data_versions (scope, version, updated_at, reason) values (%L, 1, now(), %L) on conflict (scope) do nothing',
        target.scope_name,
        'initial ' || target.table_name
      );
    end if;
  end loop;
end;
$$;
