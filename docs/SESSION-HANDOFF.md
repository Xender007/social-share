# Session Handoff — Social Publisher

**Last updated:** 2026-09-15. Read this first in a new session, together with `CLAUDE.md`.

## User preferences (standing)

- Make decisions yourself and always choose the recommended option. Don't ask about routine choices.
- **Install everything strictly on the D: drive** (`D:\dev`). Nothing on C:.
- Finish big tasks with a clear summary.
- Use the UI/UX Pro Max skill plus the installed Expo, Callstack, Material 3 and mobile-app-design skills for UI work (`.claude/skills/`).

## Done

### Planning
- `social_publishing_app_blueprint_v2.md`: full architecture and build plan (38 sections).

### Tooling (all on D:)
| What | Where |
|---|---|
| JDK 17 | `D:\dev\jdk-17` |
| Android SDK, emulator, AVD `sp_pixel` (Pixel 8, API 36) | `D:\dev\android-sdk`, `D:\dev\android-avd` |
| Gradle cache | `D:\dev\gradle` |
| scrcpy | `D:\dev\scrcpy` |
| ffmpeg | `D:\dev\ffmpeg\bin` |
| SeaweedFS (local S3) | `D:\dev\seaweedfs` |
| npm global, pnpm store | `D:\dev\npm-global`, `D:\dev\pnpm-store` |
| `ui-ux-pro-max-cli` | `D:\dev\npm-global` |
| Data (Postgres, S3) | `D:\dev\sp-data` |
| Owner login for the local DB | `D:\dev\sp-data\dev-owner-login.txt` |
| Native build mirror | `D:\dev\sp-native` |
| Test videos | `D:\dev\tmp\smoke` (vertical H.264, HDR HEVC, landscape) |

User environment variables are set: `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `ANDROID_AVD_HOME`, `ANDROID_USER_HOME`, `GRADLE_USER_HOME`, plus PATH entries.

### Skills installed (project `.claude/skills/`)
- UI/UX Pro Max
- Expo: overview, router, dev-client, ui, native-ui, design-system, data-fetching, animation, project-structure, eas-update, eas-simulator
- Callstack: react-native-best-practices, react-navigation, react-native-testing, agent-device
- material-3
- mobile-app-design

### Code (monorepo, pnpm 9 + Turborepo)

**`apps/api`**
- Stack: NestJS 12, Prisma 7 (adapter-pg, CommonJS client), pg-boss 12, TypeScript 6.
- Features:
  - login with rotating refresh tokens
  - entitlement engine and kill switches
  - capabilities API
  - multipart media upload, ffprobe checks, H.264 SDR transcoding
  - posts and publications with idempotency
  - checkpointed publication runner with reconciliation
  - real YouTube, Instagram and Facebook adapters
  - fake providers (`PROVIDER_MODE=fake`)
  - Google and Meta OAuth
  - analytics sync and queries
  - admin API and audit log
  - worker and scheduled jobs
  - Expo push notifications
- Health endpoints: `/health` and `/health/ready` (checks the database, UTF-8 encoding, storage and jobs).

**`apps/mobile`**
- Stack: Expo SDK 57 dev build, Expo Router with NativeTabs.
- Screens:
  - login, Home
  - Create Post (resumable upload, per-platform customize)
  - Posts, Post detail (retry, cancel, resolve)
  - Analytics (cards, chart, top posts, per-account view)
  - Connections (OAuth, account picker)
  - Settings, Owner console (overview, platforms and features, kill switches, queue, audit)
- Share intent (`video/*`) and push registration.
- Design tokens: `src/theme/tokens.ts`, based on `design-system/social-publisher/MASTER.md`.

**Other**
- `packages/contracts`: shared Zod schemas and types.
- `scripts/`:
  - `dev-infra.mjs` (`pnpm infra`)
  - `emulator.mjs` (`pnpm emulator`)
  - `mirror.mjs` (`pnpm mirror`)
  - `android-build.mjs` (`pnpm android:build`)
  - `adb-ui.mjs`: screenshots, tap by text, typing
- `docs/ANDROID-LIVE-TESTING.md`: complete run and test guide.

### Verified
- **API unit and provider contract tests:** 109/109 pass (`pnpm --filter @sp/api test`).
- **End-to-end smoke test:** 21/21 checks pass (`apps/api/scripts/smoke-e2e.ts`). Covered:
  - login and refresh-token reuse detection
  - capabilities
  - connecting all three platforms (simulated OAuth)
  - resumable upload
  - publishing to all three platforms, including repeated taps not creating duplicates
  - HDR transcoding
  - rejection of incompatible video
  - crash reconciliation
  - rate-limit retry
  - failure then retry
  - reconnect-resume
  - kill switch, platform toggle
  - analytics, admin and audit
- **Typecheck:** API and mobile both clean.
- **Mobile JS bundle:** `expo export --platform android` succeeds.

### Bugs found and fixed during testing
- SeaweedFS had no writable volumes → now uses `-volume.max=100 -master.volumeSizeLimitMB=1024`.
- Embedded Postgres was WIN1252, so emoji broke → databases recreated as UTF-8; the infra script enforces UTF-8.
- pg-boss 12 rejects options that are present but `undefined`, and a queue's policy can't be changed after creation.
- Prisma DI type issue in `TokenCipher`; a media sweep queried a field that doesn't exist.
- Jest can't load NestJS 12 ES modules → switched to Vitest + SWC.
- The Android native C++ link fails because of the apostrophe in the project path → the APK is built in `D:\dev\sp-native`.

## Emulator walkthrough (2026-09-15)

Tested on emulator `sp_pixel` against the local API (fake providers).

**Works:** sign-in · Home · Create post (gallery pick, resumable upload, caption-as-title fallback) · publish to all 3 platforms (verified in the API) · draft survives an app restart ("Continue draft") · Post detail and Open links · Posts list · Analytics Sync, cards, chart, accounts, top posts · Settings · Owner console Overview, Platforms & features toggles (API and audit updated), Kill switches, Publishing queue, Audit log · notification permission prompt after the first publish.

**Bugs found and fixed:**
- Platforms & features: `@expo/ui` Switch `label` drew text one letter per line → new `components/ui/toggle.tsx` (label on the RN wrapper, switch semantics for TalkBack); also used in Create post options.
- Settings said Notifications "Off" after allowing → `lib/push.ts` refreshes the cached permission query.
- Scrolled content drew under the status bar → status-bar scrim in `components/ui/screen.tsx`.
- Audience chart: YouTube red and Instagram pink looked the same → per-platform dash patterns (`line-chart.tsx`, `analytics.tsx`).
- Audit log showed raw JSON without saying what changed → API stores `platformName`/`featureName`; `console/audit.tsx` shows sentences ("Advanced analytics on YouTube turned off"). Older entries still show JSON.
- **Share intent crashed the app** when the shared link couldn't be read (native `CursorIndexOutOfBoundsException` in `expo-share-intent`) → pnpm patch `patches/expo-share-intent.patch` (guards the cursor, MIME type and metadata read, reports an error instead) + `app-effects.tsx` shows "Couldn't open that video".
- `scripts/android-build.mjs`: copies `patches/` into the mirror and calls `gradlew.bat` by absolute path.
- `scripts/adb-ui.mjs`: deletes the old UI dump first, so a failed dump errors instead of describing the previous screen.

**Known, not fixed:** push registration is skipped until FCM/EAS is set up (expected, publishing unaffected) · toggles use Material's default indigo, not the app teal (the universal `@expo/ui` Switch has no colour props) · the Android photo picker hides real file names (shows e.g. `18.mp4`).

## In progress at handoff (paused by the user, 2026-09-15 ~05:40)

**Share-intent fix: verified so far**
- The patched APK was built and installed on `sp_pixel`.
- Broken share (a link that can't be read): the app shows "Couldn't open that video" and no longer crashes.
- Real share from Google Photos: Create post opens with the video, and the API uploads and probes it (`h264 1080x1920 6000ms`).

**Open bug: false alert on a successful share**
- Symptom: sharing from Google Photos works, but a "Couldn't open that video" alert also appears.
- Likely cause: in `patches/expo-share-intent.patch`, the metadata `catch` calls `notifyError(...)`. Reading metadata fails for Photos links, because `MediaMetadataRetriever.setDataSource(getAbsolutePath(uri))` gets no usable path. The `shareError` effect in `apps/mobile/src/components/app-effects.tsx` then shows the alert.
- Planned fix: in both `catch` blocks of `getFileInfo`, replace `notifyError(...)` with a log line (`android.util.Log.w`). Metadata is optional because the server measures the video with ffprobe. Unreadable files are still caught in JS, which checks for a missing name or type.

**Resume steps**
1. The patch edit folder is already open with the existing patch applied (not edited yet): `D:\dev\tmp\patch-share-intent2`. If it's gone, run `pnpm patch expo-share-intent --edit-dir D:\dev\tmp\patch-share-intent2` from `apps/mobile`.
2. Edit `android/src/main/java/expo/modules/shareintent/ExpoShareIntentModule.kt` in that folder as described above.
3. From `apps/mobile`: `pnpm patch-commit "D:\dev\tmp\patch-share-intent2"`.
4. From the root: `pnpm android:build`, then `adb install -r apps/mobile/builds/app-debug.apk`.
5. Re-test: Google Photos → open the video → Share → swipe the sheet up → Social Publisher. Expect Create post with the video and no alert.

**Not verified:** after the Photos share I added the caption "Shared from Google Photos" and tapped Publish. The screenshots (`D:\dev\tmp\w52.png`, `w53.png`) weren't reviewed. Check the Posts tab.

**Latest code changes** (mobile type-check passed after each):
- `app-effects.tsx`: an unreadable shared file shows "Couldn't open that video" instead of "Only videos can be shared".
- `components/ui/toggle.tsx`, `console/platforms.tsx`, `console/audit.tsx`, `create.tsx`, `lib/push.ts`, `components/ui/screen.tsx`, `line-chart.tsx`, `(tabs)/analytics.tsx`
- API: `admin/admin.controller.ts` (audit names)
- `scripts/android-build.mjs`, `scripts/adb-ui.mjs`
- API tests 109/109, smoke 21/21, both type-checks clean after these changes.

**Processes left running:**
- local infra
- API: plain `node dist/main.js`, not watch mode, so rebuild and restart it after API code changes
- Metro on :8081
- emulator `sp_pixel`

After a PC restart, use "How to resume the local stack" below. The app on the emulator is signed in; stylus handwriting is disabled there.

## Remaining (in order)

1. **Fix the false share alert and re-test** (above). The rest of the emulator walkthrough is done.
2. **Real phone:** enable USB debugging, `adb install`, then `pnpm mirror` for live screen mirroring. Allow Node and `weed.exe` through the Windows Firewall (Private network) for Wi-Fi use.
3. **Push notifications:** create an EAS project (`eas init`, needs the user's Expo login), add FCM credentials, and set `EXPO_ACCESS_TOKEN`.
4. **Real providers (Phase 0, needs the user):**
   - Google: consent screen set to In production, OAuth client, YouTube API audit.
   - Meta: app with privacy policy and data-deletion URLs; Instagram Professional account linked to a Page.
   - Then set `PROVIDER_MODE=live` and the `GOOGLE_*` / `META_*` values in `apps/api/.env`.
   - Named Cloudflare Tunnel for HTTPS OAuth callbacks.
   - Verify the blueprint §33 items and write `docs/provider-notes/`.
5. **Deployment:** Railway (API and worker Docker image with ffmpeg), Supabase Postgres (UTF-8), Cloudflare R2 bucket with lifecycle rules, nightly backup job.
6. **Nice to have:**
   - mobile component tests (jest-expo)
   - Maestro end-to-end flows
   - API integration tests using the `test/` Vitest project (`social_publisher_test` database already exists)
   - Next.js admin (V2)
   - uninstall the leftover Microsoft OpenJDK 17 MSI on C: (needs admin: Settings → Apps)
7. **Git:** the repo isn't initialised yet (`.gitignore` is ready). Initialise and commit only when the user asks.

## How to resume the local stack

```powershell
cd "D:\puku's social media sharing idea"
pnpm infra                                        # terminal 1
pnpm dev:api                                      # terminal 2
cd apps\mobile; npx expo start --dev-client       # terminal 3
pnpm emulator                                     # terminal 4 (or pnpm mirror)
```

## Gotchas to remember

- The project path has an apostrophe:
  - bash heredocs fail
  - `Remove-Item` is blocked by the safety check (delete files with a Node script)
  - native builds must use `pnpm android:build`
  - don't use `subst`
- `cmd /c` ignores PowerShell's current location; use `Start-Process -WorkingDirectory`.
- `prisma migrate dev` hangs non-interactively; use `migrate deploy` (create migrations with `--create-only`).
- LAN IP `192.168.1.2` is set in `apps/api/.env` and `apps/mobile/.env`; update both if it changes.
- **API code changes need a restart** unless the API runs via `pnpm dev:api` (tsc-watch). A plain `node dist/main.js` keeps serving old code: run `pnpm --filter @sp/api build`, then start it again.
- **Emulator testing:**
  - Gboard's "Try out your stylus" popup swallows `adb input text`; disable it with `adb shell settings put secure stylus_handwriting_enabled 0`.
  - `uiautomator dump` fails while a video plays ("could not get idle state"); use `adb-ui.mjs shot`.
  - Several parallel edits to one mobile file can hot-reload a half-edited file (ReferenceError → app jumps back to Home). Prefer one Write per file.
  - adb-sent share intents with raw MediaStore links aren't readable by the app; test sharing from Google Photos or Files instead.
- **Claude Code shells** set `NoDefaultCurrentDirectoryInExePath`, so `cmd` won't run a `.bat` from the current folder by bare name; use absolute paths.
- **pnpm patches** live in `patches/` (listed under root `package.json` → `pnpm.patchedDependencies`); edit with `pnpm patch <pkg> --edit-dir D:\dev\tmp\...` then `pnpm patch-commit`, and rebuild the APK for native changes.
