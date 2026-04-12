import { createRequestHandler } from '../server/secure-supabase-proxy.mjs';

const handler = createRequestHandler();

export default async function vercelHandler(req, res) {
  return handler(req, res);
}
