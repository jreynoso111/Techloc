# Secure Supabase Proxy

This server keeps `SUPABASE_SERVICE_ROLE_KEY` on the backend and injects frontend Supabase runtime config from environment variables (no hardcoded keys in repo).

## 1) Set environment variables

Run these before starting the server:

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_ANON_KEY="<your-anon-key>"
export SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>"
export APP_ORIGIN="https://<your-app-domain>"
export PORT="8080"
```

You can also copy values from `/.env.example` into a local `.env` file (ignored by git) and export them in your shell.

`SUPABASE_SERVICE_ROLE_KEY` is required for privileged proxy endpoints (`/api/admin/*` and service-role fallback reads configured in the proxy).  
The frontend can still boot with only `SUPABASE_URL` + `SUPABASE_ANON_KEY`.
`APP_ORIGIN` must be the public base URL for this app in any proxied or production deployment. The password reset flow and request URL parsing use this fixed origin and do not trust the incoming `Host` header.

Optional:

```bash
export REPAIR_HISTORY_ALLOWED_ROLES="administrator,moderator"
export SUPABASE_PROJECT_REF="<project-ref>"
```

Leave `REPAIR_HISTORY_ALLOWED_ROLES` empty to allow any authenticated user.
If it was already set in your shell, run `unset REPAIR_HISTORY_ALLOWED_ROLES` before starting the proxy.

This proxy reads the Supabase URL, ref, and database credentials from environment variables. Keep those values aligned with the target project before starting the server.

Do not enable local direct-Postgres mode on Vercel. `SUPABASE_DB_HOST`, `SUPABASE_DB_USER`, and `SUPABASE_DB_PASSWORD` are for local bridge/testing only; production should use Supabase HTTPS APIs plus `SUPABASE_SERVICE_ROLE_KEY` on the server.

## 2) Start server

From project root:

```bash
node ./server/secure-supabase-proxy.mjs
```

Open:

```text
http://127.0.0.1:8080
```

## 3) Security notes

- Do not commit `SUPABASE_SERVICE_ROLE_KEY` to git.
- Do not place `SUPABASE_SERVICE_ROLE_KEY` in frontend files.
- Do not commit `.env` files or any credential JSON files.
- Do not hardcode database URLs, pooler URLs, or passwords in scripts. Use environment variables such as `SUPABASE_DB_URL`.
- This proxy is same-origin by design and does not emit permissive CORS headers. Keep browser clients on the same app origin.
- Set `APP_ORIGIN` to the canonical production URL in Vercel. Do not derive password reset links from `Host` or forwarded host headers.
- If the key was shared in chat, rotate it in Supabase Dashboard.

## 4) Admin password reset endpoint

The proxy exposes administrator password actions through Supabase Admin Auth. These endpoints require `SUPABASE_SERVICE_ROLE_KEY` on the server in addition to the public Supabase URL and anon/publishable key. The runtime also accepts `SUPABASE_SERVICE_KEY` or `SUPABASE_SECRET_KEY` as aliases.

```text
POST /api/admin/password-reset
POST /api/admin/password-update
```

Requirements:

- `Authorization: Bearer <admin-access-token>`
- Caller must be an active administrator in `profiles`.
- `SUPABASE_SERVICE_ROLE_KEY` must be configured in the runtime environment.
- Reset body: JSON with `userId`.
- Update body: JSON with `userId` and `password` (minimum 8 characters).

Example:

```bash
curl -X POST "http://127.0.0.1:8080/api/admin/password-reset" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"userId":"<profile-id>"}'
```

This triggers Supabase recovery link generation for the target user without exposing passwords.
