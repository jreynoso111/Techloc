import { createRequestHandler } from '../../server/secure-supabase-proxy.mjs';

const handler = createRequestHandler();

export default async function vercelAuthHandler(req, res) {
  return handler(req, res);
}
