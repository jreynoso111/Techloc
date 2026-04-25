#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_SUPABASE_URL = '';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = '';

const loadDotEnvFile = () => {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) return;

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
};

loadDotEnvFile();

const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const SUPABASE_URL = String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim().replace(/\/+$/, '');
const deriveProjectRefFromUrl = (url = '') => {
  try {
    const host = new URL(url).hostname || '';
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match?.[1] ? String(match[1]).trim() : '';
  } catch (_error) {
    return '';
  }
};
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY
).trim();
const APP_ORIGIN = String(process.env.APP_ORIGIN || `http://127.0.0.1:${PORT}`).trim().replace(/\/+$/, '');
const SUPABASE_PROJECT_REF = String(
  process.env.SUPABASE_PROJECT_REF || deriveProjectRefFromUrl(SUPABASE_URL) || ''
).trim();
const SUPABASE_DB_HOST = String(process.env.SUPABASE_DB_HOST || '').trim();
const SUPABASE_DB_PORT = String(process.env.SUPABASE_DB_PORT || '5432').trim();
const SUPABASE_DB_NAME = String(process.env.SUPABASE_DB_NAME || 'postgres').trim();
const SUPABASE_DB_USER = String(process.env.SUPABASE_DB_USER || '').trim();
const SUPABASE_DB_PASSWORD = String(process.env.SUPABASE_DB_PASSWORD || '').trim();
const SUPABASE_DB_SSLMODE = String(process.env.SUPABASE_DB_SSLMODE || 'require').trim();
const IS_VERCEL_RUNTIME = String(process.env.VERCEL || '').trim() === '1';
const DIRECT_PG_ENABLED = !IS_VERCEL_RUNTIME && Boolean(SUPABASE_DB_HOST && SUPABASE_DB_USER && SUPABASE_DB_PASSWORD);
const LOCAL_PROXY_PUBLISHABLE_KEY = 'local-techloc-proxy-key';
const PYTHON_BRIDGE_PATH = path.join(ROOT_DIR, 'scripts', 'supabase_pg_bridge.py');
const PYTHON_BIN = String(process.env.PYTHON_BIN || (fs.existsSync('/usr/bin/python3') ? '/usr/bin/python3' : 'python3')).trim();

const REPAIR_HISTORY_TABLE = 'repair_history';
const ALLOWED_ROLES_RAW = String(process.env.REPAIR_HISTORY_ALLOWED_ROLES || '').trim();
const ALLOWED_ROLES = new Set(
  ALLOWED_ROLES_RAW
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const CLIENT_GET_CACHE = new Map();
const CLIENT_GET_CACHE_MAX_ENTRIES = 300;
const DATA_VERSION_STATE = new Map();
const DATA_VERSION_SUBSCRIBERS = new Set();
const DATA_VERSION_HEARTBEAT_MS = 25000;
const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60 * 8;
const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const ACCESS_SESSIONS = new Map();
const REFRESH_SESSIONS = new Map();

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const ALLOWED_REPAIR_FIELDS = new Set([
  'vehicle_id',
  'deal_status',
  'customer_id',
  'unit_type',
  'model_year',
  'model',
  'inv_prep_stat',
  'deal_completion',
  'pt_status',
  'pt_serial',
  'encore_serial',
  'phys_loc',
  'VIN',
  'vehicle_status',
  'days_stationary',
  'short_location',
  'current_stock_no',
  'cs_contact_date',
  'status',
  'doc',
  'shipping_date',
  'poc_name',
  'poc_phone',
  'customer_availability',
  'installer_request_date',
  'installation_company',
  'technician_availability_date',
  'installation_place',
  'repair_price',
  'repair_notes',
  'shortvin',
]);

const json = (res, statusCode, payload) => {
  res.writeHead(statusCode, JSON_HEADERS);
  res.end(JSON.stringify(payload));
};

const now = () => Date.now();

const buildClientCacheKey = ({ pathname = '', search = '', authHeader = '' } = {}) =>
  `${pathname}?${search}::${authHeader || 'anon'}`;

const getClientCacheTtlMs = (pathname = '') => {
  const normalized = String(pathname || '').toLowerCase();
  if (normalized.includes('/api/database/records/services')) return 5 * 60 * 1000;
  if (normalized.includes('/api/database/records/profiles')) return 5 * 60 * 1000;
  if (normalized.includes('/api/database/records/app_settings')) return 10 * 60 * 1000;
  if (normalized.includes('/api/database/records/admin_change_log')) return 60 * 1000;
  return 60 * 1000;
};

const getCachedClientGetResponse = (cacheKey = '') => {
  const entry = CLIENT_GET_CACHE.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= now()) {
    CLIENT_GET_CACHE.delete(cacheKey);
    return null;
  }
  return entry;
};

const setCachedClientGetResponse = (cacheKey = '', entry = null) => {
  if (!cacheKey || !entry) return;
  CLIENT_GET_CACHE.set(cacheKey, entry);
  if (CLIENT_GET_CACHE.size <= CLIENT_GET_CACHE_MAX_ENTRIES) return;
  const oldestKey = CLIENT_GET_CACHE.keys().next().value;
  if (oldestKey) CLIENT_GET_CACHE.delete(oldestKey);
};

const invalidateClientCacheByPathname = (pathname = '') => {
  const normalized = String(pathname || '');
  if (!normalized) return;
  [...CLIENT_GET_CACHE.keys()].forEach((key) => {
    if (key.startsWith(`${normalized}?`)) {
      CLIENT_GET_CACHE.delete(key);
    }
  });
};

const normalizeDataScope = (value = '') => String(value || '').trim().toLowerCase();

const normalizeDataTableName = (value = '') => {
  const normalized = normalizeDataScope(value);
  return normalized ? normalized.replace(/\s+/g, '_') : '';
};

const getDataVersionEntry = (tableName = '') => {
  const normalized = normalizeDataTableName(tableName);
  if (!normalized) return null;
  const existing = DATA_VERSION_STATE.get(normalized);
  if (existing) return existing;
  const initial = {
    table: normalized,
    version: 1,
    updatedAt: new Date(0).toISOString(),
    reason: 'initial',
  };
  DATA_VERSION_STATE.set(normalized, initial);
  return initial;
};

const buildDataVersionSnapshot = (tables = []) => {
  const normalizedTables = Array.isArray(tables)
    ? [...new Set(tables.map(normalizeDataTableName).filter(Boolean))]
    : [];

  if (!normalizedTables.length) {
    return {
      versions: Object.fromEntries(
        [...DATA_VERSION_STATE.entries()].map(([table, entry]) => [table, entry])
      ),
      emittedAt: new Date().toISOString(),
    };
  }

  const versions = {};
  normalizedTables.forEach((table) => {
    versions[table] = getDataVersionEntry(table);
  });
  return {
    versions,
    emittedAt: new Date().toISOString(),
  };
};

const shouldNotifySubscriber = (subscriber, changedTables = [], scope = 'tables') => {
  if (!subscriber) return false;
  if (scope === 'all') return true;
  if (!Array.isArray(changedTables) || !changedTables.length) return true;
  if (!subscriber.tables?.size) return true;
  return changedTables.some((table) => subscriber.tables.has(normalizeDataTableName(table)));
};

const writeSseEvent = (res, eventName, payload) => {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const notifyDataVersionSubscribers = ({ tables = [], scope = 'tables', reason = 'write' } = {}) => {
  const normalizedTables = [...new Set((tables || []).map(normalizeDataTableName).filter(Boolean))];
  const snapshot = buildDataVersionSnapshot(normalizedTables);
  const payload = {
    scope,
    reason,
    tables: normalizedTables,
    snapshot,
  };

  [...DATA_VERSION_SUBSCRIBERS].forEach((subscriber) => {
    if (!shouldNotifySubscriber(subscriber, normalizedTables, scope)) return;
    try {
      writeSseEvent(subscriber.res, 'version', payload);
    } catch (_error) {
      DATA_VERSION_SUBSCRIBERS.delete(subscriber);
      clearInterval(subscriber.heartbeat);
    }
  });
};

const bumpDataVersions = ({ tables = [], scope = 'tables', reason = 'write' } = {}) => {
  const normalizedTables = [...new Set((tables || []).map(normalizeDataTableName).filter(Boolean))];
  const changedTables = [];

  if (scope === 'all') {
    DATA_VERSION_STATE.forEach((entry, table) => {
      const nextEntry = {
        table,
        version: Number(entry?.version || 0) + 1,
        updatedAt: new Date().toISOString(),
        reason,
      };
      DATA_VERSION_STATE.set(table, nextEntry);
      changedTables.push(table);
    });
    notifyDataVersionSubscribers({ tables: changedTables, scope, reason });
    return;
  }

  normalizedTables.forEach((table) => {
    const current = getDataVersionEntry(table);
    const nextEntry = {
      table,
      version: Number(current?.version || 0) + 1,
      updatedAt: new Date().toISOString(),
      reason,
    };
    DATA_VERSION_STATE.set(table, nextEntry);
    changedTables.push(table);
  });

  if (changedTables.length) {
    notifyDataVersionSubscribers({ tables: changedTables, scope, reason });
  }
};

const extractTablesFromVersionQuery = (searchParams) => {
  const rawTables = String(searchParams.get('tables') || '').trim();
  return rawTables
    .split(',')
    .map((value) => normalizeDataTableName(value))
    .filter(Boolean);
};

const INTERNAL_ROUTE_QUERY_KEYS = new Set([
  'slug',
  'segment1',
  'segment2',
  'segment3',
  'table',
  'functionName',
  'action',
]);

const sanitizeSearchParams = (searchParams) => {
  const nextParams = new URLSearchParams(searchParams);
  [...INTERNAL_ROUTE_QUERY_KEYS].forEach((key) => {
    nextParams.delete(key);
  });
  return nextParams;
};

const getTableNameFromDatabasePath = (pathname = '') => {
  const match = String(pathname || '').match(/^\/api\/database\/records\/([^/]+)/i);
  if (!match?.[1]) return '';
  return normalizeDataTableName(decodeURIComponent(match[1]));
};

const DATABASE_ROLES = {
  ACTIVE_USER: 'active_user',
  ADMINISTRATOR: 'administrator',
};

const normalizeAccessName = (value = '') => String(value || '').trim().toLowerCase();

const makeSet = (values = []) => new Set(values.map((value) => String(value || '').trim()).filter(Boolean));
const withoutColumns = (columns = new Set(), blocked = []) => {
  const blockedSet = makeSet(blocked);
  return new Set([...columns].filter((column) => !blockedSet.has(column)));
};

const PROFILE_PUBLIC_COLUMNS = makeSet([
  'id',
  'email',
  'name',
  'role',
  'status',
  'background_mode',
  'created_at',
  'updated_at',
]);

const VEHICLE_WRITE_COLUMNS = makeSet([
  'gps fix',
  'gps fix reason',
  'gps_fix',
  'gps_fix_reason',
  'gps_moving',
  'moving',
  'movement_status_v2',
  'movement_days_stationary_v2',
  'movement_threshold_meters_v2',
  'movement_unit_type_v2',
  'movement_computed_at_v2',
  'pt_first_read',
  'pt_last_read',
  'pt_last_lat',
  'pt_last_long',
  'pt_last_address',
  'pt_last_city',
  'pt_last_serial',
  'days_stationary',
  'short_location',
  'updated_at',
]);

const PT_LASTPING_WRITE_COLUMNS = makeSet([
  'VIN',
  'vehicle_id',
  'moved_v2',
  'days_stationary_v2',
]);

const VEHICLE_COLUMNS = makeSet([
  'deal status', 'customer id', 'unit type', 'model year', 'model', 'shortvin', 'inv. prep. stat.',
  'deal completion', 'gps fix', 'gps fix reason', 'pt status', 'pt serial', 'encore serial', 'moving',
  'pt last read', 'state loc', 'pt city', 'pt zipcode', 'lat', 'long', 'phys_loc', 'Current Stock No',
  'id', 'VIN', 'Vehicle Status', 'Open Balance', 'Oldest Invoice (Open)', 'days_stationary',
  'short_location', 'CDL State', 'Real ID?', 'CDL Note', 'Visit Exp.', 'CDL Exp Date', 'SSN',
  'Green Card', 'Passport', 'Work Permit Expires', 'repo notes', 'Last Update', 'Schdl To repair?',
  'Last_repo_date', 'pt first read', 'movement_status_v2', 'movement_days_stationary_v2',
  'movement_computed_at_v2', 'movement_threshold_meters_v2', 'movement_unit_type_v2',
]);

const DEALSJP1_COLUMNS = makeSet([
  'Deal Status', 'Deal Date', 'HOLD', 'Current Stock No', 'Customer', 'Brand', 'Model', 'Model Year',
  'VIN', 'Corrected VIN', 'Vehicle Status', 'Mileage', 'Driver License #',
  'Inventory Preparation Status', 'Inventory Preparation Status Changed On',
  'Inventory Preparation Status Changed By', 'Physical Location', 'Physical Location Last Changed on',
  'ENTITY', 'Retail Price On Contract', 'Cash Down', 'Total due on Deal', 'Amount',
  'Reg. Contract Payment', 'Payment Schedule', 'Total Payments in Months',
  'Number OF Schedule Remaining', 'Lead Source', 'Date of Birth', 'TAM Legacy Created Date',
  'Payment Schedule Start', 'Last Payment Date', 'TAM Legacy Stock #', 'Trade In VIN',
  'Trade In Amount', 'Sales Person', 'Subsidiary', 'Location', 'Lease End Date', 'Bucket',
  'Bucket Sub Type', 'Payment Schedule_1', 'Lease Term', 'Regular Amount',
  'Total Contract Scheduled Amount', 'Inventory Valuation Value', 'Sales Channel', 'Partner Name',
  'Remaining Scheduled Payments To Invoice', 'Deposit', 'PassTime Serial No',
  'PassTime Vehicle Status', 'EFT Available', 'Primary Payment Mode', 'Secondary Payment Mode',
  'Plate Number', 'Mobile Phone', 'Encore Serial Number', 'Encore Serial #2', 'GPS Serial No',
  'Plate Number_1', 'Current Title Number', 'Current Title Subsidiary',
  'Current Title Physical Location', 'Title In Date', 'Title Out Date', 'Financing Company',
  'Broker', 'Return Type', 'Actual System Return Date', 'Returned By',
  'Number OF Schedule Remaining_1', 'Unit Type', 'Open Balance', 'id', 'Last Deal',
  'Oldest Invoice (Open)', 'Calc.End', 'gps_status', 'gps_status_updated_at', 'gps_review_flag',
  'Deal Completion',
]);

const PT_LASTPING_COLUMNS = makeSet([
  'Serial', 'Year', 'Make', 'Model', 'Color', 'Customer', 'Vehicle Status', 'VIN', 'Date', 'address',
  'Lat', 'Long', 'city_bucket', 'moved', 'days_stationary', 'read_day', 'city_previous',
  'vehicle_id', 'id', 'day_half', 'moved_v2', 'days_stationary_v2',
]);

const SERVICES_COLUMNS = makeSet([
  'company_name', 'region', 'phone', 'contact', 'email', 'website', 'availability', 'notes', 'city',
  'state', 'zip', 'category', 'type', 'authorization', 'address', 'status', 'lat', 'long', 'id',
  'verified',
]);

const HOTSPOT_COLUMNS = makeSet(['id', 'created_at', 'State', 'City', 'Zip', 'Lat', 'Long', 'Radius']);

const SERVICES_BLACKLIST_COLUMNS = makeSet([
  'id', 'created_at', 'company_name', 'category', 'lat', 'long', 'Assoc.Unit', 'Note', 'State',
  'City', 'Zip', 'Event date', 'Alarm', 'address',
]);

const GPS_BLACKLIST_COLUMNS = makeSet(['serial', 'reason', 'is_active', 'added_at', 'added_by', 'uuid', 'effective_from']);

const USER_TABLE_CONFIG_COLUMNS = makeSet(['id', 'user_id', 'table_key', 'table_name', 'config', 'created_at', 'updated_at']);

const SERVICES_REQUEST_COLUMNS = makeSet([
  'id', 'company_name', 'company phone', 'doc', 'unittype', 'brand', 'model', 'model year', 'shortvin',
  'status', 'quote', 'request date', 'workdate', 'shipping date', 'poc name', 'poc phone', 'confirmed',
  'state', 'city', 'zip', 'address', 'Service_category', 'Notes', 'POC email', 'created_at', 'updated_at',
]);

const SERVICES_CATEGORIES_COLUMNS = makeSet(['id', 'category', 'created_at', 'updated_at']);

const VEHICLE_PUBLIC_READ_COLUMNS = withoutColumns(VEHICLE_COLUMNS, [
  'CDL State', 'Real ID?', 'CDL Note', 'Visit Exp.', 'CDL Exp Date', 'SSN', 'Green Card',
  'Passport', 'Work Permit Expires',
]);

const DEALSJP1_PUBLIC_READ_COLUMNS = withoutColumns(DEALSJP1_COLUMNS, [
  'Driver License #', 'Date of Birth', 'Mobile Phone',
]);

const TABLE_ACCESS_POLICIES = new Map(Object.entries({
  app_settings: {
    methods: {
      GET: DATABASE_ROLES.ACTIVE_USER,
      HEAD: DATABASE_ROLES.ACTIVE_USER,
      POST: DATABASE_ROLES.ADMINISTRATOR,
      PATCH: DATABASE_ROLES.ADMINISTRATOR,
    },
    readableColumns: makeSet(['key', 'settings', 'updated_at', 'created_at', 'updated_by']),
    writableColumns: makeSet(['key', 'settings', 'updated_by']),
  },
  services: {
    methods: {
      GET: DATABASE_ROLES.ACTIVE_USER,
      HEAD: DATABASE_ROLES.ACTIVE_USER,
      POST: DATABASE_ROLES.ADMINISTRATOR,
      PATCH: DATABASE_ROLES.ADMINISTRATOR,
      DELETE: DATABASE_ROLES.ADMINISTRATOR,
    },
    readableColumns: SERVICES_COLUMNS,
    writableColumns: SERVICES_COLUMNS,
  },
  hotspots: {
    methods: {
      GET: DATABASE_ROLES.ACTIVE_USER,
      HEAD: DATABASE_ROLES.ACTIVE_USER,
      POST: DATABASE_ROLES.ADMINISTRATOR,
      PATCH: DATABASE_ROLES.ADMINISTRATOR,
      DELETE: DATABASE_ROLES.ADMINISTRATOR,
    },
    readableColumns: HOTSPOT_COLUMNS,
    writableColumns: HOTSPOT_COLUMNS,
  },
  services_blacklist: {
    methods: {
      GET: DATABASE_ROLES.ACTIVE_USER,
      HEAD: DATABASE_ROLES.ACTIVE_USER,
      POST: DATABASE_ROLES.ADMINISTRATOR,
      PATCH: DATABASE_ROLES.ADMINISTRATOR,
      DELETE: DATABASE_ROLES.ADMINISTRATOR,
    },
    readableColumns: SERVICES_BLACKLIST_COLUMNS,
    writableColumns: SERVICES_BLACKLIST_COLUMNS,
  },
  gps_blacklist: {
    methods: {
      GET: DATABASE_ROLES.ACTIVE_USER,
      HEAD: DATABASE_ROLES.ACTIVE_USER,
      POST: DATABASE_ROLES.ADMINISTRATOR,
      PATCH: DATABASE_ROLES.ADMINISTRATOR,
      DELETE: DATABASE_ROLES.ADMINISTRATOR,
    },
    readableColumns: GPS_BLACKLIST_COLUMNS,
    writableColumns: GPS_BLACKLIST_COLUMNS,
  },
  control_map_vehicle_clicks: {
    methods: {
      GET: DATABASE_ROLES.ACTIVE_USER,
      HEAD: DATABASE_ROLES.ACTIVE_USER,
      POST: DATABASE_ROLES.ACTIVE_USER,
    },
    readableColumns: makeSet(['id', 'user_id', 'vin', 'clicked_at', 'source', 'page', 'action', 'metadata', 'created_at']),
    writableColumns: makeSet(['user_id', 'vin', 'clicked_at', 'source', 'page', 'action', 'metadata']),
  },
  user_table_configs: {
    methods: {
      GET: DATABASE_ROLES.ACTIVE_USER,
      HEAD: DATABASE_ROLES.ACTIVE_USER,
      POST: DATABASE_ROLES.ACTIVE_USER,
      PATCH: DATABASE_ROLES.ACTIVE_USER,
      DELETE: DATABASE_ROLES.ACTIVE_USER,
    },
    readableColumns: USER_TABLE_CONFIG_COLUMNS,
    writableColumns: USER_TABLE_CONFIG_COLUMNS,
  },
  titles: {
    methods: {
      GET: DATABASE_ROLES.ADMINISTRATOR,
      HEAD: DATABASE_ROLES.ADMINISTRATOR,
      POST: DATABASE_ROLES.ADMINISTRATOR,
      PATCH: DATABASE_ROLES.ADMINISTRATOR,
      DELETE: DATABASE_ROLES.ADMINISTRATOR,
    },
    allowWildcardRead: true,
    allowWildcardWrite: true,
  },
  services_request: {
    methods: {
      GET: DATABASE_ROLES.ACTIVE_USER,
      HEAD: DATABASE_ROLES.ACTIVE_USER,
      POST: DATABASE_ROLES.ACTIVE_USER,
      PATCH: DATABASE_ROLES.ACTIVE_USER,
      DELETE: DATABASE_ROLES.ACTIVE_USER,
    },
    readableColumns: SERVICES_REQUEST_COLUMNS,
    writableColumns: SERVICES_REQUEST_COLUMNS,
  },
  services_categories: {
    methods: {
      GET: DATABASE_ROLES.ACTIVE_USER,
      HEAD: DATABASE_ROLES.ACTIVE_USER,
      POST: DATABASE_ROLES.ADMINISTRATOR,
      PATCH: DATABASE_ROLES.ADMINISTRATOR,
      DELETE: DATABASE_ROLES.ADMINISTRATOR,
    },
    readableColumns: SERVICES_CATEGORIES_COLUMNS,
    writableColumns: SERVICES_CATEGORIES_COLUMNS,
  },
  vehicles: {
    // Vehicle writes alter operational fleet state; keep them admin-only through this generic data API.
    methods: {
      GET: DATABASE_ROLES.ACTIVE_USER,
      HEAD: DATABASE_ROLES.ACTIVE_USER,
      POST: DATABASE_ROLES.ADMINISTRATOR,
      PATCH: DATABASE_ROLES.ADMINISTRATOR,
      DELETE: DATABASE_ROLES.ADMINISTRATOR,
    },
    readableColumns: VEHICLE_PUBLIC_READ_COLUMNS,
    adminReadableColumns: VEHICLE_COLUMNS,
    writableColumns: VEHICLE_COLUMNS,
  },
  dealsjp1: {
    // DealsJP1 ingestion and edits are admin-only. Bulk upload uses /api/admin/deals/upload.
    methods: {
      GET: DATABASE_ROLES.ACTIVE_USER,
      HEAD: DATABASE_ROLES.ACTIVE_USER,
      POST: DATABASE_ROLES.ADMINISTRATOR,
      PATCH: DATABASE_ROLES.ADMINISTRATOR,
      DELETE: DATABASE_ROLES.ADMINISTRATOR,
    },
    readableColumns: DEALSJP1_PUBLIC_READ_COLUMNS,
    adminReadableColumns: DEALSJP1_COLUMNS,
    writableColumns: DEALSJP1_COLUMNS,
  },
  'pt-lastping': {
    // PT-LastPing updates recalculate vehicle movement; non-admin reads are allowed for the control map only.
    methods: {
      GET: DATABASE_ROLES.ACTIVE_USER,
      HEAD: DATABASE_ROLES.ACTIVE_USER,
      POST: DATABASE_ROLES.ADMINISTRATOR,
      PATCH: DATABASE_ROLES.ADMINISTRATOR,
      DELETE: DATABASE_ROLES.ADMINISTRATOR,
    },
    readableColumns: PT_LASTPING_COLUMNS,
    writableColumns: PT_LASTPING_COLUMNS,
  },
  profiles: {
    methods: {
      GET: DATABASE_ROLES.ADMINISTRATOR,
      HEAD: DATABASE_ROLES.ADMINISTRATOR,
      PATCH: DATABASE_ROLES.ADMINISTRATOR,
    },
    readableColumns: PROFILE_PUBLIC_COLUMNS,
    writableColumns: makeSet(['email', 'name', 'role', 'status', 'background_mode']),
  },
  admin_change_log: {
    methods: {
      GET: DATABASE_ROLES.ADMINISTRATOR,
      HEAD: DATABASE_ROLES.ADMINISTRATOR,
      POST: DATABASE_ROLES.ADMINISTRATOR,
    },
    readableColumns: makeSet(['id', 'table_name', 'action', 'summary', 'actor', 'record_id', 'column_name', 'previous_value', 'new_value', 'profile_email', 'profile_role', 'profile_status', 'page_path', 'source', 'details', 'created_at']),
    writableColumns: makeSet(['table_name', 'action', 'summary', 'actor', 'record_id', 'column_name', 'previous_value', 'new_value', 'profile_email', 'profile_role', 'profile_status', 'page_path', 'source', 'details', 'created_at']),
  },
  repair_history: {
    methods: {
      GET: DATABASE_ROLES.ACTIVE_USER,
      HEAD: DATABASE_ROLES.ACTIVE_USER,
      POST: DATABASE_ROLES.ACTIVE_USER,
      PATCH: DATABASE_ROLES.ACTIVE_USER,
      DELETE: DATABASE_ROLES.ACTIVE_USER,
    },
    allowWildcardRead: true,
    writableColumns: ALLOWED_REPAIR_FIELDS,
  },
}));

const RPC_ACCESS_POLICIES = new Map(Object.entries({
  update_vehicle_gps_fields: {
    role: DATABASE_ROLES.ADMINISTRATOR,
    args: makeSet(['p_vehicle_id', 'p_gps_fix', 'p_gps_fix_reason']),
  },
  refresh_vehicle_movement_v2: {
    role: DATABASE_ROLES.ADMINISTRATOR,
    args: makeSet(['p_vin']),
  },
  finalize_pt_lastping_upload: {
    role: DATABASE_ROLES.ADMINISTRATOR,
    args: makeSet(['p_vins', 'p_min_id_exclusive']),
  },
  recalc_dealsjp1_last_deal: {
    role: DATABASE_ROLES.ADMINISTRATOR,
    args: makeSet([]),
  },
  sync_vehicles_from_dealsjp1_lastdeal: {
    role: DATABASE_ROLES.ADMINISTRATOR,
    args: makeSet([]),
  },
}));

const shouldUseServiceRoleForPublicDatabaseRead = ({
  pathname = '',
  method = 'GET',
} = {}) => {
  if (!['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase())) return false;
  const tableName = getTableNameFromDatabasePath(pathname);
  const policy = getDatabaseTablePolicy(tableName);
  return Boolean(policy?.useServiceRoleForRead);
};

const getRpcNameFromDatabasePath = (pathname = '') => {
  const match = String(pathname || '').match(/^\/api\/database\/rpc\/([^/]+)/i);
  if (!match?.[1]) return '';
  return String(decodeURIComponent(match[1]) || '').trim().toLowerCase();
};

const getDatabaseTablePolicy = (tableName = '') =>
  TABLE_ACCESS_POLICIES.get(normalizeAccessName(tableName));

const getDatabaseRpcPolicy = (rpcName = '') =>
  RPC_ACCESS_POLICIES.get(normalizeAccessName(rpcName));

const splitSelectColumns = (selectClause = '') => {
  const raw = String(selectClause || '*').trim();
  if (!raw || raw === '*') return ['*'];
  const columns = [];
  let current = '';
  let quoted = false;
  for (const char of raw) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === ',' && !quoted) {
      if (current.trim()) columns.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) columns.push(current.trim());
  return columns.map((column) => {
    const trimmed = column.trim();
    return trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1).replace(/""/g, '"')
      : trimmed;
  });
};

const formatSelectColumn = (column = '') =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(column) ? column : `"${String(column).replace(/"/g, '""')}"`;

const buildAllowedSelectClause = (policy = {}) =>
  [...(policy.readableColumns || [])].map(formatSelectColumn).join(',');

const collectBodyColumns = (body = null) => {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body)) {
    return [...new Set(body.flatMap((row) => (
      row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : []
    )))];
  }
  return Object.keys(body);
};

const hasRequiredDatabaseRole = (auth, requiredRole) => {
  const role = String(auth?.profile?.role || 'user').toLowerCase();
  const status = String(auth?.profile?.status || 'active').toLowerCase();
  if (requiredRole === DATABASE_ROLES.ADMINISTRATOR) {
    return role === 'administrator' && status === 'active';
  }
  return status !== 'suspended';
};

const validateAllowedColumns = ({
  columns = [],
  allowedColumns = new Set(),
  allowWildcard = false,
  message = 'Column is not allowed.',
} = {}) => {
  for (const column of columns) {
    if (column === '*' && allowWildcard) continue;
    if (column === '*' || !allowedColumns.has(column)) {
      return `${message}: ${column}`;
    }
  }
  return '';
};

const getReadableColumnsForPolicy = (policy = {}, auth = null) => {
  const role = String(auth?.profile?.role || 'user').toLowerCase();
  const status = String(auth?.profile?.status || 'active').toLowerCase();
  if (role === 'administrator' && status === 'active' && policy.adminReadableColumns?.size) {
    return policy.adminReadableColumns;
  }
  return policy.readableColumns || new Set();
};

const enforceDatabaseAccessPolicy = async ({
  req,
  res,
  pathname = '',
  method = 'GET',
  searchParams = new URLSearchParams(),
  body = null,
} = {}) => {
  const auth = await requireActiveUser(req, res);
  if (!auth) return null;

  if (pathname.startsWith('/api/database/records/')) {
    const tableName = getTableNameFromDatabasePath(pathname);
    const policy = getDatabaseTablePolicy(tableName);
    if (!policy) {
      json(res, 403, { error: { message: `Table is not allowed through this API: ${tableName || 'unknown'}.` } });
      return null;
    }

    const requiredRole = policy.methods?.[method];
    if (!requiredRole) {
      json(res, 403, { error: { message: `${method} is not allowed for table ${tableName}.` } });
      return null;
    }
    if (!hasRequiredDatabaseRole(auth, requiredRole)) {
      json(res, 403, { error: { message: requiredRole === DATABASE_ROLES.ADMINISTRATOR ? 'Active administrator role is required.' : 'Active session is required.' } });
      return null;
    }

    if (method === 'GET' || method === 'HEAD') {
      const readableColumns = getReadableColumnsForPolicy(policy, auth);
      const requestedSelect = String(searchParams.get('select') || '*').trim();
      if ((requestedSelect === '*' || !requestedSelect) && !policy.allowWildcardRead && readableColumns.size) {
        searchParams.set('select', buildAllowedSelectClause({ readableColumns }));
      }
      const selectColumns = splitSelectColumns(searchParams.get('select') || '*');
      const columnError = validateAllowedColumns({
        columns: selectColumns,
        allowedColumns: readableColumns,
        allowWildcard: policy.allowWildcardRead === true,
        message: 'Read column is not allowed',
      });
      if (columnError) {
        json(res, 403, { error: { message: columnError } });
        return null;
      }
    } else {
      if (['PATCH', 'DELETE'].includes(method)) {
        const filterKeys = [...searchParams.keys()].filter((key) => !['select', 'limit', 'offset', 'order', 'on_conflict'].includes(key));
        if (!filterKeys.length) {
          json(res, 403, { error: { message: `${method} requires at least one filter.` } });
          return null;
        }
      }
      const writeColumns = collectBodyColumns(body);
      const columnError = validateAllowedColumns({
        columns: writeColumns,
        allowedColumns: policy.writableColumns || new Set(),
        allowWildcard: policy.allowWildcardWrite === true,
        message: 'Write column is not allowed',
      });
      if (columnError) {
        json(res, 403, { error: { message: columnError } });
        return null;
      }
    }

    return auth;
  }

  if (pathname.startsWith('/api/database/rpc/')) {
    const rpcName = getRpcNameFromDatabasePath(pathname);
    const policy = getDatabaseRpcPolicy(rpcName);
    if (!policy) {
      json(res, 403, { error: { message: `RPC is not allowed through this API: ${rpcName || 'unknown'}.` } });
      return null;
    }
    if (!hasRequiredDatabaseRole(auth, policy.role)) {
      json(res, 403, { error: { message: 'Active administrator role is required.' } });
      return null;
    }
    const argNames = Object.keys(body && typeof body === 'object' && !Array.isArray(body) ? body : {});
    const argError = validateAllowedColumns({
      columns: argNames,
      allowedColumns: policy.args || new Set(),
      allowWildcard: false,
      message: 'RPC argument is not allowed',
    });
    if (argError) {
      json(res, 403, { error: { message: argError } });
      return null;
    }
    return auth;
  }

  return auth;
};

const handleDataVersionApi = async (req, res, pathname, searchParams) => {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    json(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }

  const tables = extractTablesFromVersionQuery(searchParams);
  if (pathname === '/api/data-version/snapshot') {
    json(res, 200, {
      data: buildDataVersionSnapshot(tables),
    });
    return;
  }

  if (pathname !== '/api/data-version/stream') {
    json(res, 404, { error: { message: 'Not found.' } });
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const subscriber = {
    res,
    tables: new Set(tables),
    heartbeat: null,
  };
  DATA_VERSION_SUBSCRIBERS.add(subscriber);

  writeSseEvent(res, 'ready', {
    ok: true,
    snapshot: buildDataVersionSnapshot(tables),
  });

  subscriber.heartbeat = setInterval(() => {
    try {
      res.write(`: keep-alive ${Date.now()}\n\n`);
    } catch (_error) {
      clearInterval(subscriber.heartbeat);
      DATA_VERSION_SUBSCRIBERS.delete(subscriber);
    }
  }, DATA_VERSION_HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(subscriber.heartbeat);
    DATA_VERSION_SUBSCRIBERS.delete(subscriber);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
};

const CLIENT_RUNTIME_CONFIG_GLOBAL = '__TECHLOC_RUNTIME_CONFIG__';

const buildClientRuntimeConfig = () => ({
  supabaseUrl: APP_ORIGIN,
  supabaseAnonKey: SUPABASE_ANON_KEY || LOCAL_PROXY_PUBLISHABLE_KEY,
  supabaseProjectRef: SUPABASE_PROJECT_REF,
  insforgeUrl: APP_ORIGIN,
  insforgeAnonKey: SUPABASE_ANON_KEY || LOCAL_PROXY_PUBLISHABLE_KEY,
  insforgeProjectRef: SUPABASE_PROJECT_REF,
  provider: DIRECT_PG_ENABLED ? 'supabase' : 'insforge',
});

const renderClientRuntimeConfigScript = () => {
  const payload = JSON.stringify(buildClientRuntimeConfig()).replace(/</g, '\\u003c');
  return `<script>window.${CLIENT_RUNTIME_CONFIG_GLOBAL}=${payload};</script>`;
};

const injectRuntimeConfigIntoHtml = (html = '') => {
  if (!html) return html;
  const scriptTag = renderClientRuntimeConfigScript();
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${scriptTag}\n</head>`);
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${scriptTag}\n</body>`);
  }
  return `${scriptTag}\n${html}`;
};

const normalizeVin = (value) =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(-17);

const sanitizeRepairPayload = (input) => {
  if (!input || typeof input !== 'object') return {};
  const payload = {};
  Object.entries(input).forEach(([key, value]) => {
    if (!ALLOWED_REPAIR_FIELDS.has(key)) return;
    if (value === undefined) return;
    payload[key] = value;
  });
  if (payload.VIN) {
    payload.VIN = normalizeVin(payload.VIN);
  }
  if (payload.shortvin) {
    payload.shortvin = normalizeVin(payload.shortvin).slice(-6);
  } else if (payload.VIN) {
    payload.shortvin = payload.VIN.slice(-6);
  }
  return payload;
};

const parseJsonBody = async (req) =>
  new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_error) {
        reject(new Error('Invalid JSON payload.'));
      }
    });
    req.on('error', reject);
  });

const readRawBody = async (req) =>
  new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : null));
    req.on('error', reject);
  });

const getBearerToken = (req) => {
  const raw = String(req.headers.authorization || '');
  if (!raw.toLowerCase().startsWith('bearer ')) return '';
  return raw.slice(7).trim();
};

const supabaseRequest = async (
  endpoint,
  { method = 'GET', body = null, headers = {}, authToken = SUPABASE_SERVICE_ROLE_KEY } = {}
) => {
  const requestHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${authToken}`,
    ...headers,
  };
  const requestOptions = {
    method,
    headers: requestHeaders,
  };
  if (body !== null) {
    requestOptions.body = JSON.stringify(body);
    requestHeaders['content-type'] = 'application/json';
  }
  return fetch(`${SUPABASE_URL}${endpoint}`, requestOptions);
};

const supabaseUserRequest = async (
  endpoint,
  accessToken,
  { method = 'GET', body = null, headers = {} } = {}
) => {
  const requestHeaders = {
    apikey: SUPABASE_ANON_KEY,
    authorization: `Bearer ${accessToken}`,
    ...headers,
  };
  const requestOptions = {
    method,
    headers: requestHeaders,
  };
  if (body !== null) {
    requestOptions.body = JSON.stringify(body);
    requestHeaders['content-type'] = 'application/json';
  }
  return fetch(`${SUPABASE_URL}${endpoint}`, requestOptions);
};

const parseSupabaseError = async (response) => {
  try {
    const payload = await response.json();
    const message = payload?.message || payload?.msg || `Supabase request failed (${response.status}).`;
    return { message, details: payload };
  } catch (_error) {
    const text = await response.text();
    return {
      message: text || `Supabase request failed (${response.status}).`,
      details: null,
    };
  }
};

const chunkArray = (items = [], chunkSize = 100) => {
  const safeChunkSize = Math.max(1, Number(chunkSize) || 100);
  const chunks = [];
  for (let index = 0; index < items.length; index += safeChunkSize) {
    chunks.push(items.slice(index, index + safeChunkSize));
  }
  return chunks;
};

const normalizePostgrestBulkRows = (rows = []) => {
  const sourceRows = Array.isArray(rows) ? rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row)) : [];
  if (!sourceRows.length) return [];

  const orderedKeys = [];
  const seenKeys = new Set();
  sourceRows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      orderedKeys.push(key);
    });
  });

  return sourceRows.map((row) => {
    const normalizedRow = {};
    orderedKeys.forEach((key) => {
      normalizedRow[key] = Object.prototype.hasOwnProperty.call(row, key) ? row[key] : null;
    });
    return normalizedRow;
  });
};

const runPgBridge = async (payload = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [PYTHON_BRIDGE_PATH], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        SUPABASE_DB_HOST,
        SUPABASE_DB_PORT,
        SUPABASE_DB_NAME,
        SUPABASE_DB_USER,
        SUPABASE_DB_PASSWORD,
        SUPABASE_DB_SSLMODE,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Bridge exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout || '{}');
        if (parsed?.error) {
          const bridgeError = new Error(parsed.error?.message || 'Database bridge request failed.');
          bridgeError.status = Number(parsed.error?.status || 500);
          reject(bridgeError);
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
};

const buildSessionUser = (bundle = null) => {
  if (!bundle?.id) return null;
  return {
    id: bundle.id,
    email: bundle.email || null,
    app_metadata: bundle.raw_app_meta_data || {},
    user_metadata: bundle.raw_user_meta_data || {},
    profile: {
      role: bundle.role || 'user',
      status: bundle.status || 'active',
      email: bundle.email || null,
      name: bundle.name || null,
      background_mode: bundle.background_mode || 'auto',
    },
  };
};

const createLocalSession = (bundle = null) => {
  const user = buildSessionUser(bundle);
  if (!user?.id) return null;
  const accessToken = randomBytes(24).toString('hex');
  const refreshToken = randomBytes(32).toString('hex');
  const session = {
    userId: user.id,
    user,
    accessToken,
    refreshToken,
    accessExpiresAt: now() + ACCESS_TOKEN_TTL_MS,
    refreshExpiresAt: now() + REFRESH_TOKEN_TTL_MS,
  };
  ACCESS_SESSIONS.set(accessToken, session);
  REFRESH_SESSIONS.set(refreshToken, session);
  return session;
};

const readAccessSession = (token = '') => {
  const session = ACCESS_SESSIONS.get(String(token || '').trim());
  if (!session) return null;
  if (session.accessExpiresAt <= now()) {
    ACCESS_SESSIONS.delete(session.accessToken);
    return null;
  }
  return session;
};

const readRefreshSession = (token = '') => {
  const session = REFRESH_SESSIONS.get(String(token || '').trim());
  if (!session) return null;
  if (session.refreshExpiresAt <= now()) {
    REFRESH_SESSIONS.delete(session.refreshToken);
    ACCESS_SESSIONS.delete(session.accessToken);
    return null;
  }
  return session;
};

const destroyLocalSession = (session = null) => {
  if (!session) return;
  ACCESS_SESSIONS.delete(session.accessToken);
  REFRESH_SESSIONS.delete(session.refreshToken);
};

const decodeJwtPayload = (token) => {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded = Buffer.from(normalized + padding, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (_error) {
    return null;
  }
};

const validateConfig = () => {
  const missing = [];
  if (!DIRECT_PG_ENABLED) {
    if (!SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY)');
  } else {
    if (!SUPABASE_DB_HOST) missing.push('SUPABASE_DB_HOST');
    if (!SUPABASE_DB_USER) missing.push('SUPABASE_DB_USER');
    if (!SUPABASE_DB_PASSWORD) missing.push('SUPABASE_DB_PASSWORD');
  }
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (!DIRECT_PG_ENABLED) {
    try {
      new URL(SUPABASE_URL).hostname;
    } catch (_error) {
      throw new Error(`Invalid SUPABASE_URL: ${SUPABASE_URL}`);
    }
  }

  let appOriginUrl = null;
  try {
    appOriginUrl = new URL(APP_ORIGIN);
  } catch (_error) {
    throw new Error(`Invalid APP_ORIGIN: ${APP_ORIGIN}`);
  }
  if (!['http:', 'https:'].includes(appOriginUrl.protocol)) {
    throw new Error(`Blocked APP_ORIGIN protocol: ${appOriginUrl.protocol}`);
  }
};

const buildResetPasswordRedirect = () =>
  new URL('/pages/reset-password.html', `${APP_ORIGIN}/`).toString();

const getUserFromAccessToken = async (token) => {
  if (!token) return null;
  if (DIRECT_PG_ENABLED) {
    const session = readAccessSession(token);
    return session?.user || null;
  }
  const keyForValidation = SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: keyForValidation,
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
  return response.json();
};

const getUserProfile = async (userId, accessToken = '') => {
  if (!userId) return null;
  if (DIRECT_PG_ENABLED) {
    const payload = await runPgBridge({ action: 'get_user_bundle', userId });
    return payload?.user?.profile || {
      role: payload?.user?.role || 'user',
      status: payload?.user?.status || 'active',
      email: payload?.user?.email || null,
      name: payload?.user?.name || null,
      background_mode: payload?.user?.background_mode || 'auto',
    };
  }

  const profileEndpoint =
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role,status,email,name,background_mode&limit=1`;

  if (accessToken && SUPABASE_ANON_KEY) {
    const userResponse = await supabaseUserRequest(profileEndpoint, accessToken);
    if (userResponse.ok) {
      const rows = await userResponse.json();
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    }
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) return null;
  const response = await supabaseRequest(profileEndpoint);
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
};

const requireAuthorizedRole = async (req, res) => {
  if (!DIRECT_PG_ENABLED && (!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
    json(res, 500, {
      error: {
        message: 'Secure Supabase proxy is not configured.',
      },
    });
    return null;
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    json(res, 401, {
      error: {
        message: 'Missing bearer token.',
      },
    });
    return null;
  }

  const user = await getUserFromAccessToken(accessToken);
  if (!user?.id) {
    json(res, 401, {
      error: {
        message: 'Invalid or expired access token.',
      },
    });
    return null;
  }

  const profile = await getUserProfile(user.id, accessToken);
  const role = String(profile?.role || 'user').toLowerCase();
  const status = String(profile?.status || 'active').toLowerCase();
  const blockedByAllowlist = ALLOWED_ROLES.size > 0 && !ALLOWED_ROLES.has(role);
  if (blockedByAllowlist || status === 'suspended') {
    json(res, 403, {
      error: {
        message: 'You do not have access to Repair History.',
        details: { role, status },
      },
    });
    return null;
  }

  return { user, profile };
};

const requireActiveAdministrator = async (req, res) => {
  if (!DIRECT_PG_ENABLED && (!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
    json(res, 500, {
      error: {
        message: 'Secure Supabase proxy is not configured.',
      },
    });
    return null;
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    json(res, 401, {
      error: {
        message: 'Missing bearer token.',
      },
    });
    return null;
  }

  const user = await getUserFromAccessToken(accessToken);
  if (!user?.id) {
    json(res, 401, {
      error: {
        message: 'Invalid or expired access token.',
      },
    });
    return null;
  }

  const profile = await getUserProfile(user.id, accessToken);
  const role = String(profile?.role || 'user').toLowerCase();
  const status = String(profile?.status || 'active').toLowerCase();
  if (role !== 'administrator' || status !== 'active') {
    json(res, 403, {
      error: {
        message: 'Active administrator role is required.',
        details: { role, status },
      },
    });
    return null;
  }

  return { user, profile };
};

const requireActiveUser = async (req, res) => {
  if (!DIRECT_PG_ENABLED && (!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
    json(res, 500, {
      error: {
        message: 'Secure Supabase proxy is not configured.',
      },
    });
    return null;
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    json(res, 401, {
      error: {
        message: 'Missing bearer token.',
      },
    });
    return null;
  }

  const user = await getUserFromAccessToken(accessToken);
  if (!user?.id) {
    json(res, 401, {
      error: {
        message: 'Invalid or expired access token.',
      },
    });
    return null;
  }

  const profile = await getUserProfile(user.id, accessToken);
  const status = String(profile?.status || 'active').toLowerCase();
  if (status === 'suspended') {
    json(res, 403, {
      error: {
        message: 'Your account is suspended.',
        details: { status },
      },
    });
    return null;
  }

  return { user, profile };
};

const resolveUserEmailForReset = async ({ userId }) => {
  if (userId) {
    const response = await supabaseRequest(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=email&limit=1`
    );
    if (!response.ok) {
      const parsed = await parseSupabaseError(response);
      throw new Error(parsed.message || 'Could not resolve target profile email.');
    }
    const rows = await response.json();
    const resolvedEmail = Array.isArray(rows) && rows.length ? rows[0]?.email : '';
    return String(resolvedEmail || '').trim().toLowerCase();
  }

  return '';
};

const fetchPtReferenceVinRows = async ({ tableName, vinSuffixes }) => {
  const rows = [];
  const suffixSet = new Set((vinSuffixes || []).map((suffix) => String(suffix || '').trim().toUpperCase()).filter(Boolean));
  if (!suffixSet.size) return rows;

  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams();
    params.set('select', 'VIN');
    params.set('limit', String(pageSize));
    params.set('offset', String(offset));
    const response = await supabaseRequest(`/rest/v1/${encodeURIComponent(tableName)}?${params.toString()}`);
    if (!response.ok) {
      const parsed = await parseSupabaseError(response);
      throw new Error(parsed.message || `Could not query ${tableName} VINs.`);
    }
    const payload = await response.json();
    const pageRows = Array.isArray(payload) ? payload : [];
    pageRows.forEach((row) => {
      const vin = String(row?.VIN || '').trim().toUpperCase();
      const suffix = vin.replace(/[^A-Z0-9]/g, '').slice(-6);
      if (suffix && suffixSet.has(suffix)) rows.push(row);
    });
    if (pageRows.length < pageSize) break;
  }
  return rows;
};

const buildPtReferencePayload = async ({ vinSuffixes }) => {
  const normalizedSuffixes = Array.from(
    new Set(
      (vinSuffixes || [])
        .map((value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-6))
        .filter(Boolean)
    )
  );

  const vinMap = {};
  if (normalizedSuffixes.length) {
    const tables = ['vehicles', 'DealsJP1'];
    for (const tableName of tables) {
      const rows = await fetchPtReferenceVinRows({ tableName, vinSuffixes: normalizedSuffixes });
      for (const row of rows) {
        const vin = String(row?.VIN || '').trim().toUpperCase();
        const suffix = vin.replace(/[^A-Z0-9]/g, '').slice(-6);
        if (!suffix || !vin || vinMap[suffix]) continue;
        vinMap[suffix] = vin;
      }
    }
  }

  const blacklistResponse = await supabaseRequest('/rest/v1/gps_blacklist?select=serial,is_active,effective_from');
  if (!blacklistResponse.ok) {
    const parsed = await parseSupabaseError(blacklistResponse);
    throw new Error(parsed.message || 'Could not load GPS blacklist.');
  }
  const gpsBlacklist = await blacklistResponse.json();

  return {
    vinMap,
    gpsBlacklist: Array.isArray(gpsBlacklist) ? gpsBlacklist : [],
  };
};

const handleAdminApi = async (req, res, pathname) => {
  if (req.method !== 'POST' || !pathname.startsWith('/api/admin/')) {
    json(res, 404, { error: { message: 'Not found.' } });
    return;
  }

  if (DIRECT_PG_ENABLED) {
    json(res, 501, {
      error: {
        message: 'Password reset link generation is not configured in local Supabase proxy mode.',
      },
    });
    return;
  }

  const auth = await requireActiveAdministrator(req, res);
  if (!auth) return;

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (error) {
    json(res, 400, { error: { message: error?.message || 'Invalid JSON payload.' } });
    return;
  }

  if (pathname === '/api/admin/pt-lastping/reference-data') {
    try {
      const payload = await buildPtReferencePayload({
        vinSuffixes: Array.isArray(body?.vinSuffixes) ? body.vinSuffixes : [],
      });
      json(res, 200, { data: payload });
    } catch (error) {
      json(res, 500, { error: { message: error?.message || 'Could not load PT reference data.' } });
    }
    return;
  }

  if (pathname === '/api/admin/pt-lastping/upload') {
    const rows = normalizePostgrestBulkRows(body?.rows);
    const vins = Array.isArray(body?.vins) ? body.vins : [];
    const shouldFinalize = body?.finalize === true;
    if (!rows.length && !shouldFinalize) {
      json(res, 400, { error: { message: 'Rows are required.' } });
      return;
    }

    const accessToken = getBearerToken(req);
    if (rows.length) {
      const response = await supabaseUserRequest('/rest/v1/PT-LastPing?on_conflict=Serial,Date', accessToken, {
        method: 'POST',
        headers: {
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: rows,
      });

      if (!response.ok) {
        const parsed = await parseSupabaseError(response);
        json(res, response.status, { error: parsed });
        return;
      }
    }

    let finalizePayload = null;
    const normalizedVins = Array.from(new Set(vins.map((vin) => String(vin || '').trim().toUpperCase()).filter(Boolean)));
    if (shouldFinalize && normalizedVins.length) {
      const minIdExclusive = Number(body?.minIdExclusive);
      const finalizeBody = {
        p_vins: normalizedVins,
      };
      if (Number.isFinite(minIdExclusive) && minIdExclusive > 0) {
        finalizeBody.p_min_id_exclusive = Math.trunc(minIdExclusive);
      }
      const finalizeResponse = await supabaseUserRequest('/rest/v1/rpc/finalize_pt_lastping_upload', accessToken, {
        method: 'POST',
        body: finalizeBody,
      });
      if (!finalizeResponse.ok) {
        const parsed = await parseSupabaseError(finalizeResponse);
        json(res, finalizeResponse.status, { error: parsed });
        return;
      }
      finalizePayload = await finalizeResponse.json().catch(() => null);
    }

    json(res, 200, {
      data: {
        ok: true,
        received: rows.length,
        finalized: shouldFinalize,
        finalization: {
          updatedRows: Number(finalizePayload?.updated_rows || 0),
          processedVins: Number(finalizePayload?.processed_vins || 0),
        },
      },
    });
    return;
  }

  if (pathname === '/api/admin/deals/upload') {
    const rows = normalizePostgrestBulkRows(body?.rows);
    if (!rows.length) {
      json(res, 400, { error: { message: 'Rows are required.' } });
      return;
    }

    const accessToken = getBearerToken(req);
    const uploadResponse = await supabaseUserRequest('/rest/v1/DealsJP1?on_conflict=Current%20Stock%20No', accessToken, {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: rows,
    });

    if (!uploadResponse.ok) {
      const parsed = await parseSupabaseError(uploadResponse);
      json(res, uploadResponse.status, { error: parsed });
      return;
    }

    const uploadedRows = await uploadResponse.json().catch(() => []);

    const recalcResponse = await supabaseUserRequest('/rest/v1/rpc/recalc_dealsjp1_last_deal', accessToken, {
      method: 'POST',
      body: {},
    });
    if (!recalcResponse.ok) {
      const parsed = await parseSupabaseError(recalcResponse);
      json(recalcResponse.status, { error: parsed });
      return;
    }
    const recalcPayload = await recalcResponse.json().catch(() => null);

    const syncResponse = await supabaseUserRequest('/rest/v1/rpc/sync_vehicles_from_dealsjp1_lastdeal', accessToken, {
      method: 'POST',
      body: {},
    });
    if (!syncResponse.ok) {
      const parsed = await parseSupabaseError(syncResponse);
      json(syncResponse.status, { error: parsed });
      return;
    }
    const syncPayload = await syncResponse.json().catch(() => null);

    json(res, 200, {
      data: {
        ok: true,
        uploadedRows: Array.isArray(uploadedRows) ? uploadedRows : [],
        totalUpserted: Array.isArray(uploadedRows) ? uploadedRows.length : rows.length,
        recalculatedRows: Number(recalcPayload || 0),
        syncedVehicles: Number(syncPayload || 0),
      },
    });
    return;
  }

  if (pathname !== '/api/admin/password-reset') {
    json(res, 404, { error: { message: 'Not found.' } });
    return;
  }

  const targetUserId = String(body?.userId || '').trim();
  let targetEmail = '';

  if (!targetUserId) {
    json(res, 400, {
      error: {
        message: 'Target userId is required.',
      },
    });
    return;
  }

  try {
    targetEmail = await resolveUserEmailForReset({
      userId: targetUserId,
    });
  } catch (error) {
    json(res, 400, { error: { message: error?.message || 'Invalid target account.' } });
    return;
  }

  if (!targetEmail) {
    json(res, 400, {
      error: {
        message: 'Target profile email is required.',
      },
    });
    return;
  }

  const redirectTo = buildResetPasswordRedirect();

  const response = await supabaseRequest('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: {
      type: 'recovery',
      email: targetEmail,
      options: { redirectTo },
    },
  });

  if (!response.ok) {
    const parsed = await parseSupabaseError(response);
    json(res, response.status, { error: parsed });
    return;
  }

  const payload = await response.json();
  json(res, 200, {
    data: {
      ok: true,
      email: targetEmail,
      userId: targetUserId || null,
      generated: Boolean(payload?.properties?.action_link || payload?.action_link),
    },
  });
};

const handleDirectAuthApi = async (req, res, pathname) => {
  const method = String(req.method || 'GET').toUpperCase();

  if (method === 'POST' && pathname === '/api/auth/sessions') {
    const body = await parseJsonBody(req);
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    if (!email || !password) {
      json(res, 400, { error: { message: 'Email and password are required.' } });
      return;
    }
    const payload = await runPgBridge({ action: 'verify_user_password', email, password });
    if (!payload?.ok || !payload?.user?.id) {
      json(res, 401, { error: { message: 'Invalid login credentials.' } });
      return;
    }
    const session = createLocalSession(payload.user);
    json(res, 200, {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: session.user,
    });
    return;
  }

  if (method === 'GET' && pathname === '/api/auth/sessions/current') {
    const session = readAccessSession(getBearerToken(req));
    if (!session?.userId) {
      json(res, 401, { error: { message: 'Invalid or expired access token.' } });
      return;
    }
    const payload = await runPgBridge({ action: 'get_user_bundle', userId: session.userId });
    const user = buildSessionUser(payload?.user) || session.user;
    session.user = user;
    json(res, 200, { user });
    return;
  }

  if (method === 'POST' && pathname === '/api/auth/refresh') {
    const body = await parseJsonBody(req);
    const session = readRefreshSession(body?.refreshToken || '');
    if (!session?.userId) {
      json(res, 401, { error: { message: 'Refresh token is invalid or expired.' } });
      return;
    }
    const payload = await runPgBridge({ action: 'get_user_bundle', userId: session.userId });
    const nextSession = createLocalSession(payload?.user || session.user);
    destroyLocalSession(session);
    json(res, 200, {
      accessToken: nextSession.accessToken,
      refreshToken: nextSession.refreshToken,
      user: nextSession.user,
    });
    return;
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    const session = readAccessSession(getBearerToken(req));
    destroyLocalSession(session);
    json(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && pathname === '/api/auth/profiles/current') {
    const session = readAccessSession(getBearerToken(req));
    if (!session?.userId) {
      json(res, 401, { error: { message: 'Invalid or expired access token.' } });
      return;
    }
    const payload = await runPgBridge({ action: 'get_user_bundle', userId: session.userId });
    json(res, 200, { profile: buildSessionUser(payload?.user)?.profile || null });
    return;
  }

  if (method === 'PATCH' && pathname === '/api/auth/profiles/current') {
    const session = readAccessSession(getBearerToken(req));
    if (!session?.userId) {
      json(res, 401, { error: { message: 'Invalid or expired access token.' } });
      return;
    }
    const body = await parseJsonBody(req);
    const requestedFields = Object.keys(body?.profile && typeof body.profile === 'object' ? body.profile : {});
    const blockedField = requestedFields.find((field) => !['name', 'background_mode', 'last_connection'].includes(field));
    if (blockedField) {
      json(res, 403, { error: { message: `Profile field is not writable here: ${blockedField}.` } });
      return;
    }
    const payload = await runPgBridge({
      action: 'update_profile',
      userId: session.userId,
      profile: body?.profile || {},
    });
    json(res, 200, { profile: payload?.profile || null });
    return;
  }

  if (
    (method === 'POST' && pathname === '/api/auth/email/send-reset-password')
    || (method === 'POST' && pathname === '/api/auth/email/reset-password')
  ) {
    json(res, 501, { error: { message: 'Password reset is not configured in local proxy mode.' } });
    return;
  }

  json(res, 404, { error: { message: 'Not found.' } });
};

const handleRepairHistoryApi = async (req, res, pathname, searchParams) => {
  const auth = await requireAuthorizedRole(req, res);
  if (!auth) return;

  if (req.method === 'GET' && pathname === '/api/repair-history') {
    const normalizedVin = normalizeVin(searchParams.get('vin') || '');
    if (!normalizedVin) {
      json(res, 400, {
        error: {
          message: 'VIN is required.',
        },
      });
      return;
    }

    const shortVin = normalizedVin.slice(-6);
    const params = new URLSearchParams({
      select: '*',
      or: `(VIN.ilike.%${normalizedVin}%,shortvin.ilike.%${shortVin}%)`,
      order: 'created_at.desc',
    });

    const rows = DIRECT_PG_ENABLED
      ? (await runPgBridge({
        action: 'query_table',
        table: REPAIR_HISTORY_TABLE,
        method: 'GET',
        query: Object.fromEntries([...params.keys()].map((key) => [key, params.getAll(key)])),
        prefer: '',
        auth: {
          userId: auth.user?.id || null,
          role: auth.profile?.role || 'user',
          status: auth.profile?.status || 'active',
        },
      }))?.rows || []
      : await (async () => {
        const response = await supabaseRequest(`/rest/v1/${REPAIR_HISTORY_TABLE}?${params.toString()}`);
        if (!response.ok) {
          const parsed = await parseSupabaseError(response);
          json(res, response.status, { error: parsed });
          return null;
        }
        return response.json();
      })();
    if (rows === null) return;
    json(res, 200, { data: rows || [] });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/repair-history') {
    const body = await parseJsonBody(req);
    const payload = sanitizeRepairPayload(body);
    if (!payload.VIN) {
      json(res, 400, {
        error: {
          message: 'VIN is required in payload.',
        },
      });
      return;
    }

    const rows = DIRECT_PG_ENABLED
      ? (await runPgBridge({
        action: 'query_table',
        table: REPAIR_HISTORY_TABLE,
        method: 'POST',
        query: { select: ['*'] },
        prefer: 'return=representation',
        body: payload,
        auth: {
          userId: auth.user?.id || null,
          role: auth.profile?.role || 'user',
          status: auth.profile?.status || 'active',
        },
      }))?.rows || []
      : await (async () => {
        const response = await supabaseRequest(`/rest/v1/${REPAIR_HISTORY_TABLE}?select=*`, {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: payload,
        });
        if (!response.ok) {
          const parsed = await parseSupabaseError(response);
          json(res, response.status, { error: parsed });
          return null;
        }
        return response.json();
      })();
    if (rows === null) return;
    json(res, 200, { data: rows || [] });
    return;
  }

  const idMatch = pathname.match(/^\/api\/repair-history\/([^/]+)$/);
  if (!idMatch) {
    json(res, 404, { error: { message: 'Not found.' } });
    return;
  }
  const repairId = decodeURIComponent(idMatch[1]);
  if (!repairId) {
    json(res, 400, { error: { message: 'Repair ID is required.' } });
    return;
  }

  if (req.method === 'PATCH') {
    const body = await parseJsonBody(req);
    const payload = sanitizeRepairPayload(body);
    if (!Object.keys(payload).length) {
      json(res, 400, { error: { message: 'No editable fields in payload.' } });
      return;
    }
    const rows = DIRECT_PG_ENABLED
      ? (await runPgBridge({
        action: 'query_table',
        table: REPAIR_HISTORY_TABLE,
        method: 'PATCH',
        query: { id: [`eq.${repairId}`], select: ['*'] },
        prefer: 'return=representation',
        body: payload,
        auth: {
          userId: auth.user?.id || null,
          role: auth.profile?.role || 'user',
          status: auth.profile?.status || 'active',
        },
      }))?.rows || []
      : await (async () => {
        const response = await supabaseRequest(
          `/rest/v1/${REPAIR_HISTORY_TABLE}?id=eq.${encodeURIComponent(repairId)}&select=*`,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: payload,
          }
        );
        if (!response.ok) {
          const parsed = await parseSupabaseError(response);
          json(res, response.status, { error: parsed });
          return null;
        }
        return response.json();
      })();
    if (rows === null) return;
    json(res, 200, { data: rows || [] });
    return;
  }

  if (req.method === 'DELETE') {
    const rows = DIRECT_PG_ENABLED
      ? (await runPgBridge({
        action: 'query_table',
        table: REPAIR_HISTORY_TABLE,
        method: 'DELETE',
        query: { id: [`eq.${repairId}`], select: ['*'] },
        prefer: 'return=representation',
        auth: {
          userId: auth.user?.id || null,
          role: auth.profile?.role || 'user',
          status: auth.profile?.status || 'active',
        },
      }))?.rows || []
      : await (async () => {
        const response = await supabaseRequest(
          `/rest/v1/${REPAIR_HISTORY_TABLE}?id=eq.${encodeURIComponent(repairId)}&select=*`,
          {
            method: 'DELETE',
            headers: { Prefer: 'return=representation' },
          }
        );
        if (!response.ok) {
          const parsed = await parseSupabaseError(response);
          json(res, response.status, { error: parsed });
          return null;
        }
        return response.json();
      })();
    if (rows === null) return;
    json(res, 200, { data: rows || [] });
    return;
  }

  json(res, 405, { error: { message: 'Method not allowed.' } });
};

const copyResponseHeaders = (sourceHeaders, overrides = {}) => {
  const headers = {};
  sourceHeaders.forEach((value, key) => {
    const normalizedKey = String(key || '').toLowerCase();
    if (normalizedKey === 'content-length') return;
    headers[key] = value;
  });
  return {
    ...headers,
    'cache-control': 'no-store',
    ...overrides,
  };
};

const handleDirectDatabaseApi = async (req, res, pathname, searchParams) => {
  const method = String(req.method || 'GET').toUpperCase();
  const authHeader = String(req.headers.authorization || '').trim();
  const cacheKey = buildClientCacheKey({
    pathname,
    search: searchParams.toString(),
    authHeader,
  });
  const cachedGetResponse = method === 'GET' ? getCachedClientGetResponse(cacheKey) : null;
  if (method !== 'GET' && method !== 'HEAD') {
    invalidateClientCacheByPathname(pathname);
  }

  if (pathname.startsWith('/api/database/records/')) {
    const table = decodeURIComponent(pathname.split('/').pop() || '');
    const body = ['GET', 'HEAD'].includes(method) ? null : await parseJsonBody(req);
    const auth = await enforceDatabaseAccessPolicy({ req, res, pathname, method, searchParams, body });
    if (!auth) return;
    let payload;
    try {
      payload = await runPgBridge({
        action: 'query_table',
        table,
        method,
        query: Object.fromEntries(
          [...searchParams.keys()].map((key) => [key, searchParams.getAll(key)])
        ),
        prefer: String(req.headers.prefer || ''),
        body,
        auth: {
          userId: auth.user?.id || null,
          role: auth.profile?.role || 'user',
          status: auth.profile?.status || 'active',
        },
      });
    } catch (error) {
      json(res, Number(error?.status || 500), { error: { message: error?.message || 'Database request failed.' } });
      return;
    }
    const responseBody = method === 'HEAD' ? null : Buffer.from(JSON.stringify(payload?.rows || []));
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    };
    if (payload?.count !== null && payload?.count !== undefined) {
      headers['x-total-count'] = String(payload.count);
    }
    if (method === 'GET') {
      setCachedClientGetResponse(cacheKey, {
        status: 200,
        headers: { ...headers, 'x-techloc-cache': 'MISS' },
        body: responseBody,
        expiresAt: now() + getClientCacheTtlMs(pathname),
      });
    } else {
      const mutatedTable = getTableNameFromDatabasePath(pathname);
      if (mutatedTable) {
        bumpDataVersions({ tables: [mutatedTable], reason: `${method} ${pathname}` });
      }
    }
    res.writeHead(200, headers);
    res.end(responseBody);
    return;
  }

  if (pathname.startsWith('/api/database/rpc/')) {
    const functionName = decodeURIComponent(pathname.split('/').pop() || '');
    const body = ['GET', 'HEAD'].includes(method) ? {} : await parseJsonBody(req);
    const auth = await enforceDatabaseAccessPolicy({ req, res, pathname, method, searchParams, body });
    if (!auth) return;
    let payload;
    try {
      payload = await runPgBridge({
        action: 'rpc',
        function: functionName,
        args: body || {},
        auth: {
          userId: auth.user?.id || null,
          role: auth.profile?.role || 'user',
          status: auth.profile?.status || 'active',
        },
      });
    } catch (error) {
      json(res, Number(error?.status || 500), { error: { message: error?.message || 'Database request failed.' } });
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      bumpDataVersions({ scope: 'all', reason: `${method} ${pathname}` });
    }
    json(res, 200, payload?.result ?? null);
    return;
  }

  if (method === 'GET' && cachedGetResponse) {
    res.writeHead(cachedGetResponse.status, cachedGetResponse.headers);
    res.end(cachedGetResponse.body);
    return;
  }

  json(res, 404, { error: { message: 'Not found.' } });
};

const handleClientApiProxy = async (req, res, pathname, searchParams) => {
  if (DIRECT_PG_ENABLED) {
    await handleDirectDatabaseApi(req, res, pathname, searchParams);
    return;
  }
  const method = String(req.method || 'GET').toUpperCase();
  const rawBody = ['GET', 'HEAD'].includes(method) ? null : await readRawBody(req);
  let targetUrl = '';
  const authHeader = String(req.headers.authorization || '').trim();
  const useServiceRoleForPublicRead = shouldUseServiceRoleForPublicDatabaseRead({
    pathname,
    method,
  });
  let databasePolicyBody = null;
  if (pathname.startsWith('/api/database/')) {
    if (rawBody && !['GET', 'HEAD'].includes(method)) {
      try {
        databasePolicyBody = JSON.parse(rawBody.toString('utf8') || '{}');
      } catch (_error) {
        json(res, 400, { error: { message: 'Invalid JSON payload.' } });
        return;
      }
    }
    const auth = await enforceDatabaseAccessPolicy({
      req,
      res,
      pathname,
      method,
      searchParams,
      body: databasePolicyBody,
    });
    if (!auth) return;
  }

  const shouldPreferServiceRole = useServiceRoleForPublicRead
    && Boolean(SUPABASE_SERVICE_ROLE_KEY);
  const defaultApiKey = shouldPreferServiceRole
    ? SUPABASE_SERVICE_ROLE_KEY
    : SUPABASE_ANON_KEY;
  const defaultAuthorization = useServiceRoleForPublicRead
    ? (defaultApiKey ? `Bearer ${defaultApiKey}` : '')
    : (authHeader || (defaultApiKey ? `Bearer ${defaultApiKey}` : ''));
  const requestHeaders = {
    apikey: defaultApiKey,
    authorization: defaultAuthorization,
  };
  const cacheKey = buildClientCacheKey({
    pathname,
    search: searchParams.toString(),
    authHeader: requestHeaders.authorization,
  });
  const cachedGetResponse = method === 'GET' ? getCachedClientGetResponse(cacheKey) : null;
  const mutatedTable = getTableNameFromDatabasePath(pathname);
  if (method !== 'GET' && method !== 'HEAD') {
    invalidateClientCacheByPathname(pathname);
  }

  const passthroughHeaders = [
    'accept',
    'content-type',
    'prefer',
    'range',
    'x-client-info',
  ];
  passthroughHeaders.forEach((headerName) => {
    const value = req.headers[headerName];
    if (!value) return;
    requestHeaders[headerName] = Array.isArray(value) ? value.join(', ') : String(value);
  });

  // Supabase may return a broken gzip stream for large REST payloads under Node/Vercel fetch.
  // Force identity encoding so arrayBuffer() always contains the real JSON body.
  requestHeaders['accept-encoding'] = 'identity';

  if (pathname === '/api/auth/sessions' && method === 'POST') {
    targetUrl = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
  } else if (pathname === '/api/auth/sessions/current' && method === 'GET') {
    targetUrl = `${SUPABASE_URL}/auth/v1/user`;
  } else if (pathname === '/api/auth/refresh' && method === 'POST') {
    targetUrl = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
  } else if (pathname === '/api/auth/logout' && method === 'POST') {
    targetUrl = `${SUPABASE_URL}/auth/v1/logout`;
  } else if (pathname === '/api/auth/email/send-reset-password' && method === 'POST') {
    targetUrl = `${SUPABASE_URL}/auth/v1/recover`;
  } else if (pathname === '/api/database/rpc/' || pathname.startsWith('/api/database/rpc/')) {
    const functionName = decodeURIComponent(pathname.split('/').pop() || '');
    targetUrl = `${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(functionName)}`;
  } else if (pathname === '/api/database/records/' || pathname.startsWith('/api/database/records/')) {
    const table = decodeURIComponent(pathname.split('/').pop() || '');
    targetUrl = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  } else if (pathname === '/api/auth/profiles/current' && method === 'PATCH') {
    const token = getBearerToken(req);
    const auth = token ? await getUserFromAccessToken(token) : null;
    if (!auth?.id) {
      json(res, 401, { error: { message: 'Invalid or expired access token.' } });
      return;
    }
    targetUrl = `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(auth.id)}`;
    requestHeaders.prefer = requestHeaders.prefer || 'return=representation';
  } else {
    const proxiedPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    targetUrl = `${SUPABASE_URL}${proxiedPath}`;
  }

  if (pathname === '/api/auth/sessions' && method === 'POST' && rawBody) {
    try {
      const parsed = JSON.parse(rawBody.toString('utf8'));
      const body = JSON.stringify({
        email: parsed?.email || '',
        password: parsed?.password || '',
      });
      requestHeaders['content-type'] = 'application/json';
      requestHeaders.authorization = `Bearer ${SUPABASE_ANON_KEY}`;
      requestHeaders.apikey = SUPABASE_ANON_KEY;
      const response = await fetch(targetUrl, {
        method,
        headers: requestHeaders,
        body,
      });
      const payload = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
      if (!response.ok) {
        json(res, response.status, payload?.error || payload?.msg
          ? { error: { message: payload.error_description || payload.msg || payload.error || payload.message || 'Unable to sign in.' } }
          : { error: { message: 'Unable to sign in.' } });
        return;
      }
      json(res, 200, {
        accessToken: payload.access_token || null,
        refreshToken: payload.refresh_token || null,
        user: payload.user || null,
      });
      return;
    } catch (error) {
      json(res, 500, { error: { message: error?.message || 'Unable to sign in.' } });
      return;
    }
  }

  if (pathname === '/api/auth/refresh' && method === 'POST' && rawBody) {
    try {
      const parsed = JSON.parse(rawBody.toString('utf8'));
      const body = JSON.stringify({
        refresh_token: parsed?.refreshToken || '',
      });
      requestHeaders['content-type'] = 'application/json';
      requestHeaders.authorization = `Bearer ${SUPABASE_ANON_KEY}`;
      requestHeaders.apikey = SUPABASE_ANON_KEY;
      const response = await fetch(targetUrl, {
        method,
        headers: requestHeaders,
        body,
      });
      const payload = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
      if (!response.ok) {
        json(res, response.status, { error: { message: payload.error_description || payload.msg || payload.error || payload.message || 'Unable to refresh session.' } });
        return;
      }
      json(res, 200, {
        accessToken: payload.access_token || null,
        refreshToken: payload.refresh_token || null,
        user: payload.user || null,
      });
      return;
    } catch (error) {
      json(res, 500, { error: { message: error?.message || 'Unable to refresh session.' } });
      return;
    }
  }

  if (pathname === '/api/auth/sessions/current' && method === 'GET') {
    try {
      requestHeaders.authorization = authHeader || '';
      const response = await fetch(targetUrl, {
        method,
        headers: requestHeaders,
      });
      const payload = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
      if (!response.ok) {
        json(res, response.status, { error: { message: payload.error_description || payload.msg || payload.error || payload.message || 'Unable to resolve current user.' } });
        return;
      }
      json(res, 200, { user: payload || null });
      return;
    } catch (error) {
      json(res, 500, { error: { message: error?.message || 'Unable to resolve current user.' } });
      return;
    }
  }

  if (pathname === '/api/auth/profiles/current' && method === 'GET') {
    try {
      const token = getBearerToken(req);
      const auth = token ? await getUserFromAccessToken(token) : null;
      if (!auth?.id) {
        json(res, 401, { error: { message: 'Invalid or expired access token.' } });
        return;
      }

      let response = await supabaseUserRequest(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(auth.id)}&select=id,email,name,role,status,background_mode&limit=1`,
        token
      );
      if (!response.ok && SUPABASE_SERVICE_ROLE_KEY) {
        response = await supabaseRequest(
          `/rest/v1/profiles?id=eq.${encodeURIComponent(auth.id)}&select=id,email,name,role,status,background_mode&limit=1`
        );
      }
      const payload = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
      if (!response.ok) {
        json(res, response.status, { error: { message: payload.error_description || payload.msg || payload.error || payload.message || 'Could not load profile.' } });
        return;
      }
      json(res, 200, { profile: Array.isArray(payload) ? (payload[0] || null) : payload });
      return;
    } catch (error) {
      json(res, 500, { error: { message: error?.message || 'Could not load profile.' } });
      return;
    }
  }

  if (pathname === '/api/auth/profiles/current' && method === 'PATCH' && rawBody) {
    try {
      const parsed = JSON.parse(rawBody.toString('utf8'));
      const requestedFields = Object.keys(parsed?.profile && typeof parsed.profile === 'object' ? parsed.profile : {});
      const blockedField = requestedFields.find((field) => !['name', 'background_mode', 'last_connection'].includes(field));
      if (blockedField) {
        json(res, 403, { error: { message: `Profile field is not writable here: ${blockedField}.` } });
        return;
      }
      const body = JSON.stringify(parsed?.profile || {});
      requestHeaders['content-type'] = 'application/json';
      const response = await fetch(targetUrl, {
        method,
        headers: requestHeaders,
        body,
      });
      const payload = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
      if (!response.ok) {
        json(res, response.status, { error: { message: payload.error_description || payload.msg || payload.error || payload.message || 'Could not update profile.' } });
        return;
      }
      json(res, 200, { profile: Array.isArray(payload) ? (payload[0] || null) : payload });
      return;
    } catch (error) {
      json(res, 500, { error: { message: error?.message || 'Could not update profile.' } });
      return;
    }
  }

  try {
    const response = await fetch(targetUrl, {
      method,
      headers: requestHeaders,
      body: rawBody,
    });

    const responseBuffer = Buffer.from(await response.arrayBuffer());
    if (method === 'GET' && response.ok) {
      setCachedClientGetResponse(cacheKey, {
        status: response.status,
        headers: copyResponseHeaders(response.headers, { 'x-techloc-cache': 'MISS' }),
        body: responseBuffer,
        expiresAt: now() + getClientCacheTtlMs(pathname),
      });
    }

    if (method === 'GET' && response.status === 429 && cachedGetResponse) {
      res.writeHead(
        cachedGetResponse.status,
        {
          ...cachedGetResponse.headers,
          'x-techloc-cache': 'STALE',
          'x-techloc-upstream-status': '429',
        }
      );
      res.end(cachedGetResponse.body);
      return;
    }

    if (response.ok && method !== 'GET' && method !== 'HEAD') {
      if (mutatedTable) {
        bumpDataVersions({
          tables: [mutatedTable],
          reason: `${method} ${pathname}`,
        });
      } else if (pathname.startsWith('/api/database/rpc/')) {
        bumpDataVersions({
          scope: 'all',
          reason: `${method} ${pathname}`,
        });
      }
    }

    res.writeHead(response.status, copyResponseHeaders(response.headers));
    if (method === 'HEAD') {
      res.end();
      return;
    }
    res.end(responseBuffer);
  } catch (error) {
    if (method === 'GET' && cachedGetResponse) {
      res.writeHead(
        cachedGetResponse.status,
        {
          ...cachedGetResponse.headers,
          'x-techloc-cache': 'STALE',
          'x-techloc-upstream-status': 'NETWORK_ERROR',
        }
      );
      res.end(cachedGetResponse.body);
      return;
    }
    throw error;
  }
};

const serveStatic = async (req, res, pathname) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }

  let requestPath = pathname || '/';
  if (requestPath === '/') requestPath = '/index.html';

  const decodedPath = decodeURIComponent(requestPath);
  const filePath = path.resolve(ROOT_DIR, `.${decodedPath}`);
  if (!filePath.startsWith(ROOT_DIR)) {
    json(res, 403, { error: { message: 'Forbidden.' } });
    return;
  }

  let targetPath = filePath;
  try {
    const fileStat = await stat(targetPath);
    if (fileStat.isDirectory()) {
      targetPath = path.join(targetPath, 'index.html');
    }
  } catch (_error) {
    json(res, 404, { error: { message: 'File not found.' } });
    return;
  }

  try {
    const ext = path.extname(targetPath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await readFile(targetPath);
    const responseBody = ext === '.html'
      ? Buffer.from(injectRuntimeConfigIntoHtml(content.toString('utf8')), 'utf8')
      : content;
    res.writeHead(200, {
      'content-type': mimeType,
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(responseBody);
  } catch (_error) {
    json(res, 404, { error: { message: 'File not found.' } });
  }
};

export const createRequestHandler = () => async (req, res) => {
  try {
    const url = new URL(req.url || '/', `${APP_ORIGIN}/`);
    const { pathname } = url;
    const searchParams = sanitizeSearchParams(url.searchParams);

    if (pathname === '/api/health') {
      json(res, 200, {
        ok: true,
        service: 'secure-supabase-proxy',
        table: REPAIR_HISTORY_TABLE,
      });
      return;
    }

    if (pathname === '/api/data-version/snapshot' || pathname === '/api/data-version/stream') {
      await handleDataVersionApi(req, res, pathname, searchParams);
      return;
    }

    if (pathname === '/api/repair-history' || pathname.startsWith('/api/repair-history/')) {
      await handleRepairHistoryApi(req, res, pathname, searchParams);
      return;
    }

    if (DIRECT_PG_ENABLED && pathname.startsWith('/api/auth/')) {
      await handleDirectAuthApi(req, res, pathname);
      return;
    }

    if (pathname.startsWith('/api/database/') || pathname.startsWith('/api/auth/')) {
      await handleClientApiProxy(req, res, pathname, searchParams);
      return;
    }

    if (pathname.startsWith('/api/admin/')) {
      await handleAdminApi(req, res, pathname);
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (error) {
    json(res, 500, {
      error: {
        message: error?.message || 'Unhandled server error.',
      },
    });
  }
};

export const start = () => {
  validateConfig();
  const handler = createRequestHandler();

  const server = createServer(handler);

  server.listen(PORT, () => {
    console.log(`[secure-proxy] running at http://127.0.0.1:${PORT}`);
  });
};

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectExecution) {
  start();
}
