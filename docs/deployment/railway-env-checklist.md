# Railway environment variables — @sp/api

Set these in the Railway project's **Variables** tab for the `@sp/api` service.
Values are intentionally left blank — do not invent secrets. One line per var:
what it is and where its value comes from.

Reference: `apps/api/.env.example` (full list of vars the app reads) and
`apps/api/src/config/env.ts` (validation/defaults).

## Core / Railway-provided

- `NODE_ENV=production`
- `PROCESS_ROLE=all` — one process runs API + pg-boss workers, per current architecture.
- `PORT` — Railway injects this automatically; the app reads `process.env.PORT` (default 3000 locally). Do not hardcode 3000 in Railway.
- `LOG_LEVEL=log`
- `API_BASE_URL` — the public HTTPS URL Railway assigns this service (Settings → Networking → Public Domain). Must be set *after* the first deploy generates the domain; redeploy once known.
- `MOBILE_DEEP_LINK_SCHEME=socialpublisher` — unchanged from local.
- `PROVIDER_MODE` — `fake` until real Google/Meta credentials are verified per blueprint §33; then `live`.

## Database — Supabase

- `DATABASE_URL` — Supabase project → Settings → Database → Connection string (use the **pooled/transaction** connection string, port 6543, for the running app). Prisma 7 here uses `@prisma/adapter-pg` (the `pg` driver directly), not the native query engine, so standard `postgres://` connection strings work as-is.
- `PGBOSS_DATABASE_URL` — pg-boss needs a **direct/session** connection (not the transaction pooler, since it holds long-lived listeners/advisory locks). Use Supabase's direct connection string (port 5432) here. Leave unset only if you've confirmed the pooled URL supports pg-boss's session requirements — safer to set it explicitly.
- (Not read by the app, but needed once) a **direct** connection string for running `prisma migrate deploy` — reuse `PGBOSS_DATABASE_URL`'s value or Supabase's direct string when you run the migration (see "Next steps" below).

## Auth / secrets — generate locally, paste in

- `JWT_ACCESS_SECRET` — random string, at least 32 characters. Generate with e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`. Do not reuse the local dev value.
- `JWT_ACCESS_TTL_SECONDS=900`
- `REFRESH_TOKEN_TTL_DAYS=30`
- `TOKEN_ENCRYPTION_KEYS` — JSON object `{"1":"<base64 32-byte key>"}`. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Do not reuse the local dev key — this encrypts stored OAuth tokens.
- `TOKEN_ENCRYPTION_ACTIVE_VERSION=1`

## Storage — Cloudflare R2

- `STORAGE_ENDPOINT` — R2 dashboard → the bucket's S3 API endpoint: `https://<account-id>.r2.cloudflarestorage.com`.
- `STORAGE_PUBLIC_ENDPOINT` — the URL clients/mobile use to fetch media. Either the same R2 endpoint (if serving directly) or a configured R2 public bucket / custom domain — decide when setting up the R2 bucket.
- `STORAGE_REGION=auto` — R2's accepted value for the S3 SDK region.
- `STORAGE_BUCKET` — the R2 bucket name you create.
- `STORAGE_ACCESS_KEY_ID` — R2 dashboard → Manage API Tokens → create an S3 API token → Access Key ID.
- `STORAGE_SECRET_ACCESS_KEY` — same token → Secret Access Key (shown once at creation — store it somewhere safe).
- `STORAGE_FORCE_PATH_STYLE=true` — matches local (SeaweedFS); confirm this still works against R2 once live, R2 supports both path- and virtual-hosted-style.

## Providers — Google (YouTube) and Meta (Instagram/Facebook)

Leave blank while `PROVIDER_MODE=fake`. Fill in once Phase 0 (blueprint §33/§34 — Google consent screen in production, YouTube audit, Meta app review) is done:

- `GOOGLE_CLIENT_ID` — Google Cloud Console → OAuth client.
- `GOOGLE_CLIENT_SECRET` — same OAuth client.
- `GOOGLE_REDIRECT_URI` — `${API_BASE_URL}/v1/...` callback path used by the Google OAuth flow (check the auth/connections controller for the exact route); must be registered in the Google Cloud Console OAuth client's authorized redirect URIs.
- `META_APP_ID` — Meta for Developers → App dashboard.
- `META_APP_SECRET` — same app.
- `META_LOGIN_CONFIG_ID` — Meta login configuration ID (Facebook Login for Business config).
- `META_GRAPH_API_VERSION=v23.0` — unchanged unless Meta deprecates this version.
- `META_REDIRECT_URI` — same pattern as Google's, registered in the Meta app's valid OAuth redirect URIs.

## Push notifications

- `EXPO_ACCESS_TOKEN` — Expo dashboard → Access Tokens, once the mobile app has a real EAS project ID / FCM config (per CLAUDE.md "Not done" list). Leave blank until then; push still degrades gracefully without it.

## Media processing

- `FFMPEG_PATH=ffmpeg`
- `FFPROBE_PATH=ffprobe`
- `MEDIA_TMP_DIR` — leave blank; the app defaults to a tmp subdirectory. Confirm Railway's container has enough ephemeral disk for in-flight transcodes (check the plan's disk limits against expected video sizes).

## Jobs

- `JOBS_ENABLED=true`

---

## Next steps once Supabase/R2/Railway accounts exist

1. **Deploy**: connect this repo to a new Railway service, confirm it picks up `railway.json` (Dockerfile builder, `apps/api/Dockerfile`, build context = repo root), and trigger the first deploy. Paste the variables above into the service's Variables tab before or right after the first deploy (the container will fail fast on missing/invalid env — by design, `apps/api/src/config/env.ts` throws on startup if required vars are missing).
2. **First migration**: `prisma migrate deploy` needs to run once against the hosted Supabase DB before the API can serve traffic. Either:
   - run it locally against Supabase: `cd apps/api && DATABASE_URL="<supabase direct connection string>" pnpm db:deploy`, or
   - add it as a Railway **one-off/Release command** (Railway supports a pre-deploy or release-phase command per service) so it runs automatically before each deploy.
3. **Verify**: hit `https://<railway-domain>/health` (liveness) and `https://<railway-domain>/health/ready` (checks DB reachability + UTF-8 encoding + storage ping + jobs started) to confirm the deployed container is actually healthy end-to-end, not just "started".
