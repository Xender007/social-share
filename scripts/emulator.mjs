// Boots the "sp_pixel" Android emulator (SDK on D:) and forwards dev ports into it.
// Usage: pnpm emulator
import { execFileSync, spawn } from 'node:child_process';

const SDK = process.env.ANDROID_HOME ?? 'D:/dev/android-sdk';
const env = {
  ...process.env,
  ANDROID_HOME: SDK,
  ANDROID_SDK_ROOT: SDK,
  ANDROID_AVD_HOME: process.env.ANDROID_AVD_HOME ?? 'D:/dev/android-avd',
  ANDROID_USER_HOME: process.env.ANDROID_USER_HOME ?? 'D:/dev/android-user',
};
const adb = (...args) => execFileSync(`${SDK}/platform-tools/adb.exe`, args, { env, encoding: 'utf8' }).trim();

function running() {
  try {
    return adb('devices').split('\n').some((line) => line.startsWith('emulator-') && line.includes('device'));
  } catch {
    return false;
  }
}

if (!running()) {
  console.log('Starting emulator sp_pixel…');
  const child = spawn(`${SDK}/emulator/emulator.exe`, [
      '-avd', 'sp_pixel',
      // Host GPU (NVIDIA) explicitly: `auto` can silently fall back to software (swiftshader/ANGLE) rendering.
      '-gpu', 'host',
      // The AVD's 2 GB left a debug RN build (~800 MB) swapping to zram, which stalled every frame.
      '-memory', '4096',
      '-no-snapshot-save', '-no-audio', '-no-boot-anim',
    ], { env, detached: true, stdio: 'ignore' });
  child.unref();
}

const deadline = Date.now() + 180_000;
while (Date.now() < deadline) {
  try {
    if (adb('shell', 'getprop', 'sys.boot_completed') === '1') break;
  } catch {
    // device not ready yet
  }
  await new Promise((r) => setTimeout(r, 2000));
}

for (const port of [8081, 3000, 8333]) {
  try {
    adb('reverse', `tcp:${port}`, `tcp:${port}`);
  } catch {
    // reverse can fail on very old images; LAN IP still works
  }
}
console.log('Emulator ready. Ports 8081 (Metro), 3000 (API) and 8333 (storage) are forwarded.');
