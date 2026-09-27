#!/usr/bin/env node
/**
 * Renders the Broadcast brand mark into the Expo app's icon, splash and favicon PNGs.
 *
 *   node scripts/render-brand-assets.mjs             -> apps/mobile/assets/images/*.png
 *   node scripts/render-brand-assets.mjs --preview   -> also D:\dev\tmp\brand-preview.png (contact sheet:
 *                                                       launcher icon under circle / squircle / rounded-square
 *                                                       masks at 192 and 48 px, plus every asset)
 *   node scripts/render-brand-assets.mjs --compare   -> D:\dev\tmp\brand-compare.png (bold-mark candidates)
 *
 * Geometry comes straight from apps/mobile/src/components/brand/brand-geometry.ts (Node strips the
 * types), so the icons always match the in-app mark:
 *   - launcher icon: MARK_SPECS.bold, solid white on a luminous brand-gradient tile;
 *   - splash image: MARK_SPECS.regular, gradient on dark (the splash is ink).
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const geometryFile = join(root, 'apps/mobile/src/components/brand/brand-geometry.ts');
const outDir = join(root, 'apps/mobile/assets/images');
const g = await import(pathToFileURL(geometryFile).href);

// Mirrors `brand` in apps/mobile/src/theme/tokens.ts ("Aurora Night"), plus the icon tile's shades.
const c = {
  start: '#6366F1', // indigo
  mid: '#8B5CF6', // violet
  end: '#F0A6CA', // soft rose
  warm: '#FDBA74', // orbit dot
  ink: '#0B1020', // midnight
  // Launcher tile
  indigoDeep: '#4F46E5',
  violetGlow: '#A78BFA',
  roseLight: '#F8C8DE',
  shadow: '#1E1B4B',
  vignette: '#0B1020',
  whiteTint: '#F3F0FF',
};

const VB = g.VIEWBOX;

// ---------------------------------------------------------------------------------------------
// Mark
// ---------------------------------------------------------------------------------------------

/** Furthest painted point of a spec from the viewBox centre (viewBox units). */
function extentOf(spec) {
  const cx = VB / 2;
  const at = (r, deg) => ({ x: spec.center.x + r * Math.cos((deg * Math.PI) / 180), y: spec.center.y + r * Math.sin((deg * Math.PI) / 180) });
  let max = 0;
  for (const r of spec.radii) {
    for (let a = -spec.sweepDeg; a <= spec.sweepDeg; a += 1) {
      const p = at(r, a);
      max = Math.max(max, Math.hypot(p.x - cx, p.y - cx) + spec.stroke / 2);
    }
  }
  for (const v of spec.triangle) max = Math.max(max, Math.hypot(spec.center.x + v.x - cx, spec.center.y + v.y - cx));
  return max;
}

/**
 * Mark markup in viewBox units. `paint` is a colour or url(); the dot (if any) is knocked out of the
 * outer arc with a mask so it reads on any background.
 */
function markMarkup(id, shapes, { paint, dotPaint }) {
  let defs = '';
  let arcGroupAttr = '';
  if (shapes.dot && !shapes.dot.detached) {
    defs += `<mask id="${id}-knock" maskUnits="userSpaceOnUse" x="0" y="0" width="${VB}" height="${VB}">
      <rect width="${VB}" height="${VB}" fill="#fff"/><circle cx="${shapes.dot.x}" cy="${shapes.dot.y}" r="${shapes.dot.r + shapes.dot.gap}" fill="#000"/></mask>`;
    arcGroupAttr = ` mask="url(#${id}-knock)"`;
  }
  const arcs = shapes.arcs.map((d) => `<path d="${d}" fill="none" stroke="${paint}" stroke-width="${shapes.stroke}" stroke-linecap="round"/>`).join('');
  const dot = shapes.dot ? `<circle cx="${shapes.dot.x}" cy="${shapes.dot.y}" r="${shapes.dot.r}" fill="${dotPaint ?? paint}"/>` : '';
  return { defs, body: `<path d="${shapes.core}" fill="${paint}"/><g${arcGroupAttr}>${arcs}</g>${dot}` };
}

function brandGradientDef(id) {
  const a = g.GRADIENT_AXIS;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}">
    <stop offset="${g.GRADIENT_OFFSETS[0]}" stop-color="${c.start}"/><stop offset="${g.GRADIENT_OFFSETS[1]}" stop-color="${c.mid}"/><stop offset="${g.GRADIENT_OFFSETS[2]}" stop-color="${c.end}"/></linearGradient>`;
}

/**
 * The bold white launcher mark with depth: a soft dark-violet drop shadow (down-right) under a
 * white body that cools very slightly towards the bottom. Placed so its furthest point sits
 * `radiusPx` from (cx, cy) in the target canvas.
 */
function whiteMark(id, spec, cx, cy, radiusPx, { shadow = true, mono = false } = {}) {
  const shapes = g.buildMark(spec);
  const s = radiusPx / extentOf(spec);
  const place = (dx = 0, dy = 0) => `translate(${cx - (VB / 2) * s + dx} ${cy - (VB / 2) * s + dy}) scale(${s})`;
  if (mono) {
    const m = markMarkup(`${id}-m`, shapes, { paint: '#FFFFFF' });
    return { defs: m.defs, body: `<g transform="${place()}">${m.body}</g>` };
  }
  const body = markMarkup(`${id}-b`, shapes, { paint: `url(#${id}-white)` });
  const shade = markMarkup(`${id}-s`, shapes, { paint: c.shadow });
  const unit = radiusPx / 46; // shadow scales with the mark
  const defs = `${body.defs}${shade.defs}
    <linearGradient id="${id}-white" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="0" y2="100">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="${c.whiteTint}"/></linearGradient>
    <filter id="${id}-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${2.2 * unit}"/></filter>
    <filter id="${id}-blur2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${0.7 * unit}"/></filter>`;
  const shadows = shadow
    ? `<g filter="url(#${id}-blur)" opacity="0.28"><g transform="${place(2.2 * unit, 3.4 * unit)}">${shade.body}</g></g>
       <g filter="url(#${id}-blur2)" opacity="0.18"><g transform="${place(0.6 * unit, 1 * unit)}">${shade.body}</g></g>`
    : '';
  return { defs, body: `${shadows}<g transform="${place()}">${body.body}</g>` };
}

/** Gradient-on-dark regular mark (splash image). */
function gradientMark(id, cx, cy, radiusPx) {
  const spec = g.MARK_SPECS.regular;
  const s = radiusPx / extentOf(spec);
  const m = markMarkup(id, g.buildMark(spec), { paint: `url(#${id}-grad)`, dotPaint: c.warm });
  return {
    defs: brandGradientDef(`${id}-grad`) + m.defs,
    body: `<g transform="translate(${cx - (VB / 2) * s} ${cy - (VB / 2) * s}) scale(${s})">${m.body}</g>`,
  };
}

// ---------------------------------------------------------------------------------------------
// Tile background: layered radial gradients over a diagonal ramp, designed in the coordinates of
// the *visible* square (x0, y0, w) so it looks right both full-bleed and inside the adaptive crop.
// ---------------------------------------------------------------------------------------------

function tile(id, size, x0, y0, w) {
  const X = (u) => x0 + u * w;
  const Y = (v) => y0 + v * w;
  const R = (k) => k * w;
  const radial = (gid, cx, cy, r, stops) =>
    `<radialGradient id="${id}-${gid}" gradientUnits="userSpaceOnUse" cx="${X(cx)}" cy="${Y(cy)}" r="${R(r)}">${stops
      .map(([o, col, a]) => `<stop offset="${o}" stop-color="${col}" stop-opacity="${a}"/>`)
      .join('')}</radialGradient>`;
  const defs = `
    <linearGradient id="${id}-base" gradientUnits="userSpaceOnUse" x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}">
      <stop offset="0" stop-color="${c.indigoDeep}"/><stop offset="0.3" stop-color="${c.start}"/>
      <stop offset="0.7" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.end}"/></linearGradient>
    ${radial('indigo', 0.05, 0.05, 0.75, [[0, c.indigoDeep, 0.85], [0.5, c.indigoDeep, 0.4], [1, c.indigoDeep, 0]])}
    ${radial('violet', 0.5, 0.55, 0.55, [[0, c.violetGlow, 0.35], [1, c.mid, 0]])}
    ${radial('bloom', 1.02, 1.04, 0.6, [[0, c.roseLight, 0.95], [0.4, c.end, 0.55], [1, c.end, 0]])}
    ${radial('vignette', 0.5, 0.45, 0.8, [[0.6, c.vignette, 0], [1, c.vignette, 0.28]])}
    ${radial('glass', 0.2, 0.1, 0.6, [[0, '#FFFFFF', 0.16], [0.55, '#FFFFFF', 0.04], [1, '#FFFFFF', 0]])}`;
  const layers = ['base', 'indigo', 'violet', 'bloom', 'vignette', 'glass']
    .map((l) => `<rect width="${size}" height="${size}" fill="url(#${id}-${l})"/>`)
    .join('');
  return { defs, body: layers };
}

function svg(size, parts, background) {
  const bg = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs>${parts
    .map((p) => p.defs)
    .join('')}</defs>${bg}${parts.map((p) => p.body).join('')}</svg>`;
}

const png = (markup, size) => new Resvg(markup, { fitTo: { mode: 'width', value: size } }).render().asPng();

// ---------------------------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------------------------

// Adaptive icons: 108 dp layers, the launcher shows the central 72 dp through its mask, and content
// must survive the 66 dp safe circle. Fill 86 % of that circle's radius: bold but never clipped.
const SAFE_R = (size) => (size * (66 / 108)) / 2;
const FILL = 0.86;
const ADAPTIVE_CROP = (size) => ({ x0: size / 6, y0: size / 6, w: (size * 2) / 3 });
/** Full-bleed icon (Play Store / legacy / iOS): the same proportions as the adaptive visible area. */
const FULL_R = (size) => (size / 2) * (66 / 72) * FILL;

const bold = g.MARK_SPECS.bold;

const builders = {
  'icon.png': (s) => svg(s, [tile('t', s, 0, 0, s), whiteMark('m', bold, s / 2, s / 2, FULL_R(s))]),
  'android-icon-foreground.png': (s) => svg(s, [whiteMark('m', bold, s / 2, s / 2, SAFE_R(s) * FILL)]),
  'android-icon-background.png': (s) => {
    const k = ADAPTIVE_CROP(s);
    return svg(s, [tile('t', s, k.x0, k.y0, k.w)]);
  },
  'android-icon-monochrome.png': (s) => svg(s, [whiteMark('m', bold, s / 2, s / 2, SAFE_R(s) * FILL, { mono: true })]),
  // Native splash image, shown at `imageWidth` on ink: the gradient mark, as in the animated splash.
  'splash-icon.png': (s) => svg(s, [gradientMark('m', s / 2, s / 2, s * 0.47)]),
  favicon: null,
};
const sizes = {
  'icon.png': 1024,
  'android-icon-foreground.png': 512,
  'android-icon-background.png': 512,
  'android-icon-monochrome.png': 432,
  'splash-icon.png': 512,
  'favicon.png': 48,
};

/** Launcher tile as it appears on a home screen: visible area only, clipped to `mask`. */
function launcherTile(id, px, spec, mask) {
  const clip = maskShape(px, mask);
  const t = tile(`${id}t`, px, 0, 0, px);
  const m = whiteMark(`${id}m`, spec, px / 2, px / 2, (px / 2) * (66 / 72) * FILL);
  return {
    defs: `${t.defs}${m.defs}<clipPath id="${id}-clip">${clip}</clipPath>`,
    body: `<g clip-path="url(#${id}-clip)">${t.body}${m.body}</g>`,
  };
}

function maskShape(px, mask) {
  if (mask === 'circle') return `<circle cx="${px / 2}" cy="${px / 2}" r="${px / 2}"/>`;
  if (mask === 'rounded') return `<rect width="${px}" height="${px}" rx="${px * 0.2}"/>`;
  if (mask === 'square') return `<rect width="${px}" height="${px}"/>`;
  // Squircle: superellipse |x|^4 + |y|^4 = 1 (Android's squircle mask).
  const pts = [];
  for (let i = 0; i < 360; i++) {
    const t = (i / 360) * Math.PI * 2;
    const cs = Math.cos(t);
    const sn = Math.sin(t);
    const x = Math.sign(cs) * Math.abs(cs) ** (2 / 4);
    const y = Math.sign(sn) * Math.abs(sn) ** (2 / 4);
    pts.push(`${((x + 1) * px) / 2},${((y + 1) * px) / 2}`);
  }
  return `<polygon points="${pts.join(' ')}"/>`;
}

// Favicon: the launcher tile in a rounded square (browsers show it as-is).
builders['favicon.png'] = (s) => svg(s, [launcherTile('f', s, bold, 'rounded')]);
delete builders.favicon;

mkdirSync(outDir, { recursive: true });
const rendered = {};
for (const [file, build] of Object.entries(builders)) {
  const size = sizes[file];
  const buf = png(build(size), size);
  writeFileSync(join(outDir, file), buf);
  rendered[file] = buf;
  console.log(`${file.padEnd(30)} ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}

// ---------------------------------------------------------------------------------------------
// Contact sheets
// ---------------------------------------------------------------------------------------------

function sheetRow(specs, y, labelPrefix = '') {
  let body = '';
  let defs = '';
  let x = 20;
  let n = 0;
  for (const [name, spec] of specs) {
    for (const mask of ['circle', 'squircle', 'rounded']) {
      const t = launcherTile(`r${y}${n++}`, 192, spec, mask);
      defs += t.defs;
      body += `<g transform="translate(${x} ${y})">${t.body}</g>`;
      x += 212;
    }
    for (const px of [96, 48]) {
      const t = launcherTile(`r${y}${n++}`, px, spec, 'circle');
      defs += t.defs;
      body += `<g transform="translate(${x} ${y + 192 - px})">${t.body}</g>`;
      x += px + 20;
    }
    body += `<text x="${x}" y="${y + 20}" fill="#9CA3AF" font-size="16" font-family="sans-serif">${labelPrefix}${name}</text>`;
    x = 20;
    y += 232;
  }
  return { defs, body, y };
}

function wallpaperStrip(y) {
  // 48 px icons on light and dark home screens, as they'd actually be seen.
  let defs = '';
  let body = '';
  let x = 20;
  for (const bgc of ['#F3F4F6', '#1F2937', '#3B82F6']) {
    body += `<rect x="${x}" y="${y}" width="260" height="96" rx="12" fill="${bgc}"/>`;
    for (let i = 0; i < 3; i++) {
      const t = launcherTile(`w${x}${i}`, 48, bold, ['circle', 'squircle', 'rounded'][i]);
      defs += t.defs;
      body += `<g transform="translate(${x + 24 + i * 76} ${y + 24})">${t.body}</g>`;
    }
    x += 280;
  }
  return { defs, body };
}

if (process.argv.includes('--preview')) {
  const W = 1500;
  const row = sheetRow([['bold (launcher)', bold]], 20);
  const wp = wallpaperStrip(row.y);
  let y = row.y + 116;
  let body = '';
  let x = 20;
  for (const [file, buf] of Object.entries(rendered)) {
    const bgc = file.includes('foreground') || file.includes('monochrome') || file.includes('splash') ? '#6B7280' : '#374151';
    body += `<rect x="${x}" y="${y}" width="220" height="220" fill="${bgc}"/><image x="${x}" y="${y}" width="220" height="220" href="data:image/png;base64,${buf.toString('base64')}"/>`;
    body += `<text x="${x}" y="${y + 240}" fill="#9CA3AF" font-size="13" font-family="sans-serif">${file}</text>`;
    x += 240;
  }
  const H = y + 260;
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${row.defs}${wp.defs}</defs><rect width="100%" height="100%" fill="#111827"/>${row.body}${wp.body}${body}</svg>`;
  mkdirSync('D:/dev/tmp', { recursive: true });
  writeFileSync('D:/dev/tmp/brand-preview.png', new Resvg(sheet, { font: { loadSystemFonts: true } }).render().asPng());
  console.log('preview -> D:/dev/tmp/brand-preview.png');
}

if (process.argv.includes('--compare')) {
  const three = {
    ...bold,
    center: { x: 36, y: 60 },
    radii: [30, 45, 60],
    stroke: 9,
    sweepDeg: 46,
    triangle: [
      { x: 24, y: 0 },
      { x: -15, y: 22.5 },
      { x: -15, y: -22.5 },
    ],
    corner: 11,
  };
  const sat = (deg, r, gapU) => ({ ...bold, dot: { radius: r, gap: gapU, angleDeg: deg, detached: true } });
  const row = sheetRow(
    [
      ['A: 2 arcs', bold],
      ['B: 3 arcs', three],
      ['D: satellite -40', sat(-40, 6.5, 4.5)],
      ['E: satellite -36 big', sat(-36, 7.5, 5)],
    ],
    20,
  );
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="${row.y + 20}"><defs>${row.defs}</defs><rect width="100%" height="100%" fill="#111827"/>${row.body}</svg>`;
  mkdirSync('D:/dev/tmp', { recursive: true });
  writeFileSync('D:/dev/tmp/brand-compare.png', new Resvg(sheet, { font: { loadSystemFonts: true } }).render().asPng());
  console.log('compare -> D:/dev/tmp/brand-compare.png');
}
