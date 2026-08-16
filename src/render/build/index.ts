/**
 * Turns a document object into a scene subtree.
 *
 * Builders work in object-local space; this module applies the object's
 * position, heading and elevation, and tags every descendant with the object
 * id so a raycast hit can be traced back to what the user clicked.
 */

import * as THREE from 'three';
import type { GardenObject } from '../../core/types';
import { tagObject } from './common';
import { buildFence } from './fence';
import { buildFurniture } from './furniture';
import { buildLight } from './lights';
import { buildMeasure, buildPerson, buildTile } from './misc';
import { buildPath } from './path';
import { buildPlant } from './plants';
import { buildStructure } from './structure';
import { buildSurface } from './surface';
import { buildMasonry } from './masonry';
import type { BuildContext } from './context';

export function buildObject(object: GardenObject, ctx: BuildContext): THREE.Group {
  const inner = buildInner(object, ctx);

  const root = new THREE.Group();
  root.add(inner);
  root.position.set(object.position.x, object.elevation, object.position.z);
  root.rotation.y = object.rotation;
  root.visible = !object.hidden;
  root.name = object.name;
  root.userData.objectId = object.id;
  tagObject(root, object.id);
  return root;
}

function buildInner(object: GardenObject, ctx: BuildContext): THREE.Object3D {
  switch (object.type) {
    case 'surface':
      return buildSurface(object, ctx);
    case 'wall':
      return buildMasonry(object.path, object.block, object.courses, {
        closed: false,
        capstone: object.capstone,
        capstoneOverhang: object.capstoneOverhang,
      }).group;
    case 'fence':
      return buildFence(object, ctx);
    case 'path':
      return buildPath(object, ctx);
    case 'tile':
      return buildTile(object, ctx);
    case 'plant':
      return buildPlant(object, ctx);
    case 'structure':
      return buildStructure(object, ctx);
    case 'furniture':
      return buildFurniture(object);
    case 'light':
      return buildLight(object, ctx);
    case 'person':
      return buildPerson(object);
    case 'measure':
      return buildMeasure(object, ctx);
    default:
      return new THREE.Group();
  }
}

export { type BuildContext } from './context';
