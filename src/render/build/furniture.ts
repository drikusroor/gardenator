/** Garden furniture, built from boxes and cylinders at real sizes. */

import * as THREE from 'three';
import type { FurnitureObject } from '../../core/types';
import { faceMaterial, plainMaterial } from '../materials';
import { UNIT_BOX, box, boxMatrix, cylinder, instanced, mesh } from './common';

const LEG = 0.06;

export function buildFurniture(object: FurnitureObject): THREE.Group {
  switch (object.kind) {
    case 'dining-table':
    case 'coffee-table':
      return table(object);
    case 'chair':
      return chair(object);
    case 'bench':
      return bench(object);
    case 'lounger':
      return lounger(object);
    case 'parasol':
      return parasol(object);
    case 'planter-box':
      return planterBox(object);
    case 'bbq':
      return bbq(object);
    case 'firepit':
    default:
      return firepit(object);
  }
}

function woodMaterial(color: string) {
  return faceMaterial('wood', color);
}

function table(object: FurnitureObject): THREE.Group {
  const group = new THREE.Group();
  const topThickness = 0.04;
  const top = mesh(box(object.width, topThickness, object.depth), woodMaterial(object.color));
  top.position.y = object.height - topThickness;
  group.add(top);

  const legs: THREE.Matrix4[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      legs.push(
        boxMatrix(
          (sx * (object.width - LEG * 3)) / 2,
          0,
          (sz * (object.depth - LEG * 3)) / 2,
          LEG,
          object.height - topThickness,
          LEG,
          0,
        ),
      );
    }
  }
  const legMesh = instanced(UNIT_BOX, woodMaterial(object.accentColor), legs);
  if (legMesh) group.add(legMesh);
  return group;
}

function chair(object: FurnitureObject): THREE.Group {
  const group = new THREE.Group();
  const seatHeight = 0.45;
  const seat = mesh(box(object.width, 0.04, object.depth), woodMaterial(object.color));
  seat.position.y = seatHeight;
  group.add(seat);

  const parts: THREE.Matrix4[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(
        boxMatrix(
          (sx * (object.width - LEG * 2)) / 2,
          0,
          (sz * (object.depth - LEG * 2)) / 2,
          LEG * 0.7,
          seatHeight,
          LEG * 0.7,
          0,
        ),
      );
    }
  }
  // Back rest: two uprights and three slats.
  const backZ = object.depth / 2 - LEG;
  for (const sx of [-1, 1]) {
    parts.push(
      boxMatrix(
        (sx * (object.width - LEG * 2)) / 2,
        seatHeight,
        backZ,
        LEG * 0.7,
        object.height - seatHeight,
        LEG * 0.7,
        0,
      ),
    );
  }
  for (let i = 0; i < 3; i++) {
    parts.push(
      boxMatrix(
        0,
        seatHeight + 0.08 + i * ((object.height - seatHeight - 0.1) / 3),
        backZ,
        object.width - LEG,
        0.05,
        0.02,
        0,
      ),
    );
  }
  const partMesh = instanced(UNIT_BOX, woodMaterial(object.accentColor), parts);
  if (partMesh) group.add(partMesh);
  return group;
}

function bench(object: FurnitureObject): THREE.Group {
  const group = chair({ ...object, depth: object.depth });
  return group;
}

function lounger(object: FurnitureObject): THREE.Group {
  const group = new THREE.Group();
  const frameHeight = 0.32;
  const legs: THREE.Matrix4[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      legs.push(
        boxMatrix(
          (sx * (object.width - 0.1)) / 2,
          0,
          (sz * (object.depth - 0.2)) / 2,
          0.04,
          frameHeight,
          0.04,
          0,
        ),
      );
    }
  }
  const legMesh = instanced(UNIT_BOX, plainMaterial(object.accentColor, 0.5, 0.5), legs);
  if (legMesh) group.add(legMesh);

  const mattress = mesh(box(object.width, 0.1, object.depth * 0.62), woodMaterial(object.color));
  mattress.position.set(0, frameHeight, object.depth * 0.19);
  group.add(mattress);

  // Raked back rest.
  const back = mesh(box(object.width, 0.1, object.depth * 0.42), woodMaterial(object.color));
  back.position.set(0, frameHeight + 0.02, -object.depth * 0.28);
  back.rotation.x = -0.6;
  group.add(back);
  return group;
}

function parasol(object: FurnitureObject): THREE.Group {
  const group = new THREE.Group();
  const poleHeight = object.height;
  group.add(mesh(cylinder(0.025, 0.025, poleHeight, 10), plainMaterial(object.accentColor, 0.5, 0.4)));

  const canopy = mesh(
    new THREE.ConeGeometry(object.width / 2, 0.35, 10).translate(0, 0.175, 0),
    plainMaterial(object.color, 0.85),
  );
  canopy.position.y = poleHeight - 0.35;
  group.add(canopy);

  const base = mesh(cylinder(0.24, 0.28, 0.06, 16), plainMaterial('#4a4a48', 0.7), false);
  group.add(base);
  return group;
}

function planterBox(object: FurnitureObject): THREE.Group {
  const group = new THREE.Group();
  const t = 0.03;
  const walls: THREE.Matrix4[] = [
    boxMatrix(0, 0, -object.depth / 2 + t / 2, object.width, object.height, t, 0),
    boxMatrix(0, 0, object.depth / 2 - t / 2, object.width, object.height, t, 0),
    boxMatrix(-object.width / 2 + t / 2, 0, 0, t, object.height, object.depth - t * 2, 0),
    boxMatrix(object.width / 2 - t / 2, 0, 0, t, object.height, object.depth - t * 2, 0),
  ];
  const wallMesh = instanced(UNIT_BOX, woodMaterial(object.color), walls);
  if (wallMesh) group.add(wallMesh);
  const soil = mesh(
    box(object.width - t * 2, 0.03, object.depth - t * 2),
    plainMaterial('#4b3a2b', 1),
    false,
  );
  soil.position.y = object.height - 0.05;
  group.add(soil);
  return group;
}

function bbq(object: FurnitureObject): THREE.Group {
  const group = new THREE.Group();
  const bodyHeight = object.height * 0.35;
  const legs = mesh(
    box(object.width * 0.7, object.height - bodyHeight, object.depth * 0.6),
    plainMaterial(object.color, 0.5, 0.5),
  );
  group.add(legs);
  const bowl = mesh(
    new THREE.SphereGeometry(object.width / 2, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    plainMaterial(object.accentColor, 0.4, 0.6),
  );
  bowl.position.y = object.height;
  bowl.scale.y = (bodyHeight / (object.width / 2)) * 1.2;
  group.add(bowl);
  return group;
}

function firepit(object: FurnitureObject): THREE.Group {
  const group = new THREE.Group();
  const bowl = mesh(
    cylinder(object.width / 2, object.width / 2.6, object.height, 18),
    plainMaterial(object.color, 0.6, 0.4),
  );
  group.add(bowl);
  const embers = mesh(
    cylinder(object.width / 2.4, object.width / 2.4, 0.03, 18),
    plainMaterial(object.accentColor, 0.5),
    false,
  );
  embers.position.y = object.height - 0.05;
  group.add(embers);
  return group;
}
