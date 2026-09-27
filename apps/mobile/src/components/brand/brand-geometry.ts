/**
 * Broadcast brand mark geometry (design-system/social-publisher/BROADCAST.md, "Brand mark and loader").
 *
 * One source of truth for the app components and scripts/render-brand-assets.mjs, which imports this
 * file directly (Node type stripping), so keep it dependency-free and erasable-only TypeScript.
 *
 * Coordinates live in a 120 x 120 viewBox. The core (a rounded "play" triangle) sits at CORE_CENTER;
 * three concentric arcs fan out to the right of it, and a small dot rides the outer arc.
 */

export const VIEWBOX = 120;

/**
 * Centre of the arcs and (almost exactly) the triangle's centroid. The mark's bounding box runs
 * x 24 -> 95, y 15.6 -> 104.4; x = 38 splits the difference between the box centre and the visual
 * mass centre (the arcs outweigh the solid core), so the mark reads as centred in a circle or square.
 */
export const CORE_CENTER = { x: 38, y: 60 } as const;

/** Arc radii from CORE_CENTER; 12 apart, so with a 6 stroke each gap equals the stroke width. */
export const ARC_RADII = [30, 42, 54] as const;
export const ARC_STROKE = 6;
/** Half sweep of every arc: they run from -50 deg (up) to +50 deg (down); 0 deg points right. */
export const ARC_SWEEP_DEG = 50;

/** Triangle vertices relative to CORE_CENTER: near-equilateral (height 40, base 46), tip pointing right. */
export const TRIANGLE_VERTICES = [
  { x: 26, y: 0 },
  { x: -14, y: 23 },
  { x: -14, y: -23 },
] as const;
/** Distance from each vertex where the rounded corner starts, and the cubic handle ratio (0.6 = soft, continuous). */
export const TRIANGLE_CORNER = 11;
export const TRIANGLE_HANDLE = 0.6;

/** The orbiting dot: rest angle on the outer arc, travel amplitude for the loop, and a white halo ring. */
export const DOT = {
  radius: 4.5,
  halo: 1.5,
  restAngleDeg: -30,
  orbitAmplitudeDeg: 44,
  orbitRadius: 54,
} as const;

/** Glow sits on the optical centre of the whole mark (not the core). */
export const GLOW_CENTER = { x: 60, y: 60 } as const;
export const GLOW_RADIUS = 58;

/**
 * Gradient axis (userSpaceOnUse): violet core -> magenta arcs -> orange at the outer arc's foot.
 * Mostly horizontal with a slight downward tilt so the signal "heats up" as it travels outward.
 */
export const GRADIENT_AXIS = { x1: 26, y1: 36, x2: 96, y2: 92 } as const;
export const GRADIENT_OFFSETS = [0.08, 0.52, 1] as const;

const round = (n: number) => Math.round(n * 1000) / 1000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Rounded polygon as a flat list of numbers: per corner [ax, ay, c1x, c1y, c2x, c2y, bx, by], where a/b
 * are where the rounding starts/ends and c1/c2 the cubic handles. Straight edges join b(i) to a(i+1).
 */
function roundedPolygonPoints(points: readonly { x: number; y: number }[], corner: number, handle: number): number[] {
  const n = points.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const toPrev = { x: prev.x - cur.x, y: prev.y - cur.y };
    const toNext = { x: next.x - cur.x, y: next.y - cur.y };
    const lp = Math.hypot(toPrev.x, toPrev.y);
    const ln = Math.hypot(toNext.x, toNext.y);
    const a = { x: cur.x + (toPrev.x / lp) * corner, y: cur.y + (toPrev.y / lp) * corner };
    const b = { x: cur.x + (toNext.x / ln) * corner, y: cur.y + (toNext.y / ln) * corner };
    const c1 = { x: a.x + (cur.x - a.x) * handle, y: a.y + (cur.y - a.y) * handle };
    const c2 = { x: b.x + (cur.x - b.x) * handle, y: b.y + (cur.y - b.y) * handle };
    out.push(a.x, a.y, c1.x, c1.y, c2.x, c2.y, b.x, b.y);
  }
  return out.map(round);
}

/** Corner geometry of the rounded play triangle, in viewBox coordinates (see roundedPolygonPoints). */
export const CORE_POINTS = roundedPolygonPoints(
  TRIANGLE_VERTICES.map((p) => ({ x: CORE_CENTER.x + p.x, y: CORE_CENTER.y + p.y })),
  TRIANGLE_CORNER,
  TRIANGLE_HANDLE,
);

/** Triangle centroid: the core scales about this point. */
export const CORE_CENTROID = { x: CORE_CENTER.x - 2 / 3, y: CORE_CENTER.y } as const;

/**
 * Path data for the core scaled by `scale` about CORE_CENTROID. A worklet, so the intro can animate
 * the path itself on the UI thread (view transforms around a separate Svg don't repaint reliably on Android).
 */
export function corePath(points: readonly number[], scale: number): string {
  'worklet';
  const ox = CORE_CENTER.x - 2 / 3;
  const oy = CORE_CENTER.y;
  const p = (i: number) => `${Math.round((ox + (points[i] - ox) * scale) * 1000) / 1000} ${Math.round((oy + (points[i + 1] - oy) * scale) * 1000) / 1000}`;
  let d = '';
  for (let i = 0; i < points.length; i += 8) {
    d += `${i === 0 ? 'M' : 'L'}${p(i)}C${p(i + 2)} ${p(i + 4)} ${p(i + 6)}`;
  }
  return `${d}Z`;
}

/** The rounded play triangle at rest, in viewBox coordinates. */
export const CORE_PATH = corePath(CORE_POINTS, 1);

/** A point on a circle around CORE_CENTER; 0 deg points right, negative angles go up. */
export function pointOnArc(radius: number, angleDeg: number): { x: number; y: number } {
  return {
    x: CORE_CENTER.x + radius * Math.cos(rad(angleDeg)),
    y: CORE_CENTER.y + radius * Math.sin(rad(angleDeg)),
  };
}

/**
 * An arc as two subpaths that both start at its middle (0 deg): one sweeps up, one sweeps down.
 * Dash patterns restart per subpath, so a single strokeDashoffset draws the arc from the middle
 * outwards in both directions. A single path means no double-painted overlap under opacity.
 */
export function arcPath(radius: number): string {
  const mid = pointOnArc(radius, 0);
  const top = pointOnArc(radius, -ARC_SWEEP_DEG);
  const bottom = pointOnArc(radius, ARC_SWEEP_DEG);
  const m = `M${round(mid.x)} ${round(mid.y)}`;
  return `${m}A${radius} ${radius} 0 0 0 ${round(top.x)} ${round(top.y)}${m}A${radius} ${radius} 0 0 1 ${round(bottom.x)} ${round(bottom.y)}`;
}

export const ARC_PATHS = ARC_RADII.map(arcPath);

/** Length of one half (subpath) of an arc: the dash unit for the draw-in. */
export function arcHalfLength(radius: number): number {
  return radius * rad(ARC_SWEEP_DEG);
}

/** Rest position of the dot. */
export const DOT_REST = pointOnArc(DOT.orbitRadius, DOT.restAngleDeg);

// ---------------------------------------------------------------------------------------------
// Weights. `regular` is the geometry above (tuned for the animated splash and loader). `bold` is
// the chunkier launcher-icon cut: fewer, heavier arcs and a bigger core so it reads at 48 px.
// ---------------------------------------------------------------------------------------------

export type MarkWeight = 'regular' | 'bold';

export type MarkSpec = {
  center: { x: number; y: number };
  radii: readonly number[];
  stroke: number;
  sweepDeg: number;
  triangle: readonly { x: number; y: number }[];
  corner: number;
  handle: number;
  /**
   * Dot on the outer arc, or null for none. By default it's knocked out of the arc; with `detached`
   * the outer arc instead stops short and the dot sits past its top end, `gap` away from the cap.
   */
  dot: { radius: number; gap: number; angleDeg: number; detached?: boolean } | null;
};

export type MarkShapes = {
  core: string;
  arcs: string[];
  stroke: number;
  dot: { x: number; y: number; r: number; gap: number; detached: boolean } | null;
};

export const MARK_SPECS: Record<MarkWeight, MarkSpec> = {
  regular: {
    center: CORE_CENTER,
    radii: ARC_RADII,
    stroke: ARC_STROKE,
    sweepDeg: ARC_SWEEP_DEG,
    triangle: TRIANGLE_VERTICES,
    corner: TRIANGLE_CORNER,
    handle: TRIANGLE_HANDLE,
    dot: { radius: DOT.radius, gap: DOT.halo, angleDeg: DOT.restAngleDeg },
  },
  // Two arcs at 1.7x stroke; tip-to-arc and arc-to-arc gaps both ~8. Centred optically like regular.
  bold: {
    center: { x: 39, y: 60 },
    radii: [34, 52],
    stroke: 10,
    sweepDeg: 48,
    triangle: [
      { x: 27, y: 0 },
      { x: -16, y: 25 },
      { x: -16, y: -25 },
    ],
    corner: 13,
    handle: 0.6,
    dot: null,
  },
};

/** Static path data for a mark spec, in viewBox coordinates. */
export function buildMark(spec: MarkSpec): MarkShapes {
  const at = (r: number, deg: number) => ({ x: spec.center.x + r * Math.cos(rad(deg)), y: spec.center.y + r * Math.sin(rad(deg)) });
  const pts = roundedPolygonPoints(
    spec.triangle.map((p) => ({ x: spec.center.x + p.x, y: spec.center.y + p.y })),
    spec.corner,
    spec.handle,
  );
  let core = '';
  for (let i = 0; i < pts.length; i += 8) {
    core += `${i === 0 ? 'M' : 'L'}${pts[i]} ${pts[i + 1]}C${pts[i + 2]} ${pts[i + 3]} ${pts[i + 4]} ${pts[i + 5]} ${pts[i + 6]} ${pts[i + 7]}`;
  }
  const outer = spec.radii.length - 1;
  const arcs = spec.radii.map((r, i) => {
    let topDeg = -spec.sweepDeg;
    if (spec.dot?.detached && i === outer) {
      // Stop the arc so its round cap ends `gap` before the dot.
      topDeg = spec.dot.angleDeg + ((spec.dot.radius + spec.dot.gap + spec.stroke / 2) / r) * (180 / Math.PI);
    }
    const mid = at(r, 0);
    const top = at(r, topDeg);
    const bottom = at(r, spec.sweepDeg);
    const m = `M${round(mid.x)} ${round(mid.y)}`;
    return `${m}A${r} ${r} 0 0 0 ${round(top.x)} ${round(top.y)}${m}A${r} ${r} 0 0 1 ${round(bottom.x)} ${round(bottom.y)}`;
  });
  let dot: MarkShapes['dot'] = null;
  if (spec.dot) {
    const p = at(spec.radii[spec.radii.length - 1], spec.dot.angleDeg);
    dot = { x: round(p.x), y: round(p.y), r: spec.dot.radius, gap: spec.dot.gap, detached: spec.dot.detached ?? false };
  }
  return { core: `${core}Z`, arcs, stroke: spec.stroke, dot };
}

export const MARK_SHAPES: Record<MarkWeight, MarkShapes> = {
  regular: buildMark(MARK_SPECS.regular),
  bold: buildMark(MARK_SPECS.bold),
};
