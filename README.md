# Social Publisher

Publish one video to YouTube, Instagram and Facebook from your Android phone, track each platform's status, fix failures, and see combined analytics. The owner can turn platforms and features on or off remotely.

## Repository

| Path | What it is |
|---|---|
| `apps/api` | NestJS API + background workers (Prisma, pg-boss, ffmpeg) |
| `apps/mobile` | Expo (SDK 57) Android app |
| `packages/contracts` | Shared request/response schemas and types |
| `scripts/` | Local infra, emulator, phone mirroring, Android build |
| `design-system/` | UI design system (UI/UX Pro Max) used by the app |
| `docs/ANDROID-LIVE-TESTING.md` | Step-by-step local and on-device testing |
| `social_publishing_app_blueprint_v2.md` | Full architecture and build plan |

## Quick start (local, simulated providers)

```powershell
pnpm install
pnpm infra                                  # Postgres + S3 storage (keep running)
pnpm --filter @sp/api db:deploy; pnpm --filter @sp/api db:seed
$env:OWNER_PASSWORD='choose-a-password'; pnpm --filter @sp/api create-owner -- --email you@example.com
pnpm dev:api                                # API + workers on :3000
cd apps/mobile; npx expo start --dev-client # Metro on :8081
pnpm emulator                               # or: pnpm mirror (real phone)
pnpm android:build                          # APK -> apps/mobile/builds/app-debug.apk
```

`apps/api/.env` uses `PROVIDER_MODE=fake`, so connecting accounts and publishing are simulated end to end. Switch to `live` and add Google/Meta credentials to publish for real (see blueprint §13 and §33).

## Tests

```powershell
pnpm --filter @sp/api test        # unit + provider contract tests
pnpm --filter @sp/api smoke       # end-to-end against the running API (OWNER_EMAIL, OWNER_PASSWORD)
pnpm --filter @sp/api typecheck
cd apps/mobile; npx tsc --noEmit
```
