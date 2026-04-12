import { createRequestHandler } from '../../server/secure-supabase-proxy.mjs';

const handler = createRequestHandler();

export default async function vercelDatabaseHandler(req, res) {
  return handler(req, res);
}
