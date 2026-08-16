/**
 * Block-by-block wall laying.
 *
 * Walls are built from real per-block geometry rather than a texture, because
 * the point of this tool is knowing how many blocks a wall takes and whether a
 * course lands where you want it. `layBlocks` is also what feeds the material
 * take-off in the inspector.
 */

import * as THREE from 'three';
import { distance, normalize, sub } from '../../core/geometry';
import type { BlockSpec, Vec2 } from '../../core/types';
import { faceMaterial, plainMaterial } from '../materials';
import { UNIT_BOX, boxMatrix, instanced } from './common';

export interface BlockPlacement {
  /** Centre of the block on the ground plane. */
  x: number;
  z: number;
  /** Bottom of the block. */
  y: number;
  /** Along the run — shorter than spec.length when the block is cut. */
  length: number;
  height: number;
  depth: number;
  /** Heading of the run, radians about Y. */
  angle: number;
  /** True when the block had to be cut to fit. */
  cut: boolean;
}

/** Height of a wall of `courses` courses, including the joints between them. */
export function wallHeight(spec: BlockSpec, courses: number): number {
  if (courses <= 0) return 0;
  return courses * spec.height + (courses - 1) * spec.joint;
}

export interface LayOptions {
  /** Treat the path as a closed ring. */
  closed: boolean;
  /** Edge indices to leave out (a gateway, or the open side of a bed). */
  skipEdges?: number[];
}

/**
 * Lays `courses` courses of `spec` along a polyline.
 *
 * Blocks are laid segment by segment so none of them straddles a corner, but
 * the bond offset is tracked along the whole run, so the staggering carries on
 * round corners the way a real wall does.
 */
export function layBlocks(
  path: Vec2[],
  spec: BlockSpec,
  courses: number,
  options: LayOptions,
): BlockPlacement[] {
  const placements: BlockPlacement[] = [];
  if (path.length < 2 || courses <= 0 || spec.length <= 0 || spec.height <= 0) return placements;

  const pitch = spec.length + spec.joint;
  const courseHeight = spec.height + spec.joint;
  const skip = new Set(options.skipEdges ?? []);
  const segmentCount = options.closed ? path.length : path.length - 1;

  // Precompute the segments and where each one starts along the whole run.
  const segments: { a: Vec2; b: Vec2; length: number; start: number; index: number }[] = [];
  let cumulative = 0;
  for (let i = 0; i < segmentCount; i++) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    const length = distance(a, b);
    if (length > 1e-6) segments.push({ a, b, length, start: cumulative, index: i });
    cumulative += length;
  }

  for (let course = 0; course < courses; course++) {
    const y = course * courseHeight;
    const bondShift = (course * spec.bondOffset * pitch) % pitch;

    for (const segment of segments) {
      if (skip.has(segment.index)) continue;
      const dir = normalize(sub(segment.b, segment.a));
      const angle = Math.atan2(dir.x, dir.z);

      // Corners: run the blocks a little past each interior joint so the two
      // walls interlock instead of leaving a notch the width of the wall.
      const extendStart = segment.start > 0 || options.closed ? spec.depth / 2 : 0;
      const extendEnd =
        segment.start + segment.length < cumulative - 1e-6 || options.closed ? spec.depth / 2 : 0;
      const from = -extendStart;
      const to = segment.length + extendEnd;

      // First block boundary at or before `from`, keeping the global bond.
      const globalFrom = segment.start + from;
      let s = from - mod(globalFrom - bondShift, pitch);

      while (s < to - 1e-6) {
        const blockStart = Math.max(s, from);
        const blockEnd = Math.min(s + spec.length, to);
        const length = blockEnd - blockStart;
        // Anything under 4 cm is a sliver no bricklayer would cut.
        if (length > 0.04) {
          const t = (blockStart + blockEnd) / 2;
          placements.push({
            x: segment.a.x + dir.x * t,
            z: segment.a.z + dir.z * t,
            y,
            length,
            height: spec.height,
            depth: spec.depth,
            angle,
            cut: length < spec.length - 1e-4,
          });
        }
        s += pitch;
      }
    }
  }

  return placements;
}

/** Builds the meshes for a laid wall: the blocks, the mortar core, the coping. */
export function buildMasonry(
  path: Vec2[],
  spec: BlockSpec,
  courses: number,
  options: LayOptions & { capstone?: boolean; capstoneOverhang?: number },
): { group: THREE.Group; placements: BlockPlacement[] } {
  const group = new THREE.Group();
  const placements = layBlocks(path, spec, courses, options);

  // A solid core in the joint colour behind the blocks: it fills the mortar
  // beds and stops daylight showing through the vertical joints.
  if (spec.joint > 0.0005 && placements.length > 0) {
    const core: THREE.Matrix4[] = [];
    const segmentCount = options.closed ? path.length : path.length - 1;
    const skip = new Set(options.skipEdges ?? []);
    for (let i = 0; i < segmentCount; i++) {
      if (skip.has(i)) continue;
      const a = path[i];
      const b = path[(i + 1) % path.length];
      const length = distance(a, b);
      if (length < 1e-6) continue;
      const dir = normalize(sub(b, a));
      // boxMatrix's depth axis (not width) rotates to run along `dir`, so the
      // along-wall span and the block's through-wall depth are swapped here
      // relative to their natural width/depth argument order.
      core.push(
        boxMatrix(
          (a.x + b.x) / 2,
          0,
          (a.z + b.z) / 2,
          spec.depth * 0.86,
          wallHeight(spec, courses),
          length + spec.depth,
          Math.atan2(dir.x, dir.z),
        ),
      );
    }
    const coreMesh = instanced(UNIT_BOX, plainMaterial(spec.jointColor, 0.95), core, false);
    if (coreMesh) group.add(coreMesh);
  }

  const blocks = instanced(
    UNIT_BOX,
    faceMaterial(spec.texture, spec.color),
    placements.map((p) => boxMatrix(p.x, p.y, p.z, p.depth, p.height, p.length, p.angle)),
  );
  if (blocks) group.add(blocks);

  if (options.capstone) {
    const overhang = options.capstoneOverhang ?? 0.02;
    const top = wallHeight(spec, courses);
    const thickness = Math.max(0.03, spec.height * 0.25);
    const segmentCount = options.closed ? path.length : path.length - 1;
    const skip = new Set(options.skipEdges ?? []);
    const caps: THREE.Matrix4[] = [];
    for (let i = 0; i < segmentCount; i++) {
      if (skip.has(i)) continue;
      const a = path[i];
      const b = path[(i + 1) % path.length];
      const length = distance(a, b);
      if (length < 1e-6) continue;
      const dir = normalize(sub(b, a));
      caps.push(
        boxMatrix(
          (a.x + b.x) / 2,
          top,
          (a.z + b.z) / 2,
          spec.depth + overhang * 2,
          thickness,
          length + spec.depth + overhang * 2,
          Math.atan2(dir.x, dir.z),
        ),
      );
    }
    const capMesh = instanced(UNIT_BOX, faceMaterial('smooth', shadeHex(spec.color, 0.06)), caps);
    if (capMesh) group.add(capMesh);
  }

  return { group, placements };
}

function shadeHex(hex: string, amount: number): string {
  const color = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  color.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)));
  return `#${color.getHexString()}`;
}

function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}
