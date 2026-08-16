/** Planar geometry helpers. All coordinates are metres on the XZ ground plane. */

import type { Vec2 } from './types';

export const v2 = (x: number, z: number): Vec2 => ({ x, z });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
export const length = (a: Vec2): number => Math.hypot(a.x, a.z);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.z - a.z);
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});

export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  return len < 1e-9 ? { x: 0, z: 0 } : { x: a.x / len, z: a.z / len };
}

/** Rotates 90° so that (x,z) -> (-z,x); the left-hand normal of a direction. */
export const perp = (a: Vec2): Vec2 => ({ x: -a.z, z: a.x });

export function rotate(a: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c - a.z * s, z: a.x * s + a.z * c };
}

/** Local point -> world, applying the object's rotation then position. */
export function toWorld(point: Vec2, origin: Vec2, rotation: number): Vec2 {
  return add(rotate(point, rotation), origin);
}

/** World point -> object local space. */
export function toLocal(point: Vec2, origin: Vec2, rotation: number): Vec2 {
  return rotate(sub(point, origin), -rotation);
}

/** Signed area; positive when the ring winds counter-clockwise in XZ. */
export function signedArea(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
}

export const area = (points: Vec2[]): number => Math.abs(signedArea(points));

export function perimeter(points: Vec2[], closed: boolean): number {
  let total = 0;
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    total += distance(points[i], points[(i + 1) % points.length]);
  }
  return total;
}

export function centroid(points: Vec2[]): Vec2 {
  if (points.length === 0) return { x: 0, z: 0 };
  const a = signedArea(points);
  if (Math.abs(a) < 1e-9) {
    // Degenerate ring (a straight line): fall back to the average of vertices.
    return scale(
      points.reduce((acc, p) => add(acc, p), v2(0, 0)),
      1 / points.length,
    );
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * cross;
    cz += (p.z + q.z) * cross;
  }
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

export function bounds(points: Vec2[]): { min: Vec2; max: Vec2 } {
  const min = v2(Infinity, Infinity);
  const max = v2(-Infinity, -Infinity);
  for (const p of points) {
    min.x = Math.min(min.x, p.x);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.z = Math.max(max.z, p.z);
  }
  if (points.length === 0) return { min: v2(0, 0), max: v2(0, 0) };
  return { min, max };
}

/** Even-odd ray cast. Points exactly on an edge may go either way. */
export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = a.z > point.z !== b.z > point.z;
    if (straddles && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Closest point on segment a->b to p, and how far along (0..1) it lies. */
export function closestOnSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { point: Vec2; t: number; distance: number } {
  const ab = sub(b, a);
  const lenSq = dot(ab, ab);
  const t = lenSq < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / lenSq));
  const point = add(a, scale(ab, t));
  return { point, t, distance: distance(p, point) };
}

/**
 * Offsets a closed ring inward (negative) or outward (positive) by `amount`,
 * using the miter of adjacent edge normals. Good enough for garden-scale
 * shapes; very sharp spikes are clamped rather than trimmed.
 */
export function offsetPolygon(points: Vec2[], amount: number): Vec2[] {
  if (points.length < 3 || Math.abs(amount) < 1e-9) return points.map((p) => ({ ...p }));
  // Work in a consistent winding so "inward" means the same thing every time.
  const ring = signedArea(points) < 0 ? [...points].reverse() : points;
  const out: Vec2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i - 1 + ring.length) % ring.length];
    const cur = ring[i];
    const next = ring[(i + 1) % ring.length];

    const n1 = normalize(perp(normalize(sub(cur, prev))));
    const n2 = normalize(perp(normalize(sub(next, cur))));
    const bisector = normalize(add(n1, n2));
    const cos = dot(bisector, n1);
    // Cap the miter so a near-180° reflex corner does not shoot off to infinity.
    const miter = Math.abs(cos) < 0.2 ? 5 : 1 / cos;
    out.push(add(cur, scale(bisector, -amount * miter)));
  }
  return signedArea(points) < 0 ? out.reverse() : out;
}

/**
 * Samples a centripetal Catmull-Rom spline through `points`.
 * `segments` is the number of samples per span. Endpoints are duplicated so
 * the curve starts and ends exactly on the first and last control point.
 */
export function sampleSpline(points: Vec2[], segments = 12): Vec2[] {
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const pts = [points[0], ...points, points[points.length - 1]];
  const out: Vec2[] = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2];
    for (let s = 0; s < segments; s++) {
      out.push(catmullRom(p0, p1, p2, p3, s / segments));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) };
}

/** Resamples a polyline to evenly spaced points, `spacing` metres apart. */
export function resample(points: Vec2[], spacing: number): Vec2[] {
  if (points.length < 2 || spacing <= 0) return points.map((p) => ({ ...p }));
  const out: Vec2[] = [{ ...points[0] }];
  let carry = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = distance(a, b);
    if (segLen < 1e-9) continue;
    let travelled = spacing - carry;
    while (travelled <= segLen) {
      out.push(lerp2(a, b, travelled / segLen));
      travelled += spacing;
    }
    carry = segLen - (travelled - spacing);
  }
  const last = points[points.length - 1];
  if (distance(out[out.length - 1], last) > 1e-6) out.push({ ...last });
  return out;
}

/** Unit tangents at each vertex of a polyline, averaged at interior joints. */
export function tangents(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const before = i > 0 ? normalize(sub(points[i], points[i - 1])) : null;
    const after = i < points.length - 1 ? normalize(sub(points[i + 1], points[i])) : null;
    if (before && after) out.push(normalize(add(before, after)));
    else out.push(before ?? after ?? v2(1, 0));
  }
  return out;
}

/**
 * Builds a constant-width ribbon around a polyline as two edge strips.
 * Corner vertices are mitred, so a right-angled turn keeps its full width.
 */
export function ribbon(points: Vec2[], width: number): { left: Vec2[]; right: Vec2[] } {
  const half = width / 2;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const before = i > 0 ? normalize(sub(points[i], points[i - 1])) : null;
    const after = i < points.length - 1 ? normalize(sub(points[i + 1], points[i])) : null;
    const dir = before && after ? normalize(add(before, after)) : (before ?? after ?? v2(1, 0));
    const n = perp(dir);
    // Widen the offset at a corner so the outer edge keeps the nominal width.
    const cos = before && after ? Math.max(0.35, Math.cos(angleBetween(before, after) / 2)) : 1;
    left.push(add(points[i], scale(n, half / cos)));
    right.push(add(points[i], scale(n, -half / cos)));
  }
  return { left, right };
}

export function angleBetween(a: Vec2, b: Vec2): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(normalize(a), normalize(b)))));
}

/** Axis-aligned rectangle as a ring, centred on the origin. */
export function rectangle(width: number, depth: number): Vec2[] {
  const w = width / 2;
  const d = depth / 2;
  return [v2(-w, -d), v2(w, -d), v2(w, d), v2(-w, d)];
}

export function circle(radius: number, segments = 24): Vec2[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return v2(Math.cos(a) * radius, Math.sin(a) * radius);
  });
}

export function snapValue(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

export function snapPoint(point: Vec2, step: number): Vec2 {
  return { x: snapValue(point.x, step), z: snapValue(point.z, step) };
}

/** Deterministic 0..1 pseudo-random stream, so scenes reload identically. */
export function makeRandom(seed: number): () => number {
  let state = (seed | 0) || 1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}
