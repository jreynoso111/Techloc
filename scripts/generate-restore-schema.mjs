import fs from 'node:fs/promises';
import path from 'node:path';

const PACKAGE_DIR = process.argv[2] || path.join(
  process.env.HOME || '',
  'Desktop',
  'techloc-supabase-migration-2026-05-02T02-47-21-324Z'
);
const OUT_PATH = process.argv[3] || path.join('/private/tmp', 'techloc-restore-schema.sql');

const TABLE_ORDER = [
  'profiles',
  'vehicles',
  'DealsJP1',
  'PT-LastPing',
  'Services',
  'Hotspots',
  'Services_Blacklist',
  'Titles',
  'admin_change_log',
  'app_settings',
  'control_map_vehicle_clicks',
  'data_versions',
  'gps_blacklist',
  'repair_history',
  'user_table_configs',
];

const quoteIdent = (value = '') => `"${String(value).replace(/"/g, '""')}"`;
const quoteLiteral = (value = '') => `'${String(value).replace(/'/g, "''")}'`;

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const isIntegerString = (value) => /^-?\d+$/.test(String(value || '').trim());
const isNumberString = (value) => /^-?(?:\d+\.?\d*|\.\d+)$/.test(String(value || '').trim());
const isDateString = (value) => {
  const text = String(value || '').trim();
  if (!text || !/\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)) return false;
  return Number.isFinite(Date.parse(text));
};

const dateNamePattern = /(date|time|created_at|updated_at|connection|read|changed|uploaded|expires|effective_from|issued|start|end|last)/i;

const inferType = (column, values) => {
  const nonNull = values.filter((value) => value !== null && value !== undefined && value !== '');
  if (!nonNull.length) return 'text';
  if (nonNull.every((value) => typeof value === 'boolean')) return 'boolean';
  if (nonNull.every((value) => typeof value === 'object' && !Array.isArray(value))) return 'jsonb';
  if (nonNull.every((value) => Array.isArray(value))) return 'jsonb';
  if (nonNull.every((value) => isUuid(value))) return 'uuid';
  if (dateNamePattern.test(column) && nonNull.every((value) => value instanceof Date || isDateString(value))) return 'timestamptz';
  if (nonNull.every((value) => typeof value === 'number' && Number.isInteger(value))) return 'bigint';
  if (nonNull.every((value) => typeof value === 'number')) return 'numeric';
  if (nonNull.every((value) => typeof value === 'string' && isIntegerString(value)) && /^(id|year|mileage|terms|number|rows?|version|moving|days)/i.test(column)) return 'bigint';
  if (nonNull.every((value) => typeof value === 'string' && isNumberString(value)) && /(amount|price|balance|lat|long|mileage|value|payment|radius|quote|cash|deposit|total|regular|retail)/i.test(column)) return 'numeric';
  return 'text';
};

const loadRows = async (table) => {
  const filePath = path.join(PACKAGE_DIR, 'public-data-json', `${table}.json`);
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
};

const tableColumns = (rows) => {
  const columns = [];
  const seen = new Set();
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((column) => {
      if (seen.has(column)) return;
      seen.add(column);
      columns.push(column);
    });
  });
  return columns;
};

const primaryKeyFor = (table, columns) => {
  if (table === 'data_versions' && columns.includes('scope')) return ['scope'];
  if (table === 'profiles' && columns.includes('id')) return ['id'];
  if (columns.includes('id')) return ['id'];
  return [];
};

const indexStatementsFor = (table, columns) => {
  const statements = [];
  const qTable = quoteIdent(table);
  const addIndex = (name, cols, where = '') => {
    if (cols.every((col) => columns.includes(col))) {
      statements.push(`create index if not exists ${quoteIdent(name)} on public.${qTable} (${cols.map(quoteIdent).join(', ')})${where};`);
    }
  };
  addIndex(`idx_${table}_vin`, ['VIN']);
  addIndex(`idx_${table}_shortvin`, ['shortvin']);
  addIndex(`idx_${table}_current_stock`, ['Current Stock No']);
  addIndex(`idx_${table}_date`, ['Date']);
  addIndex(`idx_${table}_serial`, ['Serial']);
  addIndex(`idx_${table}_category`, ['category']);
  addIndex(`idx_${table}_state`, ['state']);
  addIndex(`idx_${table}_user_id`, ['user_id']);
  addIndex(`idx_${table}_vehicle_id`, ['vehicle_id']);
  return statements;
};

const main = async () => {
  const chunks = [
    'create extension if not exists pgcrypto;',
    'create schema if not exists public;',
    'grant usage on schema public to anon, authenticated, service_role;',
  ];

  for (const table of TABLE_ORDER) {
    const rows = await loadRows(table);
    const columns = tableColumns(rows);
    const definitions = columns.map((column) => {
      const values = rows.map((row) => row?.[column]);
      return `  ${quoteIdent(column)} ${inferType(column, values)}`;
    });
    const pk = primaryKeyFor(table, columns);
    if (pk.length) definitions.push(`  primary key (${pk.map(quoteIdent).join(', ')})`);

    chunks.push(`drop table if exists public.${quoteIdent(table)} cascade;`);
    chunks.push(`create table public.${quoteIdent(table)} (\n${definitions.join(',\n')}\n);`);
    chunks.push(`alter table public.${quoteIdent(table)} enable row level security;`);
    chunks.push(`drop policy if exists ${quoteIdent(`${table}_select_readable`)} on public.${quoteIdent(table)};`);
    chunks.push(`create policy ${quoteIdent(`${table}_select_readable`)} on public.${quoteIdent(table)} for select to anon, authenticated using (true);`);
    chunks.push(`drop policy if exists ${quoteIdent(`${table}_authenticated_write`)} on public.${quoteIdent(table)};`);
    chunks.push(`create policy ${quoteIdent(`${table}_authenticated_write`)} on public.${quoteIdent(table)} for all to authenticated using (true) with check (true);`);
    chunks.push(`grant select on public.${quoteIdent(table)} to anon, authenticated;`);
    chunks.push(`grant select, insert, update, delete on public.${quoteIdent(table)} to authenticated, service_role;`);
    chunks.push(...indexStatementsFor(table, columns));
  }

  chunks.push(`
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
$$;`);

  const versionTargets = [
    ['vehicles', 'vehicles'],
    ['DealsJP1', 'dealsjp1'],
    ['Services', 'services'],
    ['Hotspots', 'hotspots'],
    ['Services_Blacklist', 'services_blacklist'],
    ['gps_blacklist', 'gps_blacklist'],
    ['app_settings', 'app_settings'],
  ];
  for (const [table, scope] of versionTargets) {
    chunks.push(`drop trigger if exists ${quoteIdent(`data_versions_${table.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}`)} on public.${quoteIdent(table)};`);
    chunks.push(`create trigger ${quoteIdent(`data_versions_${table.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}`)} after insert or update or delete or truncate on public.${quoteIdent(table)} for each statement execute function public.bump_data_version(${quoteLiteral(scope)});`);
  }

  chunks.push(`
create or replace function public.refresh_vehicle_movement_v2_batch(p_vins text[] default null::text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_targeted integer := 0;
begin
  with target_vins as (
    select distinct right(regexp_replace(upper(trim(vin)), '[^A-Z0-9]', '', 'g'), 6) as shortvin
    from unnest(coalesce(p_vins, array[]::text[])) as vin
    where trim(coalesce(vin, '')) <> ''
  ), latest as (
    select distinct on (right(regexp_replace(upper(trim(coalesce(p."VIN", ''))), '[^A-Z0-9]', '', 'g'), 6))
      right(regexp_replace(upper(trim(coalesce(p."VIN", ''))), '[^A-Z0-9]', '', 'g'), 6) as shortvin,
      p."Serial" as serial,
      p."Date" as last_read,
      p."Lat" as lat,
      p."Long" as long,
      p.address,
      p.moved,
      p.days_stationary,
      p.moved_v2,
      p.days_stationary_v2
    from public."PT-LastPing" p
    where p."VIN" is not null
      and (p_vins is null or array_length(p_vins, 1) is null or exists (select 1 from target_vins tv where tv.shortvin = right(regexp_replace(upper(trim(coalesce(p."VIN", ''))), '[^A-Z0-9]', '', 'g'), 6)))
    order by right(regexp_replace(upper(trim(coalesce(p."VIN", ''))), '[^A-Z0-9]', '', 'g'), 6), p."Date" desc nulls last, p.id desc nulls last
  )
  update public.vehicles v
  set "pt serial" = latest.serial,
      "pt last read" = latest.last_read,
      lat = latest.lat,
      long = latest.long,
      short_location = latest.address,
      moving = coalesce(latest.moved_v2, latest.moved),
      days_stationary = coalesce(latest.days_stationary_v2, latest.days_stationary),
      movement_status_v2 = case when coalesce(latest.moved_v2, latest.moved) = 1 then 'moving' when coalesce(latest.moved_v2, latest.moved) = -1 then 'stopped' else 'unknown' end,
      movement_days_stationary_v2 = coalesce(latest.days_stationary_v2, latest.days_stationary),
      movement_computed_at_v2 = now()
  from latest
  where v.shortvin = latest.shortvin;

  get diagnostics v_updated = row_count;
  select count(*) into v_targeted from public.vehicles v where p_vins is null or array_length(p_vins, 1) is null or exists (select 1 from target_vins tv where tv.shortvin = v.shortvin);
  return jsonb_build_object('updated_vehicles', v_updated, 'targeted_vehicles', v_targeted);
end;
$$;

create or replace function public.finalize_pt_lastping_upload(p_vins text[] default null::text[], p_min_id_exclusive bigint default null::bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.refresh_vehicle_movement_v2_batch(p_vins);
end;
$$;

create or replace function public.sync_vehicles_from_dealsjp1_lastdeal()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return 0;
end;
$$;

notify pgrst, 'reload schema';
`);

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, `${chunks.join('\n\n')}\n`);
  console.log(OUT_PATH);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
