import fs from 'node:fs';
import path from 'node:path';

const TARGET_SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const TARGET_SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const ROOT_DIR = path.resolve(new URL('..', import.meta.url).pathname);
const OUTPUT_DIR = path.join(ROOT_DIR, 'migration-output');

if (!TARGET_SUPABASE_URL || !TARGET_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const headers = (prefer = '') => ({
  apikey: TARGET_SERVICE_KEY,
  authorization: `Bearer ${TARGET_SERVICE_KEY}`,
  'content-type': 'application/json',
  ...(prefer ? { Prefer: prefer } : {}),
});

const cleanRows = (rows, generatedColumns) =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row || {}).filter(([key, value]) => !generatedColumns.has(key) && value !== undefined)
    )
  );

async function postBatch({ table, rows, conflict, label }) {
  const response = await fetch(
    `${TARGET_SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?on_conflict=${encodeURIComponent(conflict)}`,
    {
      method: 'POST',
      headers: headers('resolution=ignore-duplicates,return=minimal'),
      body: JSON.stringify(rows),
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${label} failed ${response.status}: ${text.slice(0, 1000)}`);
  }
}

async function migrate({ table, file, conflict, generatedColumns, batchSize }) {
  const rows = cleanRows(
    JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf8')),
    generatedColumns
  );
  let sent = 0;
  const started = Date.now();

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    await postBatch({
      table,
      rows: batch,
      conflict,
      label: `${table} ${index + 1}-${index + batch.length}`,
    });
    sent += batch.length;
    process.stdout.write(`\r${table}: ${sent}/${rows.length}`);
    await sleep(40);
  }

  process.stdout.write('\n');
  return { table, rows: rows.length, ms: Date.now() - started };
}

const results = [];
results.push(await migrate({
  table: 'DealsJP1',
  file: 'missing_dealsjp1.json',
  conflict: 'Current Stock No',
  generatedColumns: new Set(['vin6']),
  batchSize: 100,
}));
results.push(await migrate({
  table: 'PT-LastPing',
  file: 'missing_pt_after_target_max.json',
  conflict: 'Serial,read_day,day_half',
  generatedColumns: new Set(['id', 'read_day', 'day_half', 'vin6']),
  batchSize: 100,
}));

console.log(JSON.stringify({ ok: true, results }, null, 2));
