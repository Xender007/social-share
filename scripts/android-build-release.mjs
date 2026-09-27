// Builds the Android RELEASE APK (standalone, no Metro/dev-client dependency; JS bundle
// embedded) from a clean-path mirror (D:\dev\sp-native).
//
// Why the mirror: the project folder name contains an apostrophe ("puku's"), and the
// NDK/CMake link step splits paths on it, so native C++ modules (worklets, reanimated, MMKV)
// fail to link. This is a sibling of scripts/android-build.mjs (which builds the debug APK);
// this one runs assembleRelease instead, so the resulting APK embeds its own JS bundle and can
// run standalone, without Metro or the dev client.
//
// Release signing reuses signingConfigs.debug (see apps/mobile/android/app/build.gradle) —
// there's no separate release keystore, so assembleRelease works out of the box.
//
// Usage: pnpm android-build-release   (or: node scripts/android-build-release.mjs)
//        then: adb install -r apps/mobile/builds/app-release.apk
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEV = process.env.SP_DEV_DIR ?? 'D:/dev';
const mirror = join(DEV, 'sp-native');
const env = {
  ...process.env,
  JAVA_HOME: `${DEV}/jdk-17`,
  ANDROID_HOME: `${DEV}/android-sdk`,
  ANDROID_SDK_ROOT: `${DEV}/android-sdk`,
  GRADLE_USER_HOME: `${DEV}/gradle`,
  ANDROID_USER_HOME: `${DEV}/android-user`,
  TEMP: `${DEV}/tmp`,
  TMP: `${DEV}/tmp`,
  NODE_ENV: 'development',
  PATH: `${DEV}/jdk-17/bin;${DEV}/android-sdk/platform-tools;${process.env.PATH}`,
};

function run(label, command, args, cwd) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`✗ ${label} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

const skip = new Set(['node_modules', 'android', 'ios', '.expo', 'dist', 'builds']);
const copyTree = (from, to) => cpSync(from, to, { recursive: true, force: true, filter: (src) => !skip.has(src.split(/[\\/]/).pop()) });

console.log(`Syncing native build inputs to ${mirror}`);
mkdirSync(join(mirror, 'apps', 'api'), { recursive: true });
for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'tsconfig.base.json', 'turbo.json']) {
  cpSync(join(root, file), join(mirror, file));
}
cpSync(join(root, 'apps/api/package.json'), join(mirror, 'apps/api/package.json'));
// pnpm patches (package.json "patchedDependencies") must exist in the mirror or the frozen install fails.
if (existsSync(join(root, 'patches'))) copyTree(join(root, 'patches'), join(mirror, 'patches'));
copyTree(join(root, 'packages/contracts'), join(mirror, 'packages/contracts'));
copyTree(join(root, 'apps/mobile'), join(mirror, 'apps/mobile'));

run('Install packages (frozen lockfile)', 'pnpm', ['install', '--frozen-lockfile'], mirror);
run('Generate native Android project', 'npx', ['expo', 'prebuild', '-p', 'android', '--clean', '--no-install'], join(mirror, 'apps/mobile'));
// Absolute path: cmd won't run programs from the current folder when NoDefaultCurrentDirectoryInExePath is set.
const androidDir = join(mirror, 'apps/mobile/android');
run('Compile release APK', `"${join(androidDir, 'gradlew.bat')}"`, ['assembleRelease', '--console=plain'], androidDir);

const apk = join(mirror, 'apps/mobile/android/app/build/outputs/apk/release/app-release.apk');
if (!existsSync(apk)) {
  console.error('APK not found after build.');
  process.exit(1);
}
mkdirSync(join(root, 'apps/mobile/builds'), { recursive: true });
cpSync(apk, join(root, 'apps/mobile/builds/app-release.apk'));
console.log('\n✓ APK ready: apps/mobile/builds/app-release.apk');
console.log('  Install: adb install -r apps/mobile/builds/app-release.apk');
