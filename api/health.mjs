import { createRequestHandler } from '../server/secure-supabase-proxy.mjs';

const handler = createRequestHandler();

export default async function vercelHealthHandler(req, res) {
  req.url = '/api/health';
  return handler(req, res);
}
