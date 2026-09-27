// Tiny adb UI driver for testing the app on the emulator or a phone.
// Usage:
//   node scripts/adb-ui.mjs shot <file.png>          screenshot
//   node scripts/adb-ui.mjs tap "<text>"              tap the first element whose text/content-desc contains text
//   node scripts/adb-ui.mjs tapxy <x> <y>              tap coordinates
//   node scripts/adb-ui.mjs type "<text>"             type into the focused field
//   node scripts/adb-ui.mjs wait "<text>" [seconds]   wait until text is on screen
//   node scripts/adb-ui.mjs texts                     list visible texts
//   node scripts/adb-ui.mjs back | enter | scroll-down | scroll-up
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const ADB = process.env.ADB ?? 'D:/dev/android-sdk/platform-tools/adb.exe';
const serial = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
const adb = (args, opts = {}) => execFileSync(ADB, [...serial, ...args], { maxBuffer: 64 * 1024 * 1024, ...opts });

function nodes() {
  // Remove the previous dump first: when uiautomator can't get an idle state (e.g. a playing
  // video) it fails without writing, and reading the old file would describe a different screen.
  adb(['shell', 'rm', '-f', '/sdcard/sp-ui.xml']);
  const dump = adb(['shell', 'uiautomator', 'dump', '/sdcard/sp-ui.xml'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
  const xml = adb(['shell', 'cat', '/sdcard/sp-ui.xml 2>/dev/null || true']).toString('utf8');
  if (!xml.includes('<hierarchy')) {
    throw new Error(`UI dump failed (${dump.trim() || 'no output'}); the screen is probably animating — use "shot" instead`);
  }
  const out = [];
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const attr = (name) => m[0].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
    const bounds = attr('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!bounds) continue;
    const [x1, y1, x2, y2] = bounds.slice(1).map(Number);
    out.push({ text: attr('text'), desc: attr('content-desc'), clickable: attr('clickable') === 'true', x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), area: (x2 - x1) * (y2 - y1) });
  }
  return out;
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const find = (needle) => {
  const lower = needle.toLowerCase();
  const matches = nodes().filter((n) => decode(n.text).toLowerCase().includes(lower) || decode(n.desc).toLowerCase().includes(lower));
  return matches.sort((a, b) => Number(b.clickable) - Number(a.clickable) || a.area - b.area)[0];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'shot': {
    writeFileSync(args[0], adb(['exec-out', 'screencap', '-p']));
    console.log(`saved ${args[0]}`);
    break;
  }
  case 'tap': {
    const node = find(args[0]);
    if (!node) {
      console.error(`not found: ${args[0]}`);
      process.exit(1);
    }
    adb(['shell', 'input', 'tap', String(node.x), String(node.y)]);
    console.log(`tapped "${args[0]}" at ${node.x},${node.y}`);
    break;
  }
  case 'tapxy':
    adb(['shell', 'input', 'tap', args[0], args[1]]);
    break;
  case 'type':
    adb(['shell', 'input', 'text', args[0].replace(/ /g, '%s').replace(/([&|;<>()$`\\"'*?#])/g, '\\$1')]);
    break;
  case 'wait': {
    const deadline = Date.now() + Number(args[1] ?? 30) * 1000;
    while (Date.now() < deadline) {
      if (find(args[0])) {
        console.log(`found "${args[0]}"`);
        process.exit(0);
      }
      await sleep(1000);
    }
    console.error(`timeout waiting for "${args[0]}"`);
    process.exit(1);
  }
  case 'texts':
    for (const n of nodes()) if (n.text || n.desc) console.log(`${n.clickable ? '*' : ' '} ${decode(n.text || n.desc)}  @${n.x},${n.y}`);
    break;
  case 'back':
    adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
    break;
  case 'enter':
    adb(['shell', 'input', 'keyevent', 'KEYCODE_ENTER']);
    break;
  case 'scroll-down':
    adb(['shell', 'input', 'swipe', '540', '1800', '540', '700', '350']);
    break;
  case 'scroll-up':
    adb(['shell', 'input', 'swipe', '540', '700', '540', '1800', '350']);
    break;
  default:
    console.log('commands: shot, tap, tapxy, type, wait, texts, back, enter, scroll-down, scroll-up');
}
