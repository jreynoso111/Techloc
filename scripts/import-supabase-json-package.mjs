import fs from 'node:fs/promises';
import path from 'node:path';

const PACKAGE_DIR = process.argv[2] || path.join(
  process.env.HOME || '',
  'Desktop',
  'techloc-supabase-migration-2026-05-02T02-47-21-324Z'
);
const START_TABLE = process.argv[3] || '';

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
  ...(await parseEnvFile(path.resolve('.env'))),
  ...(await parseEnvFile(path.resolve('.env.prod'))),
  ...process.env,
});

const chunkRows = (rows, size) => {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
};

const UPSERT_CONFLICTS = {
  data_versions: 'scope',
};

const postRows = async ({ baseUrl, serviceKey, table, rows }) => {
  if (!rows.length) return;
  const url = new URL(`${baseUrl}/rest/v1/${encodeURIComponent(table)}`);
  const onConflict = UPSERT_CONFLICTS[table];
  if (onConflict) url.searchParams.set('on_conflict', onConflict);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: onConflict ? 'return=minimal,resolution=merge-duplicates' : 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${table}: ${response.status} ${response.statusText}: ${text.slice(0, 1000)}`);
  }
};

const main = async () => {
  const env = await loadEnv();
  const baseUrl = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SECRET_KEY || '').trim();
  if (!baseUrl || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

  const startIndex = START_TABLE ? TABLE_ORDER.indexOf(START_TABLE) : 0;
  if (startIndex === -1) throw new Error(`Unknown start table: ${START_TABLE}`);

  for (const table of TABLE_ORDER.slice(startIndex)) {
    const filePath = path.join(PACKAGE_DIR, 'public-data-json', `${table}.json`);
    const rows = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const size = table === 'PT-LastPing' || table === 'admin_change_log' ? 500 : 1000;
    let imported = 0;
    for (const chunk of chunkRows(rows, size)) {
      await postRows({ baseUrl, serviceKey, table, rows: chunk });
      imported += chunk.length;
      if (imported % (size * 10) === 0 || imported === rows.length) {
        console.log(`${table}: ${imported}/${rows.length}`);
      }
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
