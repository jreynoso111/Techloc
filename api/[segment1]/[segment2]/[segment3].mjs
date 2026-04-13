import { createRequestHandler } from '../../../server/secure-supabase-proxy.mjs';

const handler = createRequestHandler();

export default async function vercelThreeSegmentApiHandler(req, res) {
  return handler(req, res);
}
