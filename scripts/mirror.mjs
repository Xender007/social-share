// Mirrors a real Android phone's screen on this PC with scrcpy (installed on D:).
// Usage: pnpm mirror            -> first USB-connected phone
//        pnpm mirror <serial>   -> a specific device from `adb devices`
import { execFileSync, spawn } from 'node:child_process';

const SDK = process.env.ANDROID_HOME ?? 'D:/dev/android-sdk';
const SCRCPY = process.env.SCRCPY_PATH ?? 'D:/dev/scrcpy/scrcpy.exe';
const env = { ...process.env, ADB: `${SDK}/platform-tools/adb.exe` };

const devices = execFileSync(env.ADB, ['devices'], { encoding: 'utf8' })
  .split('\n')
  .slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter(([serial, state]) => serial && state === 'device');

const physical = devices.filter(([serial]) => !serial.startsWith('emulator-'));
const serial = process.argv[2] ?? physical[0]?.[0];
if (!serial) {
  console.error('No phone found. Connect it with USB, enable USB debugging (Settings > Developer options), accept the prompt on the phone, then retry.');
  process.exit(1);
}

// Forward dev ports so the app on the phone can reach Metro, the API and storage over USB too.
for (const port of [8081, 3000, 8333]) {
  try {
    execFileSync(env.ADB, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
  } catch {
    // Wi-Fi (LAN IP) still works if reverse is unavailable
  }
}

console.log(`Mirroring ${serial}. Close the window to stop.`);
spawn(SCRCPY, ['-s', serial, '--window-title', 'Social Publisher — live phone', '--stay-awake', '--max-fps', '60'], { env, stdio: 'inherit' });
