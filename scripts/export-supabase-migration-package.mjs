import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT_DIR = path.resolve(new URL('..', import.meta.url).pathname);
const DEFAULT_PAGE_SIZE = 1000;

const TECHLOC_TABLES = [
  'DealsJP1',
  'Hotspots',
  'PT-LastPing',
  'Services',
  'Services_Blacklist',
  'Titles',
  'admin_change_log',
  'app_settings',
  'control_map_vehicle_clicks',
  'data_versions',
  'gps_blacklist',
  'profiles',
  'repair_history',
  'user_table_configs',
  'vehicles',
];

const EXCLUDED_PULSE_TABLES = [
  'pulse_automations',
  'pulse_board_items',
  'pulse_boards',
  'pulse_notifications',
  'pulse_profiles',
  'pulse_user_preferences',
  'pulse_workspaces',
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
  ...(await parseEnvFile(path.join(ROOT_DIR, '.env'))),
  ...(await parseEnvFile(path.join(ROOT_DIR, '.env.local'))),
  ...(await parseEnvFile(path.join(ROOT_DIR, '.env.prod'))),
  ...(await parseEnvFile(path.join(ROOT_DIR, '.env.vercel'))),
  ...process.env,
});

const safeName = (value = '') => String(value).replace(/[^A-Za-z0-9_.-]/g, '_');

const ensureDir = (dir) => fs.mkdir(dir, { recursive: true });

const requestJson = async ({ baseUrl, serviceKey, endpoint, method = 'GET' }) => {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      accept: 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 800)}`);
  }
  return text ? JSON.parse(text) : null;
};

const fetchTableRows = async ({ baseUrl, serviceKey, tableName }) => {
  const rows = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams();
    params.set('select', '*');
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

const csvEscape = (value) => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const rowsToCsv = (rows = []) => {
  const columns = Array.from(rows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  const lines = [columns.map(csvEscape).join(',')];
  rows.forEach((row) => {
    lines.push(columns.map((column) => csvEscape(row?.[column])).join(','));
  });
  return `${lines.join('\n')}\n`;
};

const writeJson = async (filePath, value) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const copyDir = async (from, to) => {
  try {
    await fs.cp(from, to, { recursive: true });
  } catch (_error) {
    // Optional source.
  }
};

const sha256File = async (filePath) => {
  const hash = createHash('sha256');
  hash.update(await fs.readFile(filePath));
  return hash.digest('hex');
};

const listFiles = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
};

const fetchAuthUsers = async ({ baseUrl, serviceKey }) => {
  const users = [];
  let page = 1;
  while (true) {
    const payload = await requestJson({
      baseUrl,
      serviceKey,
      endpoint: `/auth/v1/admin/users?page=${page}&per_page=1000`,
    });
    const pageUsers = Array.isArray(payload?.users) ? payload.users : [];
    users.push(...pageUsers);
    if (pageUsers.length < 1000) break;
    page += 1;
  }
  return users;
};

const fetchStorageBuckets = async ({ baseUrl, serviceKey }) => {
  try {
    const buckets = await requestJson({ baseUrl, serviceKey, endpoint: '/storage/v1/bucket' });
    return Array.isArray(buckets) ? buckets : [];
  } catch (error) {
    return { error: error?.message || String(error) };
  }
};

const main = async () => {
  const env = await loadEnv();
  const baseUrl = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SECRET_KEY || '').trim();
  if (!baseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(process.env.HOME || ROOT_DIR, 'Desktop', `techloc-supabase-migration-${stamp}`);
  const publicJsonDir = path.join(outDir, 'public-data-json');
  const publicCsvDir = path.join(outDir, 'public-data-csv');
  const excludedPulseDir = path.join(outDir, 'excluded-pulse-tables');
  const schemaDir = path.join(outDir, 'schema');
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: {
      supabaseUrl: baseUrl,
      projectRef: String(env.SUPABASE_PROJECT_REF || ''),
    },
    includedTables: {},
    excludedPulseTables: {},
    auth: {},
    storage: {},
    files: {},
    notes: [
      'Main TechLoc export excludes pulse_* tables from the restore path.',
      'excluded-pulse-tables preserves pulse_* rows separately for audit/safety.',
      'Use supabase/migrations plus public-data-json/public-data-csv to rebuild the paid Supabase project.',
    ],
  };

  await ensureDir(outDir);
  await ensureDir(publicJsonDir);
  await ensureDir(publicCsvDir);
  await ensureDir(excludedPulseDir);
  await ensureDir(schemaDir);

  let openApi = null;
  try {
    openApi = await requestJson({ baseUrl, serviceKey, endpoint: '/rest/v1/' });
    await writeJson(path.join(schemaDir, 'postgrest-openapi.json'), openApi);
  } catch (error) {
    manifest.schemaOpenApiError = error?.message || String(error);
  }

  for (const tableName of TECHLOC_TABLES) {
    try {
      const rows = await fetchTableRows({ baseUrl, serviceKey, tableName });
      await writeJson(path.join(publicJsonDir, `${safeName(tableName)}.json`), rows);
      await fs.writeFile(path.join(publicCsvDir, `${safeName(tableName)}.csv`), rowsToCsv(rows));
      manifest.includedTables[tableName] = { rows: rows.length };
      console.log(`[included] ${tableName}: ${rows.length}`);
    } catch (error) {
      manifest.includedTables[tableName] = { error: error?.message || String(error) };
      console.warn(`[included] ${tableName}: ${manifest.includedTables[tableName].error}`);
    }
  }

  for (const tableName of EXCLUDED_PULSE_TABLES) {
    try {
      const rows = await fetchTableRows({ baseUrl, serviceKey, tableName });
      await writeJson(path.join(excludedPulseDir, `${safeName(tableName)}.json`), rows);
      manifest.excludedPulseTables[tableName] = { rows: rows.length };
      console.log(`[excluded:pulse] ${tableName}: ${rows.length}`);
    } catch (error) {
      manifest.excludedPulseTables[tableName] = { error: error?.message || String(error) };
      console.warn(`[excluded:pulse] ${tableName}: ${manifest.excludedPulseTables[tableName].error}`);
    }
  }

  try {
    const users = await fetchAuthUsers({ baseUrl, serviceKey });
    await writeJson(path.join(outDir, 'auth', 'users.admin-export.json'), users);
    manifest.auth.users = users.length;
    console.log(`[auth] users: ${users.length}`);
  } catch (error) {
    manifest.auth.error = error?.message || String(error);
    console.warn(`[auth] ${manifest.auth.error}`);
  }

  const buckets = await fetchStorageBuckets({ baseUrl, serviceKey });
  await writeJson(path.join(outDir, 'storage', 'buckets.json'), buckets);
  manifest.storage.buckets = Array.isArray(buckets) ? buckets.length : buckets;

  await copyDir(path.join(ROOT_DIR, 'supabase', 'migrations'), path.join(outDir, 'supabase', 'migrations'));
  await copyDir(path.join(ROOT_DIR, 'scripts'), path.join(outDir, 'restore-scripts'));
  await writeJson(path.join(outDir, 'config', 'runtime-target.json'), {
    supabaseUrl: baseUrl,
    projectRef: String(env.SUPABASE_PROJECT_REF || ''),
    appOrigin: String(env.APP_ORIGIN || ''),
  });
  await fs.writeFile(path.join(outDir, 'RESTORE_NOTES.md'), [
    '# TechLoc Supabase Migration Package',
    '',
    `Generated: ${manifest.generatedAt}`,
    `Source: ${baseUrl}`,
    '',
    '## Included',
    '',
    '- `public-data-json/`: TechLoc public table rows in JSON.',
    '- `public-data-csv/`: Same rows in CSV for inspection/manual import.',
    '- `auth/users.admin-export.json`: Supabase Auth Admin user export.',
    '- `storage/buckets.json`: Storage bucket metadata.',
    '- `schema/postgrest-openapi.json`: REST schema snapshot.',
    '- `supabase/migrations/`: SQL migrations from this repo.',
    '',
    '## Excluded from TechLoc restore',
    '',
    '`pulse_*` tables are stored under `excluded-pulse-tables/` only. Do not import them into the new TechLoc project unless you intentionally want Pulse data there.',
    '',
  ].join('\n'));

  const files = await listFiles(outDir);
  for (const filePath of files) {
    const rel = path.relative(outDir, filePath);
    manifest.files[rel] = {
      bytes: (await fs.stat(filePath)).size,
      sha256: await sha256File(filePath),
    };
  }
  await writeJson(path.join(outDir, 'MANIFEST.json'), manifest);
  console.log(`[done] ${outDir}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
