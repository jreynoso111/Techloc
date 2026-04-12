import { createRequestHandler } from '../../server/secure-supabase-proxy.mjs';

const handler = createRequestHandler();

export default async function vercelAdminHandler(req, res) {
  return handler(req, res);
}
