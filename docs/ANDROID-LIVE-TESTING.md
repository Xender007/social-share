# Android Live Testing

Everything below is installed on the **D: drive** (`D:\dev`). No provider accounts are needed: the API runs with `PROVIDER_MODE=fake`, which simulates YouTube, Instagram and Facebook end to end (connect, publish, retries, analytics) without posting anything publicly.

## What is installed where

| Tool | Location |
|---|---|
| Java 17 | `D:\dev\jdk-17` |
| Android SDK, emulator, platform-tools | `D:\dev\android-sdk` |
| Virtual device `sp_pixel` (Pixel 8, Android 36) | `D:\dev\android-avd` |
| Gradle cache | `D:\dev\gradle` |
| scrcpy (phone screen mirroring) | `D:\dev\scrcpy` |
| ffmpeg / ffprobe | `D:\dev\ffmpeg\bin` |
| SeaweedFS (local stand-in for Cloudflare R2) | `D:\dev\seaweedfs` |
| Local database + storage data | `D:\dev\sp-data` |
| npm global / pnpm store | `D:\dev\npm-global`, `D:\dev\pnpm-store` |
| Local owner login | `D:\dev\sp-data\dev-owner-login.txt` |

Open a **new** terminal after installation so the user environment variables (`JAVA_HOME`, `ANDROID_HOME`, PATH) are picked up.

## Start everything (4 terminals)

```powershell
# 1. Database + storage (keep running)
cd "D:\puku's social media sharing idea"
pnpm infra

# 2. API + background workers (keep running, auto-restarts on code changes)
pnpm dev:api

# 3. Metro bundler for the app (keep running, live reload)
cd apps\mobile
npx expo start --dev-client

# 4a. Emulator
pnpm emulator
# 4b. …or your real phone, mirrored live on the PC
pnpm mirror
```

## Install the app

Build once (≈10–15 min the first time, then incremental):

```powershell
cd "D:\puku's social media sharing idea\apps\mobile\android"
.\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

Rebuild only when native packages change. JavaScript changes reload instantly through Metro.

## Emulator

- `pnpm emulator` boots `sp_pixel` and forwards ports 8081, 3000 and 8333 into it.
- Open **Social Publisher** on the emulator; the dev client connects to Metro automatically (or press `a` in the Metro terminal).
- Sign in with the login in `D:\dev\sp-data\dev-owner-login.txt`.

## Real phone (live screen on your PC)

1. Phone: **Settings → About phone → tap Build number 7×**, then **Developer options → USB debugging ON**.
2. Connect by USB and accept the "Allow USB debugging" prompt.
3. `adb install -r apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk`
4. `pnpm mirror` — the phone's screen appears in a window on the PC; you can click and type in it.
5. Ports are forwarded over USB, so the app reaches Metro/API/storage even without Wi-Fi.

**Using Wi-Fi instead of USB:** the app uses `http://192.168.1.2:3000` (from `apps/mobile/.env`). Allow Node.js and `weed.exe` through Windows Defender Firewall for **Private** networks (ports 3000, 8081, 8333). If your PC's IP changes, update `apps/api/.env` (`API_BASE_URL`, `STORAGE_PUBLIC_ENDPOINT`) and `apps/mobile/.env`.

## What to try

1. **Connections** → Connect Google and Meta (a local "Simulated login" page appears → Allow).
2. **Home → Create post** → pick a video → it uploads immediately → write title/caption → Publish.
3. Watch each platform move through Queued → Publishing → Processing → Published.
4. **Share into the app:** in Gallery/Files, share a video → choose Social Publisher → Create Post opens with it.
5. **Settings → Owner console:** turn a platform off, activate a kill switch, look at the audit log — the app updates without reinstalling.
6. **Analytics:** tap Sync to generate simulated history, change ranges, open an account.

Test videos are in `D:\dev\tmp\smoke` (vertical H.264, HDR 10-bit HEVC, landscape). Push them to the emulator with:

```powershell
adb push D:\dev\tmp\smoke\vertical.mp4 /sdcard/Movies/
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Movies/vertical.mp4
```

## Automated checks

```powershell
pnpm --filter @sp/api test            # 80+ unit tests (entitlements, state machine, media rules, crypto)
pnpm --filter @sp/api smoke           # end-to-end against the running API (needs OWNER_EMAIL / OWNER_PASSWORD)
pnpm --filter @sp/api typecheck
cd apps\mobile; npx tsc --noEmit
```

## Going live with real providers

Set `PROVIDER_MODE=live` in `apps/api/.env` and fill in `GOOGLE_*` / `META_*` credentials (blueprint §13, Phase 0). Keep YouTube uploads `private` until the YouTube API audit is approved.
