/** Footpaths: a tiled band or a line of stepping stones along a curve. */

import * as THREE from 'three';
import {
  distance,
  normalize,
  resample,
  ribbon,
  sampleSpline,
  sub,
} from '../../core/geometry';
import type { PathObject, Vec2 } from '../../core/types';
import { faceMaterial, plainMaterial } from '../materials';
import { UNIT_BOX, boxMatrix, cylinder, flatPolygon, instanced, mesh } from './common';
import { layTiles } from './paving';
import { LAYER_LIFT, type BuildContext } from './context';

/** Samples per control-point span when the path is curved. */
const CURVE_SEGMENTS = 14;

/** The centre line actually used for geometry, after smoothing. */
export function pathCentreLine(object: PathObject): Vec2[] {
  if (object.path.length < 2) return object.path;
  return object.curved ? sampleSpline(object.path, CURVE_SEGMENTS) : object.path;
}

/** Outline of the paved band, used for geometry and for the 2D plan. */
export function pathOutline(object: PathObject): Vec2[] {
  const centre = pathCentreLine(object);
  if (centre.length < 2) return [];
  const { left, right } = ribbon(centre, object.width);
  return [...left, ...right.slice().reverse()];
}

export function buildPath(object: PathObject, ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  const centre = pathCentreLine(object);
  if (centre.length < 2) return group;

  const y = ctx.layer * LAYER_LIFT;
  const spec = object.tile;

  if (object.steppingStones) {
    // Stones follow the curve, each turned to face along it.
    const spacing = Math.max(0.05, spec.depth + object.stoneSpacing);
    const points = resample(centre, spacing);
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < points.length; i++) {
      const ahead = points[Math.min(i + 1, points.length - 1)];
      const behind = points[Math.max(i - 1, 0)];
      const dir = normalize(sub(ahead, behind));
      const angle = Math.atan2(dir.x, dir.z) + Math.PI / 2;
      matrices.push(
        boxMatrix(points[i].x, y, points[i].z, spec.width, spec.thickness, spec.depth, angle),
      );
    }
    if (spec.shape === 'round') {
      const geometry = cylinder(spec.width / 2, spec.width / 2, spec.thickness, 20);
      const stones = instanced(
        geometry,
        faceMaterial(spec.texture, spec.color),
        points.map((p) => {
          const matrix = new THREE.Matrix4();
          matrix.compose(
            new THREE.Vector3(p.x, y, p.z),
            new THREE.Quaternion(),
            new THREE.Vector3(1, 1, 1),
          );
          return matrix;
        }),
      );
      if (stones) group.add(stones);
    } else {
      const stones = instanced(UNIT_BOX, faceMaterial(spec.texture, spec.color), matrices);
      if (stones) group.add(stones);
    }
    return group;
  }

  // Continuous band: a base strip in the joint colour with paving laid over it.
  const outline = pathOutline(object);
  if (outline.length >= 3) {
    const base = mesh(flatPolygon(outline), plainMaterial(spec.jointColor, 0.95), false);
    base.position.y = y + 0.0004;
    group.add(base);

    // Lay the paving along the local run direction so it follows the path.
    const angle = pathHeading(centre);
    const placements = layTiles(outline, spec, angle);
    const matrices = placements.map((p) =>
      boxMatrix(p.x, y + 0.0006, p.z, p.width, spec.thickness, p.depth, p.angle),
    );
    const tiles = instanced(UNIT_BOX, faceMaterial(spec.texture, spec.color), matrices, false);
    if (tiles) group.add(tiles);
  }

  return group;
}

/** Overall heading of the run, so paving lines up with the path direction. */
function pathHeading(centre: Vec2[]): number {
  const dir = normalize(sub(centre[centre.length - 1], centre[0]));
  return Math.atan2(dir.z, dir.x);
}

/** Length of the path along its centre line — shown in the inspector. */
export function pathLength(object: PathObject): number {
  const centre = pathCentreLine(object);
  let total = 0;
  for (let i = 0; i < centre.length - 1; i++) total += distance(centre[i], centre[i + 1]);
  return total;
}
