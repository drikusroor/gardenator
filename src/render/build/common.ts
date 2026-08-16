/**
 * Shared geometry helpers for the object builders.
 *
 * Convention: a builder returns geometry in the object's LOCAL space with
 * y = 0 at the object's own base. The scene graph applies position, rotation
 * and elevation, so nothing below needs to know where the object sits.
 *
 * The Shape/Extrude helpers rotate shape space into the ground plane such
 * that shape (x, y) maps to world (x, -z) and the extrusion runs up +Y.
 */

import * as THREE from 'three';
import type { Vec2 } from '../../core/types';

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** Builds a THREE.Shape from a ring of ground-plane points. */
export function shapeFrom(points: Vec2[]): THREE.Shape {
  const shape = new THREE.Shape();
  points.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, -p.z);
    else shape.lineTo(p.x, -p.z);
  });
  shape.closePath();
  return shape;
}

/**
 * A flat polygon lying in the ground plane at y = 0, facing up.
 * UVs come out in metres, which is what the ground textures expect.
 */
export function flatPolygon(points: Vec2[]): THREE.BufferGeometry {
  const geometry = new THREE.ShapeGeometry(shapeFrom(points));
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** A polygon extruded upwards; the top face ends up at y = thickness. */
export function slab(points: Vec2[], thickness: number): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shapeFrom(points), {
    depth: Math.max(thickness, 0.001),
    bevelEnabled: false,
    curveSegments: 4,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** Box centred on the origin in X/Z, sitting on y = 0. */
export function box(width: number, height: number, depth: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(0, height / 2, 0);
  return geometry;
}

/** Cylinder standing on y = 0. */
export function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments = 16,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
  geometry.translate(0, height / 2, 0);
  return geometry;
}

/** Instance transform for a scaled, Y-rotated unit box sitting on `y`. */
export function boxMatrix(
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  angle: number,
): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  matrix.compose(
    new THREE.Vector3(x, y + height / 2, z),
    quaternion,
    new THREE.Vector3(width, height, depth),
  );
  return matrix;
}

/** Builds an InstancedMesh from a list of matrices, or null when empty. */
export function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: THREE.Matrix4[],
  castShadow = true,
): THREE.InstancedMesh | null {
  if (matrices.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  // Instanced bounds are computed from the matrices; without this the mesh
  // can be culled away while still on screen.
  mesh.computeBoundingSphere();
  return mesh;
}

export function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  castShadow = true,
): THREE.Mesh {
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = castShadow;
  object.receiveShadow = true;
  return object;
}

/** Closed line loop / open polyline in the ground plane at height `y`. */
export function polyline(
  points: Vec2[],
  y: number,
  material: THREE.LineBasicMaterial,
  closed: boolean,
): THREE.Line {
  const list = closed ? [...points, points[0]] : points;
  const geometry = new THREE.BufferGeometry().setFromPoints(
    list.map((p) => new THREE.Vector3(p.x, y, p.z)),
  );
  return new THREE.Line(geometry, material);
}

/** Recursively frees geometries owned by a subtree. Materials are shared. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((child) => {
    const anyChild = child as THREE.Mesh;
    if (anyChild.geometry) anyChild.geometry.dispose();
  });
}

/** Marks a subtree so raycasting can attribute a hit back to its object. */
export function tagObject(root: THREE.Object3D, id: string): void {
  root.traverse((child) => {
    child.userData.objectId = id;
  });
}
