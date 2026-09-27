# Social Publisher — Project Context

Android-first app to publish one video to YouTube, Instagram and Facebook at once, with per-platform status, retries, analytics and remote feature control. Personal use first (single owner), architected to become multi-user.

## Source of truth

**[social_publishing_app_blueprint_v2.md](social_publishing_app_blueprint_v2.md)** is the full blueprint (38 sections). Read the relevant section before changing behaviour. Do not re-derive architecture decisions it already makes.

Key sections: §4 ADRs · §9 schema · §10 entitlements · §15 media pipeline · §17–19 jobs/state machine/adapters · §20–22 provider adapters · §33 provider facts to verify · §34 build plan · §38 definition of done.

## Start here in a new session

Read **[docs/SESSION-HANDOFF.md](docs/SESSION-HANDOFF.md)**: what's done, what's in progress, the ordered remaining work, and the user's standing preferences.

## Current status (as of 2026-09-15)

**V1 is implemented and tested locally in simulated-provider mode (`PROVIDER_MODE=fake`).**

- `apps/api` — NestJS 12 + Prisma 7 + pg-boss 12: auth (rotating refresh tokens), entitlement engine + kill switches, capabilities API (ETag), media (multipart upload, ffprobe, H.264 SDR transcode), posts/publications with idempotency, checkpointed publication runner with reconcile, real YouTube/Instagram/Facebook adapters, fake providers (OAuth consent page + publisher + analytics), analytics sync/query, owner admin API, audit log, workers/crons, push notifications.
- `apps/mobile` — Expo SDK 57 dev build: login, Home, Create Post (resumable upload, per-platform customize), Posts, Post detail (retry/cancel/resolve), Analytics (cards, audience chart, top posts), Connections (OAuth), Settings, Owner console (platforms/features, kill switches, queue, audit), share intent, push.
- `packages/contracts` — shared Zod schemas and types.
- **Tests:** 109 API unit + provider contract tests pass (`pnpm --filter @sp/api test`); 21/21 end-to-end smoke checks pass against the running API (`apps/api/scripts/smoke-e2e.ts`); API and mobile typecheck clean.
- **Emulator walkthrough (2026-09-15):** every screen tested on `sp_pixel`; 6 UI/runtime bugs fixed, including a share-intent crash patched in `patches/expo-share-intent.patch`. One open follow-up (false "Couldn't open that video" alert on a successful Photos share) with exact resume steps: `docs/SESSION-HANDOFF.md` → "In progress at handoff".
- **Not done / needs the user:** real provider credentials (Phase 0: Google consent screen In production, YouTube audit, Meta app review/permissions), EAS project ID + FCM for real push, Railway/Supabase/R2 deployment, Next.js admin (V2).

## How to run locally (details: [docs/ANDROID-LIVE-TESTING.md](docs/ANDROID-LIVE-TESTING.md))

1. `pnpm infra` — embedded Postgres (5433, UTF-8) + SeaweedFS S3 (8333), data in `D:\dev\sp-data`
2. `pnpm dev:api` — API + workers on :3000 (`apps/api/.env`)
3. `cd apps/mobile && npx expo start --dev-client` — Metro on :8081
4. `pnpm emulator` (AVD `sp_pixel`) or `pnpm mirror` (real phone via scrcpy)
5. `pnpm android:build` then `adb install -r apps/mobile/builds/app-debug.apk` — only when native deps change
6. Owner login for the local DB: `D:\dev\sp-data\dev-owner-login.txt`

## Stack and decisions (do not change without the user agreeing)

- Mobile: Expo dev build (not Expo Go), Expo Router (NativeTabs), TanStack Query, Zustand + MMKV, expo-secure-store, expo-share-intent, @expo/ui Switch, @expo/vector-icons. Design tokens in `apps/mobile/src/theme/tokens.ts` from `design-system/social-publisher/MASTER.md` (UI/UX Pro Max) mapped to Material 3 roles.
- Backend: NestJS 12 (ESM packages loaded from a CommonJS build via Node 24 require(esm)), Prisma 7 with `@prisma/adapter-pg` and `moduleFormat = "cjs"`, pg-boss for all jobs/crons, TypeScript 6.0, Vitest + unplugin-swc for tests (Jest cannot load NestJS 12 ESM).
- Storage: S3-compatible (Cloudflare R2 in prod, SeaweedFS locally; MinIO binaries are no longer downloadable).
- Capabilities resolved server-side; kill switches evaluated first; publishing is checkpointed with `UNKNOWN_OUTCOME` reconciliation; metrics in long format with `comparable_group`.
- Music, scheduling, AI captions, auto hashtags, multi-account: **disabled** in V1.

## Environment gotchas (Windows, user's PC)

- **All installs go on D: only** (`D:\dev`: JDK 17, Android SDK/AVD, Gradle, scrcpy, ffmpeg, SeaweedFS, npm global, pnpm store). A Microsoft OpenJDK 17 MSI remains on C: from an early mistake and needs admin to uninstall (Settings → Apps).
- The project path contains an apostrophe: **bash heredocs fail**, the safety checker blocks `Remove-Item` on it (use a Node script to delete files), and **NDK/CMake native links fail** → build the APK via `pnpm android:build`, which uses the clean mirror `D:\dev\sp-native`. Do not use `subst` (Node resolves back to D: and Gradle rejects mixed roots).
- `cmd /c` does not inherit PowerShell's location; use `Start-Process -WorkingDirectory` or absolute paths.
- Embedded Postgres defaults to WIN1252 on Windows; databases must be UTF-8 (emoji in captions). `/health/ready` reports `utf8`.
- Prisma `migrate dev` hangs in non-interactive shells; use `prisma migrate deploy` (create migrations with `--create-only`).
- pg-boss 12 rejects options that are present but `undefined`, and a queue's policy cannot change after creation.
- LAN IP `192.168.1.2` is baked into `apps/api/.env` (`API_BASE_URL`, `STORAGE_PUBLIC_ENDPOINT`) and `apps/mobile/.env`; update if it changes.
- `expo-share-intent` is patched via pnpm (`patches/`); keep the patch when upgrading, or check upstream fixed the empty-cursor crash.
- Use `components/ui/toggle.tsx` for switches next to a label; `@expo/ui` Switch `label` renders squashed text inside `Host matchContents`.
- More emulator/testing gotchas (Gboard stylus popup, API restart after code changes, uiautomator idle): `docs/SESSION-HANDOFF.md`.

## Working conventions

- Follow blueprint §34; before switching a provider to live mode, verify the _(verify)_ items in §33 and record them in `docs/provider-notes/`.
- Keep this file's **Current status** section up to date.
