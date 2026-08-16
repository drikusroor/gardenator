/**
 * Paving layout.
 *
 * Produces the position and angle of every individual paving unit inside a
 * polygon. Working out real unit positions (rather than faking it with a
 * repeating texture) is what lets the app answer "how many tiles do I need"
 * and "does a whole tile land against the wall".
 */

import { bounds, pointInPolygon, rotate } from '../../core/geometry';
import type { TileSpec, Vec2 } from '../../core/types';

export interface TilePlacement {
  x: number;
  z: number;
  /** Radians about Y, relative to the surface. */
  angle: number;
  width: number;
  depth: number;
}

/** How much bigger than the polygon to generate before clipping to it. */
const MARGIN = 2;

/**
 * Lays `spec` across `polygon` (surface-local coordinates).
 *
 * A unit is kept when its centre falls inside the polygon; the surface's base
 * slab shows through at the border, which reads as the cut tiles you would
 * actually lay there.
 */
export function layTiles(polygon: Vec2[], spec: TileSpec, patternAngle = 0): TilePlacement[] {
  if (polygon.length < 3 || spec.width <= 0 || spec.depth <= 0) return [];

  // Generate in pattern space (polygon rotated back), then rotate results out.
  const local = polygon.map((p) => rotate(p, -patternAngle));
  const { min, max } = bounds(local);
  const box = {
    minX: min.x - MARGIN,
    maxX: max.x + MARGIN,
    minZ: min.z - MARGIN,
    maxZ: max.z + MARGIN,
  };

  const raw: TilePlacement[] = [];
  switch (spec.pattern) {
    case 'herringbone':
      herringbone(raw, spec, box);
      break;
    case 'basketweave':
      basketweave(raw, spec, box);
      break;
    case 'running':
      grid(raw, spec, box, 0.5);
      break;
    case 'stack':
    case 'grid':
    default:
      grid(raw, spec, box, 0);
      break;
  }

  const out: TilePlacement[] = [];
  for (const placement of raw) {
    const centre = rotate({ x: placement.x, z: placement.z }, patternAngle);
    if (!pointInPolygon(centre, polygon)) continue;
    out.push({
      x: centre.x,
      z: centre.z,
      angle: placement.angle + patternAngle,
      width: placement.width,
      depth: placement.depth,
    });
  }
  return out;
}

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Plain or offset rows. `offset` is a fraction of a unit width per row. */
function grid(out: TilePlacement[], spec: TileSpec, box: Box, offset: number) {
  const pitchX = spec.width + spec.gap;
  const pitchZ = spec.depth + spec.gap;
  const rowStart = Math.floor(box.minZ / pitchZ) - 1;
  const rowEnd = Math.ceil(box.maxZ / pitchZ) + 1;
  for (let row = rowStart; row <= rowEnd; row++) {
    const shift = (Math.abs(row) % 2) * offset * pitchX;
    const colStart = Math.floor((box.minX - shift) / pitchX) - 1;
    const colEnd = Math.ceil((box.maxX - shift) / pitchX) + 1;
    for (let col = colStart; col <= colEnd; col++) {
      out.push({
        x: col * pitchX + shift + spec.width / 2,
        z: row * pitchZ + spec.depth / 2,
        angle: 0,
        width: spec.width,
        depth: spec.depth,
      });
    }
  }
}

/**
 * True 90° herringbone.
 *
 * The tiling repeats on the lattice u = (w, w), v = (d, -d), with two units
 * per cell: one laid across and one laid along, meeting at their ends. It is
 * exact for the usual 2:1 paver and still interlocks for other ratios.
 */
function herringbone(out: TilePlacement[], spec: TileSpec, box: Box) {
  const long = Math.max(spec.width, spec.depth);
  const short = Math.min(spec.width, spec.depth);
  const l = long + spec.gap;
  const s = short + spec.gap;

  // Lattice inverse: m = (x + z) / 2s, n = (x - z) / 2l.
  const corners = [
    { x: box.minX, z: box.minZ },
    { x: box.maxX, z: box.minZ },
    { x: box.minX, z: box.maxZ },
    { x: box.maxX, z: box.maxZ },
  ];
  let minM = Infinity;
  let maxM = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  for (const c of corners) {
    const m = (c.x + c.z) / (2 * s);
    const n = (c.x - c.z) / (2 * l);
    minM = Math.min(minM, m);
    maxM = Math.max(maxM, m);
    minN = Math.min(minN, n);
    maxN = Math.max(maxN, n);
  }
  // The two lattice directions are skewed relative to the box, so pad well.
  const pad = 2 + Math.ceil((l + s) / Math.min(l, s));

  for (let m = Math.floor(minM) - pad; m <= Math.ceil(maxM) + pad; m++) {
    for (let n = Math.floor(minN) - pad; n <= Math.ceil(maxN) + pad; n++) {
      const ox = m * s + n * l;
      const oz = m * s - n * l;
      // Unit laid "along": occupies [ox, ox+short] x [oz, oz+long].
      out.push({
        x: ox + short / 2,
        z: oz + long / 2,
        angle: Math.PI / 2,
        width: long,
        depth: short,
      });
      // Unit laid "across": occupies [ox+short, ox+short+long] x [oz, oz+short].
      out.push({
        x: ox + short + long / 2,
        z: oz + short / 2,
        angle: 0,
        width: long,
        depth: short,
      });
    }
  }
}

/** Square modules alternating between stacked and side-by-side runs. */
function basketweave(out: TilePlacement[], spec: TileSpec, box: Box) {
  const long = Math.max(spec.width, spec.depth);
  const short = Math.min(spec.width, spec.depth);
  const perModule = Math.max(1, Math.round(long / short));
  const module = long + spec.gap;

  const colStart = Math.floor(box.minX / module) - 1;
  const colEnd = Math.ceil(box.maxX / module) + 1;
  const rowStart = Math.floor(box.minZ / module) - 1;
  const rowEnd = Math.ceil(box.maxZ / module) + 1;

  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const ox = col * module;
      const oz = row * module;
      const horizontal = (((row + col) % 2) + 2) % 2 === 0;
      for (let k = 0; k < perModule; k++) {
        const along = (k + 0.5) * (module / perModule);
        if (horizontal) {
          out.push({ x: ox + long / 2, z: oz + along, angle: 0, width: long, depth: short });
        } else {
          out.push({
            x: ox + along,
            z: oz + long / 2,
            angle: Math.PI / 2,
            width: long,
            depth: short,
          });
        }
      }
    }
  }
}
