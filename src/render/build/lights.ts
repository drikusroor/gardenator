/**
 * Garden lighting.
 *
 * The fittings are always drawn; the actual THREE lights are only added when
 * the sun is down (or the fitting is set to be always on), because a dozen
 * point lights in daylight costs frame rate and buys nothing.
 */

import * as THREE from 'three';
import { distance } from '../../core/geometry';
import type { LightObject, Vec2 } from '../../core/types';
import { bulbMaterial, faceMaterial, glowMaterial, plainMaterial } from '../materials';
import { cylinder, mesh } from './common';
import { DETAIL, type BuildContext } from './context';

/** Point lights beyond this many per fitting are dropped; the glow carries it. */
const MAX_POINT_LIGHTS = 6;

export function buildLight(object: LightObject, ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  const lit = ctx.night || !object.duskOnly;

  switch (object.kind) {
    case 'string':
      buildString(group, object, lit, ctx);
      break;
    case 'post':
      buildPost(group, object, lit);
      break;
    case 'spot':
      buildSpot(group, object, lit);
      break;
    case 'wall':
      buildWall(group, object, lit);
      break;
    case 'lantern':
    default:
      buildLantern(group, object, lit);
      break;
  }

  return group;
}

/** Festoon colours, cycled bulb by bulb. */
const FESTIVE = ['#ff6b5e', '#ffd166', '#6ecf7a', '#5eb2ff', '#c98cff'];

/**
 * The catenary between two anchors, approximated with a parabola — at garden
 * spans the difference is well under a millimetre and the maths stays simple.
 */
function sagAt(t: number, span: number, sag: number): number {
  return -4 * sag * span * t * (1 - t);
}

function buildString(group: THREE.Group, object: LightObject, lit: boolean, ctx: BuildContext) {
  const anchors: Vec2[] = object.path.length >= 2 ? object.path : [{ x: -2, z: 0 }, { x: 2, z: 0 }];
  const height = object.height;

  // Poles under every anchor point, so the run is physically supported.
  for (const anchor of anchors) {
    const pole = mesh(cylinder(0.03, 0.04, height, 8), plainMaterial('#4b4a46', 0.6, 0.3));
    pole.position.set(anchor.x, 0, anchor.z);
    group.add(pole);
  }

  const bulbGeometry = new THREE.SphereGeometry(0.045, 10, 8);
  let placed = 0;

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const span = distance(a, b);
    if (span < 1e-4) continue;

    // Cable: a polyline sagging between the two anchors.
    const steps = 24;
    const points: THREE.Vector3[] = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      points.push(
        new THREE.Vector3(
          a.x + (b.x - a.x) * t,
          height + sagAt(t, span, object.sag),
          a.z + (b.z - a.z) * t,
        ),
      );
    }
    const cable = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: '#2b2b2b' }),
    );
    group.add(cable);

    const bulbs = Math.max(1, Math.floor(span / Math.max(0.15, object.bulbSpacing)));
    for (let n = 1; n <= bulbs; n++) {
      const t = n / (bulbs + 1);
      const color = object.festive ? FESTIVE[(placed + i) % FESTIVE.length] : object.color;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const y = height + sagAt(t, span, object.sag) - 0.07;

      const bulb = mesh(bulbGeometry, bulbMaterial(color, lit), false);
      bulb.position.set(x, y, z);
      group.add(bulb);

      if (lit) {
        const glow = new THREE.Sprite(glowMaterial(color));
        glow.scale.setScalar(0.55);
        glow.position.set(x, y, z);
        group.add(glow);
        // Only a few of the bulbs get a real light; the rest are glow only.
        if (placed % Math.ceil(bulbs / (MAX_POINT_LIGHTS * DETAIL[ctx.quality] || 1)) === 0) {
          const point = new THREE.PointLight(color, object.intensity * 1.4, 5, 2);
          point.position.set(x, y, z);
          group.add(point);
        }
      }
      placed += 1;
    }
  }
}

function buildPost(group: THREE.Group, object: LightObject, lit: boolean) {
  const height = object.height;
  group.add(mesh(cylinder(0.028, 0.035, height, 10), plainMaterial('#3f4145', 0.5, 0.4)));

  const head = mesh(cylinder(0.075, 0.06, 0.11, 12), plainMaterial('#3f4145', 0.5, 0.4));
  head.position.y = height;
  group.add(head);

  const lens = mesh(new THREE.SphereGeometry(0.05, 10, 8), bulbMaterial(object.color, lit), false);
  lens.position.y = height + 0.02;
  group.add(lens);

  if (lit) {
    const glow = new THREE.Sprite(glowMaterial(object.color));
    glow.scale.setScalar(0.9);
    glow.position.y = height + 0.02;
    group.add(glow);
    const point = new THREE.PointLight(object.color, object.intensity * 3, 6, 2);
    point.position.y = height + 0.02;
    group.add(point);
  }
}

function buildSpot(group: THREE.Group, object: LightObject, lit: boolean) {
  const body = mesh(cylinder(0.05, 0.055, object.height, 12), plainMaterial('#3a3d40', 0.45, 0.5));
  group.add(body);
  const lens = mesh(
    cylinder(0.045, 0.045, 0.012, 12),
    bulbMaterial(object.color, lit),
    false,
  );
  lens.position.y = object.height;
  group.add(lens);

  if (lit) {
    // Aimed straight up: the usual way an uplighter is set under a tree.
    const spot = new THREE.SpotLight(
      object.color,
      object.intensity * 6,
      9,
      object.coneAngle,
      0.6,
      2,
    );
    spot.position.set(0, object.height, 0);
    spot.target.position.set(0, object.height + 3, 0);
    group.add(spot);
    group.add(spot.target);
    const glow = new THREE.Sprite(glowMaterial(object.color));
    glow.scale.setScalar(0.5);
    glow.position.y = object.height + 0.02;
    group.add(glow);
  }
}

function buildWall(group: THREE.Group, object: LightObject, lit: boolean) {
  const back = mesh(cylinder(0.06, 0.06, 0.03, 12), plainMaterial('#3f4145', 0.5, 0.4));
  back.position.y = object.height;
  back.rotation.x = Math.PI / 2;
  group.add(back);
  const shade = mesh(cylinder(0.07, 0.05, 0.12, 12), plainMaterial('#3f4145', 0.5, 0.4));
  shade.position.set(0, object.height, 0.06);
  group.add(shade);
  if (lit) {
    const point = new THREE.PointLight(object.color, object.intensity * 2.5, 5, 2);
    point.position.set(0, object.height, 0.12);
    group.add(point);
    const glow = new THREE.Sprite(glowMaterial(object.color));
    glow.scale.setScalar(0.7);
    glow.position.set(0, object.height, 0.12);
    group.add(glow);
  }
}

function buildLantern(group: THREE.Group, object: LightObject, lit: boolean) {
  const height = object.height;
  const body = mesh(
    new THREE.BoxGeometry(0.16, height, 0.16).translate(0, height / 2, 0),
    faceMaterial('smooth', '#4a453e'),
  );
  group.add(body);
  const lens = mesh(new THREE.SphereGeometry(0.05, 10, 8), bulbMaterial(object.color, lit), false);
  lens.position.y = height * 0.62;
  group.add(lens);
  if (lit) {
    const point = new THREE.PointLight(object.color, object.intensity * 2, 4, 2);
    point.position.y = height * 0.62;
    group.add(point);
    const glow = new THREE.Sprite(glowMaterial(object.color));
    glow.scale.setScalar(0.6);
    glow.position.y = height * 0.62;
    group.add(glow);
  }
}

/** How many bulbs the run carries, for the take-off in the inspector. */
export function bulbCount(object: LightObject): number {
  let total = 0;
  for (let i = 0; i < object.path.length - 1; i++) {
    const span = distance(object.path[i], object.path[i + 1]);
    if (span > 1e-4) total += Math.max(1, Math.floor(span / Math.max(0.15, object.bulbSpacing)));
  }
  return total;
}
