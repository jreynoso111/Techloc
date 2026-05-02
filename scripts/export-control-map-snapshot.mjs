import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = path.resolve(new URL('..', import.meta.url).pathname);
const OUTPUT_PATH = path.join(ROOT_DIR, 'assets/data/snapshots/control-map.json');
const DEFAULT_PAGE_SIZE = 1000;

const parseEnvFile = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const env = {};
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const index = line.indexOf('=');
      if (index === -1) continue;
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  } catch (_error) {
    return {};
  }
};

const loadEnv = async () => ({
  ...(await parseEnvFile(path.join(ROOT_DIR, '.env'))),
  ...(await parseEnvFile(path.join(ROOT_DIR, '.env.local'))),
  ...(await parseEnvFile(path.join(ROOT_DIR, '.env.prod'))),
  ...process.env,
});

const quoteSelectColumn = (column = '') => (/^[a-z_][a-z0-9_]*$/i.test(column) ? column : `"${column.replace(/"/g, '""')}"`);

const TABLES = {
  vehicles: [
    'id',
    'deal status',
    'Vehicle Status',
    'customer id',
    'unit type',
    'model year',
    'model',
    'VIN',
    'shortvin',
    'inv. prep. stat.',
    'deal completion',
    'gps fix',
    'gps fix reason',
    'pt status',
    'pt serial',
    'encore serial',
    'moving',
    'pt first read',
    'pt last read',
    'days_stationary',
    'short_location',
    'state loc',
    'pt city',
    'pt zipcode',
    'lat',
    'long',
    'phys_loc',
    'Current Stock No',
    'Open Balance',
    'movement_status_v2',
    'movement_days_stationary_v2',
    'movement_threshold_meters_v2',
    'movement_unit_type_v2',
    'movement_computed_at_v2',
  ].map(quoteSelectColumn).join(','),
  DealsJP1: '"Current Stock No","Regular Amount","Vehicle Status"',
  Services: 'id,company_name,region,phone,contact,email,website,availability,notes,city,state,zip,category,type,authorization,address,status,lat,long,verified',
  Hotspots: 'id,created_at,State,City,Zip,Lat,Long,Radius',
  Services_Blacklist: 'id,created_at,company_name,category,lat,long,"Assoc.Unit",Note,State,City,Zip,"Event date",Alarm,address',
  gps_blacklist: 'serial,is_active,effective_from',
  app_settings: '*',
};

const requestJson = async ({ baseUrl, serviceKey, endpoint }) => {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      accept: 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
};

const fetchTableRows = async ({ baseUrl, serviceKey, tableName, select }) => {
  const rows = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams();
    params.set('select', select || '*');
    params.set('offset', String(offset));
    params.set('limit', String(DEFAULT_PAGE_SIZE));
    const page = await requestJson({
      baseUrl,
      serviceKey,
      endpoint: `/rest/v1/${encodeURIComponent(tableName)}?${params.toString()}`,
    });
    const pageRows = Array.isArray(page) ? page : [];
    rows.push(...pageRows);
    if (pageRows.length < DEFAULT_PAGE_SIZE) break;
    offset += DEFAULT_PAGE_SIZE;
  }
  return rows;
};

const main = async () => {
  const env = await loadEnv();
  const baseUrl = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SECRET_KEY || '');
  if (!baseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const snapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: baseUrl,
    tables: {},
    errors: {},
  };

  for (const [tableName, select] of Object.entries(TABLES)) {
    try {
      const rows = await fetchTableRows({ baseUrl, serviceKey, tableName, select });
      snapshot.tables[tableName] = {
        updatedAt: snapshot.generatedAt,
        source: 'supabase-rest',
        rows,
      };
      console.log(`${tableName}: ${rows.length}`);
    } catch (error) {
      snapshot.errors[tableName] = error?.message || String(error);
      console.warn(`${tableName}: ${snapshot.errors[tableName]}`);
    }
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT_PATH}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
