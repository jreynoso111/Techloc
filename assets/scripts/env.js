const DEFAULT_BACKEND_PROVIDER = 'supabase';
const DEFAULT_SUPABASE_PROJECT_REF = 'blgpsrmcahjpihdkkkrk';
const DEFAULT_SUPABASE_URL = 'http://127.0.0.1:8080';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'local-techloc-proxy-key';

const getRuntimeConfig = () => {
  const browserConfig = (
    typeof window !== 'undefined'
    && window.__TECHLOC_RUNTIME_CONFIG__
    && typeof window.__TECHLOC_RUNTIME_CONFIG__ === 'object'
  )
    ? window.__TECHLOC_RUNTIME_CONFIG__
    : null;

  const nodeConfig = (typeof process !== 'undefined' && process?.env)
    ? {
      provider: process.env.BACKEND_PROVIDER || process.env.INSFORGE_PROVIDER,
      insforgeUrl: process.env.INSFORGE_URL,
      insforgeAnonKey: process.env.INSFORGE_ANON_KEY,
      insforgeProjectRef: process.env.INSFORGE_PROJECT_REF || process.env.INSFORGE_APPKEY,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY,
      supabaseProjectRef: process.env.SUPABASE_PROJECT_REF,
    }
    : null;

  return {
    provider:
      browserConfig?.provider
      || nodeConfig?.provider
      || DEFAULT_BACKEND_PROVIDER,
    insforgeUrl:
      browserConfig?.insforgeUrl
      || browserConfig?.supabaseUrl
      || nodeConfig?.insforgeUrl
      || nodeConfig?.supabaseUrl
      || DEFAULT_SUPABASE_URL,
    insforgeAnonKey:
      browserConfig?.insforgeAnonKey
      || browserConfig?.supabaseAnonKey
      || nodeConfig?.insforgeAnonKey
      || nodeConfig?.supabaseAnonKey
      || DEFAULT_SUPABASE_PUBLISHABLE_KEY,
    insforgeProjectRef:
      browserConfig?.insforgeProjectRef
      || browserConfig?.supabaseProjectRef
      || nodeConfig?.insforgeProjectRef
      || nodeConfig?.supabaseProjectRef
      || DEFAULT_SUPABASE_PROJECT_REF,
  };
};

const runtimeConfig = getRuntimeConfig();

const toSafeString = (value = '') => `${value || ''}`.trim();
const PLACEHOLDER_KEY_PATTERNS = [
  'your-anon-or-publishable-key',
  'your-service-role-key',
  'replace-me',
  'changeme',
];

const decodeBase64 = (value = '') => {
  if (!value) return '';
  try {
    if (typeof atob === 'function') return atob(value);
    if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64').toString('utf8');
  } catch (_error) {
    return '';
  }
  return '';
};

const decodeJwtPayload = (token) => {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = decodeBase64(`${payload}${padding}`);
    return decoded ? JSON.parse(decoded) : null;
  } catch (_error) {
    return null;
  }
};

const deriveProjectRefFromUrl = (url = '') => {
  try {
    const host = new URL(url).hostname || '';
    const supabaseMatch = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    if (supabaseMatch?.[1]) return String(supabaseMatch[1]).trim();
    const insforgeMatch = host.match(/^([a-z0-9-]+)\.[a-z0-9-]+\.insforge\.app$/i);
    return insforgeMatch?.[1] ? String(insforgeMatch[1]).trim() : '';
  } catch (_error) {
    return '';
  }
};

export const BACKEND_PROVIDER = toSafeString(runtimeConfig.provider || DEFAULT_BACKEND_PROVIDER) || DEFAULT_BACKEND_PROVIDER;
export const SUPABASE_URL = toSafeString(runtimeConfig.insforgeUrl);
export const SUPABASE_KEY = toSafeString(runtimeConfig.insforgeAnonKey);
const keyProjectRef = toSafeString(decodeJwtPayload(SUPABASE_KEY)?.ref);
export const SUPABASE_PROJECT_REF = (
  toSafeString(runtimeConfig.insforgeProjectRef)
  || deriveProjectRefFromUrl(SUPABASE_URL)
  || keyProjectRef
);
export const SUPABASE_DB_HOST = '';
export const SUPABASE_DB_PORT = 5432;
export const SUPABASE_DB_NAME = 'postgres';
export const SUPABASE_DB_USER = 'postgres';

const reportGlobalIssue = (title = '', message = '', details = '') => {
  if (typeof window !== 'undefined' && typeof window.reportGlobalIssue === 'function') {
    window.reportGlobalIssue(title, message, details);
  }
};

export const assertSupabaseTarget = (url = SUPABASE_URL, key = SUPABASE_KEY) => {
  const normalizedUrl = toSafeString(url);
  const normalizedKey = toSafeString(key);

  if (!normalizedUrl) {
    console.error('Missing backend URL.');
    reportGlobalIssue(
      'Missing Backend URL',
      'SUPABASE_URL is empty; connection cannot be established.',
      'Set SUPABASE_URL or INSFORGE_URL in server environment variables.'
    );
    return false;
  }

  let parsedUrl = null;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch (_error) {
    console.error('Invalid backend URL format.');
    return false;
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    console.error(`Blocked backend protocol: ${parsedUrl.protocol}.`);
    return false;
  }

  if (!normalizedKey) {
    console.error('Missing backend anon key.');
    reportGlobalIssue(
      'Missing Backend Key',
      'SUPABASE_KEY is empty; connection cannot be established.',
      'Set SUPABASE_ANON_KEY, SUPABASE_PUBLISHABLE_KEY, or INSFORGE_ANON_KEY.'
    );
    return false;
  }

  const lowerKey = normalizedKey.toLowerCase();
  if (PLACEHOLDER_KEY_PATTERNS.some((pattern) => lowerKey.includes(pattern))) {
    console.error('Backend anon key is still a placeholder value.');
    reportGlobalIssue(
      'Invalid Backend Key',
      'The configured anon key is still a placeholder and cannot authenticate.',
      'Update /Users/jreynoso/Downloads/Techloc2/.env with the real InsForge anon key.'
    );
    return false;
  }

  return true;
};
