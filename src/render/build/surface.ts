/** Ground surfaces: lawns, tiled terraces, raised beds, decking, water. */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { area, bounds, makeRandom, pointInPolygon } from '../../core/geometry';
import type { SurfaceObject, Vec2 } from '../../core/types';
import {
  GROUND_DEFAULT_COLOR,
  faceMaterial,
  groundMaterial,
  plainMaterial,
  tuftMaterial,
} from '../materials';
import { UNIT_BOX, boxMatrix, cylinder, flatPolygon, instanced, mesh, slab } from './common';
import { buildMasonry } from './masonry';
import { layTiles } from './paving';
import { DETAIL, LAYER_LIFT, type BuildContext } from './context';

/** Grass tufts per square metre at full quality. */
const TUFTS_PER_M2 = 30;
/** Above this many tufts a lawn stops adding more, to keep frame times sane. */
const TUFT_LIMIT = 9000;

export function buildSurface(object: SurfaceObject, ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  if (object.points.length < 3) return group;

  const lift = ctx.layer * LAYER_LIFT;
  const raise = Math.max(0, object.raise);
  const top = raise + lift;
  const ground = object.ground;
  const color = ground.color ?? GROUND_DEFAULT_COLOR[ground.kind];

  /* ------------------------------------------------------------- the fill */
  if (raise > 0.002) {
    // A raised bed: solid body with soil-coloured sides, capped by the ground.
    const body = slab(object.points, raise);
    const sideColor = ground.kind === 'water' ? '#3c4a4f' : '#4b3a2b';
    const bodyMesh = new THREE.Mesh(body, [
      groundMaterial(ground.kind, color),
      plainMaterial(sideColor, 1),
    ]);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    bodyMesh.position.y = lift;
    group.add(bodyMesh);
  } else {
    const flat = mesh(flatPolygon(object.points), groundMaterial(ground.kind, color), false);
    flat.position.y = top;
    group.add(flat);
  }

  /* ------------------------------------------------------------- the paving */
  if (ground.kind === 'tiles' && ground.tile) {
    const spec = ground.tile;
    // The base slab in the joint colour becomes the visible grout, and the
    // border where whole tiles do not fit reads as an edging strip.
    const base = mesh(flatPolygon(object.points), plainMaterial(spec.jointColor, 0.95), false);
    base.position.y = top + 0.0004;
    group.add(base);

    const placements = layTiles(object.points, spec, ground.patternAngle ?? 0);
    const random = makeRandom(1337);
    if (spec.shape === 'round') {
      const geometry = cylinder(spec.width / 2, spec.width / 2, spec.thickness, 20);
      const matrices = placements.map((p) => {
        const matrix = new THREE.Matrix4();
        matrix.compose(
          new THREE.Vector3(p.x, top + 0.0006, p.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.angle),
          new THREE.Vector3(1, 1, 1),
        );
        return matrix;
      });
      const tiles = instanced(geometry, faceMaterial(spec.texture, spec.color), matrices, false);
      if (tiles) group.add(tiles);
    } else {
      const matrices = placements.map((p) =>
        // A fraction of a millimetre of height variation stops the paving
        // looking like one printed sheet.
        boxMatrix(
          p.x,
          top + 0.0006,
          p.z,
          p.width,
          spec.thickness * (0.94 + random() * 0.12),
          p.depth,
          p.angle,
        ),
      );
      const tiles = instanced(UNIT_BOX, faceMaterial(spec.texture, spec.color), matrices, false);
      if (tiles) group.add(tiles);
    }
  }

  if (ground.kind === 'deck') {
    // Decking gets the same treatment with a plank-shaped unit.
    const plank = {
      ...(ground.tile ?? {
        id: 'deck',
        name: 'plank',
        shape: 'rect' as const,
        width: 2,
        depth: 0.14,
        thickness: 0.028,
        color: '#8a6a45',
        gap: 0.006,
        jointColor: '#3a2f24',
        pattern: 'running' as const,
        texture: 'wood' as const,
      }),
    };
    const base = mesh(flatPolygon(object.points), plainMaterial(plank.jointColor, 0.95), false);
    base.position.y = top + 0.0004;
    group.add(base);
    const placements = layTiles(object.points, plank, ground.patternAngle ?? 0);
    const matrices = placements.map((p) =>
      boxMatrix(p.x, top + 0.0006, p.z, p.width, plank.thickness, p.depth, p.angle),
    );
    const planks = instanced(UNIT_BOX, faceMaterial('wood', plank.color), matrices, false);
    if (planks) group.add(planks);
  }

  /* -------------------------------------------------------------- the tufts */
  if (ground.kind === 'grass' && ctx.showGrass) {
    const tufts = buildTufts(object.points, color, top, ground.scatter ?? 1, ctx);
    if (tufts) group.add(tufts);
  }

  /* ------------------------------------------------------------- the edging */
  if (object.edging.enabled && object.points.length >= 3) {
    const { group: wall } = buildMasonry(object.points, object.edging.block, object.edging.courses, {
      closed: true,
      skipEdges: object.edging.openEdges,
    });
    wall.position.y = lift;
    group.add(wall);
  }

  return group;
}

/**
 * Scatters crossed billboards over the polygon so a lawn has some depth
 * instead of being a flat green plane.
 */
function buildTufts(
  polygon: Vec2[],
  color: string,
  y: number,
  density: number,
  ctx: BuildContext,
): THREE.InstancedMesh | null {
  const size = area(polygon);
  const wanted = Math.min(
    TUFT_LIMIT,
    Math.round(size * TUFTS_PER_M2 * density * DETAIL[ctx.quality]),
  );
  if (wanted <= 0) return null;

  const { min, max } = bounds(polygon);
  const random = makeRandom(Math.round(size * 1000) + 7);
  const matrices: THREE.Matrix4[] = [];
  // Rejection sampling: for the L-shaped lawns people actually have, the
  // bounding box is only a little larger than the polygon, so this converges
  // quickly. The attempt cap protects against pathological shapes.
  const maxAttempts = wanted * 6;
  for (let attempt = 0; attempt < maxAttempts && matrices.length < wanted; attempt++) {
    const point = {
      x: min.x + random() * (max.x - min.x),
      z: min.z + random() * (max.z - min.z),
    };
    if (!pointInPolygon(point, polygon)) continue;
    // Mown-lawn height. Taller than about 15 cm and the tufts stop reading as
    // turf and start looking like weeds poking through.
    const scale = 0.06 + random() * 0.07;
    const matrix = new THREE.Matrix4();
    matrix.compose(
      new THREE.Vector3(point.x, y + scale * 0.5 - 0.008, point.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI),
      new THREE.Vector3(scale * 1.5, scale, scale * 1.5),
    );
    matrices.push(matrix);
  }

  const tuftMesh = instanced(crossQuad(), tuftMaterial(color), matrices, false);
  if (tuftMesh) tuftMesh.receiveShadow = true;
  return tuftMesh;
}

let crossGeometry: THREE.BufferGeometry | null = null;

/** Two unit planes crossed at 90°, the classic cheap vegetation billboard. */
function crossQuad(): THREE.BufferGeometry {
  if (crossGeometry) return crossGeometry;
  const a = new THREE.PlaneGeometry(1, 1);
  const b = new THREE.PlaneGeometry(1, 1);
  b.rotateY(Math.PI / 2);
  crossGeometry = mergeGeometries([a, b]) ?? a;
  return crossGeometry;
}
