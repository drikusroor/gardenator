/** The scale-reference figure, single paving units, and dimension markers. */

import * as THREE from 'three';
import { distance } from '../../core/geometry';
import { formatShort } from '../../core/units';
import type { MeasureObject, PersonObject, TileObject, Vec2 } from '../../core/types';
import { faceMaterial, lineMaterial, plainMaterial } from '../materials';
import { box, cylinder, mesh } from './common';
import { LAYER_LIFT, type BuildContext } from './context';
import { makeLabel } from '../label';

/**
 * A stylised figure at the exact stated height — the soda-can-in-the-photo
 * trick. Proportions follow the usual 7.5-heads canon so it reads as a person
 * whether it is set to 1.60 m or 2.00 m.
 */
export function buildPerson(object: PersonObject): THREE.Group {
  const group = new THREE.Group();
  const h = Math.max(0.5, object.height);

  const headRadius = h * 0.065;
  const legHeight = h * 0.47;
  const torsoHeight = h * 0.31;
  const shoulderWidth = h * 0.13;

  const skin = plainMaterial(object.skinColor, 0.85);
  const cloth = plainMaterial(object.color, 0.9);

  for (const side of [-1, 1]) {
    const leg = mesh(cylinder(h * 0.033, h * 0.028, legHeight, 8), plainMaterial('#2f3a4a', 0.9));
    leg.position.set(side * h * 0.036, 0, 0);
    group.add(leg);
  }

  const torso = mesh(box(shoulderWidth, torsoHeight, h * 0.07), cloth);
  torso.position.y = legHeight;
  group.add(torso);

  for (const side of [-1, 1]) {
    const arm = mesh(cylinder(h * 0.021, h * 0.019, torsoHeight * 0.92, 8), cloth);
    arm.position.set(side * (shoulderWidth / 2 + h * 0.02), legHeight + torsoHeight * 0.06, 0);
    group.add(arm);
  }

  const neck = mesh(cylinder(h * 0.022, h * 0.022, h * 0.03, 8), skin);
  neck.position.y = legHeight + torsoHeight;
  group.add(neck);

  const head = mesh(new THREE.SphereGeometry(headRadius, 14, 12), skin);
  head.position.y = h - headRadius;
  group.add(head);

  return group;
}

export function buildTile(object: TileObject, ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  const spec = object.tile;
  const y = ctx.layer * LAYER_LIFT;

  let geometry: THREE.BufferGeometry;
  if (spec.shape === 'round') {
    geometry = cylinder(spec.width / 2, spec.width / 2, spec.thickness, 24);
  } else if (spec.shape === 'hex') {
    geometry = new THREE.CylinderGeometry(spec.width / 2, spec.width / 2, spec.thickness, 6);
    geometry.translate(0, spec.thickness / 2, 0);
    geometry.rotateY(Math.PI / 6);
  } else {
    geometry = box(spec.width, spec.thickness, spec.depth);
  }

  const tile = mesh(geometry, faceMaterial(spec.texture, spec.color));
  tile.position.y = y;
  group.add(tile);
  return group;
}

/** A dimension line with ticks and a readable label, drawn in the 3D view. */
export function buildMeasure(object: MeasureObject, ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  if (object.path.length < 2) return group;
  const a = object.path[0];
  const b = object.path[1];
  const length = distance(a, b);
  const y = 0.02 + ctx.layer * LAYER_LIFT;

  group.add(dimensionLine(a, b, y, '#ffd166'));

  const label = makeLabel(formatShort(length), {
    background: 'rgba(24,26,30,0.9)',
    color: '#ffd166',
  });
  label.position.set((a.x + b.x) / 2, y + 0.18, (a.z + b.z) / 2);
  group.add(label);
  return group;
}

/** Line between two ground points with end ticks, at height `y`. */
export function dimensionLine(a: Vec2, b: Vec2, y: number, color: string): THREE.Group {
  const group = new THREE.Group();
  const material = lineMaterial(color);

  const main = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.x, y, a.z),
      new THREE.Vector3(b.x, y, b.z),
    ]),
    material,
  );
  group.add(main);

  // Vertical ticks at each end, so the extent is unambiguous from any angle.
  for (const point of [a, b]) {
    const tick = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(point.x, y - 0.08, point.z),
        new THREE.Vector3(point.x, y + 0.12, point.z),
      ]),
      material,
    );
    group.add(tick);
  }
  return group;
}
