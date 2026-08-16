/**
 * Buildings: the shed, a stretch of house wall, a pergola, a planter.
 *
 * Walls are built as extruded shapes with the door and window cut out of
 * them, so an opening is a real hole you can see through rather than a dark
 * rectangle painted on.
 */

import * as THREE from 'three';
import type { StructureObject } from '../../core/types';
import { faceMaterial, glassMaterial, masonryMaterial, plainMaterial } from '../materials';
import { UNIT_BOX, box, boxMatrix, instanced, mesh } from './common';
import type { BuildContext } from './context';

export function buildStructure(object: StructureObject, ctx: BuildContext): THREE.Group {
  switch (object.kind) {
    case 'house-wall':
      return buildHouseWall(object);
    case 'pergola':
      return buildPergola(object);
    case 'raised-planter':
      return buildPlanter(object);
    case 'shed':
    default:
      return buildShed(object, ctx);
  }
}

/** Wall material for the chosen construction. */
function wallMaterial(object: StructureObject): THREE.Material {
  switch (object.material) {
    case 'brick':
      return masonryMaterial({ ...object.block, color: object.color });
    case 'wood':
      return faceMaterial('wood', object.color);
    case 'metal':
      return plainMaterial(object.color, 0.4, 0.7);
    case 'render':
    default:
      return plainMaterial(object.color, 0.9);
  }
}

/**
 * A wall panel in the XY plane with rectangular openings punched out.
 * Returned geometry stands on y = 0 and is `thickness` deep in Z.
 */
function panel(
  width: number,
  height: number,
  thickness: number,
  holes: { x: number; y: number; w: number; h: number }[],
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();

  for (const hole of holes) {
    if (hole.w <= 0 || hole.h <= 0) continue;
    const path = new THREE.Path();
    path.moveTo(hole.x - hole.w / 2, hole.y);
    path.lineTo(hole.x + hole.w / 2, hole.y);
    path.lineTo(hole.x + hole.w / 2, hole.y + hole.h);
    path.lineTo(hole.x - hole.w / 2, hole.y + hole.h);
    path.closePath();
    shape.holes.push(path);
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 2,
  });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

/** Openings on the front wall, in panel coordinates. */
function frontHoles(object: StructureObject) {
  const holes: { x: number; y: number; w: number; h: number }[] = [];
  if (object.door) {
    holes.push({
      x: (object.doorOffset - 0.5) * object.width,
      y: 0,
      w: object.doorWidth,
      h: object.doorHeight,
    });
  }
  if (object.window) {
    holes.push({
      x: (object.windowOffset - 0.5) * object.width,
      y: object.windowSill,
      w: object.windowWidth,
      h: object.windowHeight,
    });
  }
  return holes;
}

function buildShed(object: StructureObject, _ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  const w = object.width;
  const d = object.depth;
  const thickness = object.material === 'brick' ? 0.11 : 0.045;
  const material = wallMaterial(object);
  const lowEave = object.height;
  const highEave = object.roof === 'mono-pitch' ? object.height + object.roofRise : object.height;

  // Front (-Z, facing the viewer) carries the openings; the back is solid.
  const front = mesh(panel(w, lowEave, thickness, frontHoles(object)), material);
  front.position.z = -d / 2;
  group.add(front);

  const backHeight = object.roof === 'mono-pitch' ? highEave : lowEave;
  const back = mesh(panel(w, backHeight, thickness, []), material);
  back.position.z = d / 2;
  group.add(back);

  // Side walls: a plain rectangle for a flat roof, a trapezium for a pitch.
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-d / 2, 0);
    shape.lineTo(d / 2, 0);
    shape.lineTo(d / 2, backHeight);
    shape.lineTo(-d / 2, lowEave);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    geometry.translate(0, 0, -thickness / 2);
    // rotateY(+90deg) would flip shape-x to -z, swapping which eave lands at
    // the front vs the back; -90deg keeps shape-x mapped straight onto z so
    // the low/high corners line up with the front and back wall panels.
    geometry.rotateY(-Math.PI / 2);
    const wall = mesh(geometry, material);
    wall.position.x = (side * w) / 2;
    group.add(wall);
  }

  group.add(buildRoof(object, lowEave, highEave));
  addOpeningFurniture(group, object, -d / 2 - thickness / 2);

  // A slab floor so the inside does not show the ground through the doorway.
  const floor = mesh(box(w, 0.04, d), plainMaterial('#7c7a76', 0.95), false);
  group.add(floor);

  return group;
}

function buildRoof(object: StructureObject, lowEave: number, highEave: number): THREE.Group {
  const group = new THREE.Group();
  const overhang = object.roofOverhang;
  const w = object.width + overhang * 2;
  const d = object.depth + overhang * 2;
  const thickness = 0.06;
  const material = plainMaterial(object.roofColor, 0.85);

  switch (object.roof) {
    case 'mono-pitch': {
      const rise = highEave - lowEave;
      const slope = Math.hypot(d, rise);
      const panelMesh = mesh(box(w, thickness, slope), material);
      panelMesh.position.set(0, lowEave + rise / 2, 0);
      panelMesh.rotation.x = -Math.atan2(rise, d);
      group.add(panelMesh);
      break;
    }
    case 'gable': {
      const rise = object.roofRise;
      const half = d / 2;
      const slope = Math.hypot(half, rise);
      for (const side of [-1, 1]) {
        const panelMesh = mesh(box(w, thickness, slope), material);
        panelMesh.position.set(0, lowEave + rise / 2, (side * half) / 2);
        panelMesh.rotation.x = side * Math.atan2(rise, half);
        group.add(panelMesh);
      }
      break;
    }
    case 'flat': {
      const panelMesh = mesh(box(w, thickness, d), material);
      panelMesh.position.y = lowEave;
      group.add(panelMesh);
      break;
    }
    case 'none':
    default:
      break;
  }
  return group;
}

/** Door leaf, glazing and sill for whichever openings the structure has. */
function addOpeningFurniture(group: THREE.Group, object: StructureObject, faceZ: number) {
  if (object.door) {
    const leaf = mesh(
      box(object.doorWidth - 0.02, object.doorHeight - 0.02, 0.035),
      faceMaterial('wood', '#5f4a33'),
    );
    leaf.position.set((object.doorOffset - 0.5) * object.width, 0, faceZ + 0.02);
    group.add(leaf);
    const handle = mesh(
      new THREE.SphereGeometry(0.025, 8, 6),
      plainMaterial('#c9c4b8', 0.35, 0.8),
      false,
    );
    handle.position.set(
      (object.doorOffset - 0.5) * object.width + object.doorWidth * 0.35,
      object.doorHeight * 0.5,
      faceZ + 0.05,
    );
    group.add(handle);
  }

  if (object.window) {
    const glass = mesh(
      box(object.windowWidth - 0.03, object.windowHeight - 0.03, 0.012),
      glassMaterial(),
      false,
    );
    glass.position.set(
      (object.windowOffset - 0.5) * object.width,
      object.windowSill + 0.015,
      faceZ + 0.02,
    );
    group.add(glass);

    // Frame: four thin bars round the opening.
    const frameMaterial = faceMaterial('wood', '#e7e3da');
    const bars: THREE.Matrix4[] = [];
    const x = (object.windowOffset - 0.5) * object.width;
    const y = object.windowSill;
    bars.push(boxMatrix(x, y, faceZ + 0.02, object.windowWidth, 0.04, 0.05, 0));
    bars.push(boxMatrix(x, y + object.windowHeight - 0.04, faceZ + 0.02, object.windowWidth, 0.04, 0.05, 0));
    bars.push(boxMatrix(x - object.windowWidth / 2 + 0.02, y, faceZ + 0.02, 0.04, object.windowHeight, 0.05, 0));
    bars.push(boxMatrix(x + object.windowWidth / 2 - 0.02, y, faceZ + 0.02, 0.04, object.windowHeight, 0.05, 0));
    const frame = instanced(UNIT_BOX, frameMaterial, bars);
    if (frame) group.add(frame);
  }
}

function buildHouseWall(object: StructureObject): THREE.Group {
  const group = new THREE.Group();
  const thickness = Math.max(0.1, object.depth);
  const wall = mesh(
    panel(object.width, object.height, thickness, frontHoles(object)),
    wallMaterial(object),
  );
  group.add(wall);
  addOpeningFurniture(group, object, -thickness / 2);

  // A hint of eaves so the wall reads as a building edge, not a fence.
  const eave = mesh(box(object.width + 0.3, 0.12, thickness + 0.35), plainMaterial('#514f4b', 0.9));
  eave.position.y = object.height;
  group.add(eave);
  return group;
}

function buildPergola(object: StructureObject): THREE.Group {
  const group = new THREE.Group();
  const material = faceMaterial('wood', object.color);
  const postSize = 0.1;
  const posts: THREE.Matrix4[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      posts.push(
        boxMatrix(
          (sx * (object.width - postSize)) / 2,
          0,
          (sz * (object.depth - postSize)) / 2,
          postSize,
          object.height,
          postSize,
          0,
        ),
      );
    }
  }
  const beams: THREE.Matrix4[] = [];
  for (const sz of [-1, 1]) {
    beams.push(
      boxMatrix(0, object.height, (sz * (object.depth - postSize)) / 2, object.width, 0.12, 0.06, 0),
    );
  }
  // Rafters across the top at roughly 40 cm centres.
  const rafters = Math.max(2, Math.round(object.width / 0.4));
  for (let i = 0; i <= rafters; i++) {
    const x = -object.width / 2 + (i * object.width) / rafters;
    beams.push(boxMatrix(x, object.height + 0.12, 0, 0.05, 0.1, object.depth, 0));
  }
  const postMesh = instanced(UNIT_BOX, material, posts);
  const beamMesh = instanced(UNIT_BOX, material, beams);
  if (postMesh) group.add(postMesh);
  if (beamMesh) group.add(beamMesh);
  return group;
}

function buildPlanter(object: StructureObject): THREE.Group {
  const group = new THREE.Group();
  const material =
    object.material === 'brick' ? masonryMaterial({ ...object.block, color: object.color }) : faceMaterial('wood', object.color);
  const t = 0.05;
  const walls: THREE.Matrix4[] = [
    boxMatrix(0, 0, -object.depth / 2 + t / 2, object.width, object.height, t, 0),
    boxMatrix(0, 0, object.depth / 2 - t / 2, object.width, object.height, t, 0),
    boxMatrix(-object.width / 2 + t / 2, 0, 0, t, object.height, object.depth - t * 2, 0),
    boxMatrix(object.width / 2 - t / 2, 0, 0, t, object.height, object.depth - t * 2, 0),
  ];
  const wallMesh = instanced(UNIT_BOX, material, walls);
  if (wallMesh) group.add(wallMesh);
  const soil = mesh(
    box(object.width - t * 2, 0.03, object.depth - t * 2),
    plainMaterial('#4b3a2b', 1),
    false,
  );
  soil.position.y = object.height - 0.06;
  group.add(soil);
  return group;
}
