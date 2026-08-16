/**
 * Plants.
 *
 * Trees and shrubs are built from a handful of primitives driven by the
 * object's height and spread, so a 4.2 m pear tree really is 4.2 m tall next
 * to the 1.85 m reference figure. Small planting is crossed billboards, which
 * is what keeps a bed of fourteen tulips affordable.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRandom } from '../../core/geometry';
import type { PlantObject, PlantSpecies } from '../../core/types';
import {
  barkMaterial,
  faceMaterial,
  flowerMaterial,
  foliageMaterial,
  plainMaterial,
  tuftMaterial,
} from '../materials';
import { UNIT_BOX, boxMatrix, cylinder, instanced, mesh } from './common';
import { DETAIL, type BuildContext } from './context';

interface Look {
  /** Fraction of total height taken by the clear trunk. */
  trunkFraction: number;
  trunkColor: string;
  leafColor: string;
  /** How the canopy is massed. */
  canopy: 'blobs' | 'cone' | 'column' | 'ball' | 'billboard' | 'spikes' | 'none';
  /** Fruit / flower colour, when the species carries any. */
  accent?: string;
  accentCount?: number;
}

const LOOKS: Record<PlantSpecies, Look> = {
  'pear-tree': {
    trunkFraction: 0.42,
    trunkColor: '#6b5946',
    leafColor: '#4f7a35',
    canopy: 'blobs',
    accent: '#c3ce5c',
    accentCount: 14,
  },
  'apple-tree': {
    trunkFraction: 0.38,
    trunkColor: '#6b5946',
    leafColor: '#557f38',
    canopy: 'blobs',
    accent: '#c0402f',
    accentCount: 16,
  },
  birch: { trunkFraction: 0.55, trunkColor: '#d9d6cd', leafColor: '#6f9243', canopy: 'blobs' },
  conifer: { trunkFraction: 0.12, trunkColor: '#5e4c3c', leafColor: '#2f5233', canopy: 'cone' },
  olive: { trunkFraction: 0.4, trunkColor: '#7b7264', leafColor: '#7d9068', canopy: 'blobs' },
  bush: { trunkFraction: 0.1, trunkColor: '#5e4c3c', leafColor: '#4d7136', canopy: 'blobs' },
  'box-ball': { trunkFraction: 0.05, trunkColor: '#5e4c3c', leafColor: '#3f6b32', canopy: 'ball' },
  bamboo: { trunkFraction: 0.35, trunkColor: '#9aa35c', leafColor: '#5f8a3f', canopy: 'column' },
  climber: { trunkFraction: 0.1, trunkColor: '#6b5946', leafColor: '#4a7a38', canopy: 'column' },
  lavender: {
    trunkFraction: 0,
    trunkColor: '#6b7a5a',
    leafColor: '#7d8f68',
    canopy: 'spikes',
    accent: '#8d7bc0',
    accentCount: 10,
  },
  'grass-tuft': { trunkFraction: 0, trunkColor: '#7a8259', leafColor: '#8a9a5b', canopy: 'billboard' },
  fern: { trunkFraction: 0, trunkColor: '#4d6b34', leafColor: '#43713a', canopy: 'billboard' },
  hosta: { trunkFraction: 0, trunkColor: '#4d6b34', leafColor: '#6f9550', canopy: 'billboard' },
  rose: {
    trunkFraction: 0.25,
    trunkColor: '#5f6b45',
    leafColor: '#3f6b34',
    canopy: 'blobs',
    accent: '#c2456a',
    accentCount: 7,
  },
  herb: { trunkFraction: 0, trunkColor: '#6b7a4a', leafColor: '#6f8a49', canopy: 'ball' },
  'flower-bed': {
    trunkFraction: 0,
    trunkColor: '#4d6b34',
    leafColor: '#4f7a3a',
    canopy: 'billboard',
    accent: '#d4557f',
    accentCount: 1,
  },
  tulips: {
    trunkFraction: 0.6,
    trunkColor: '#4f7a3a',
    leafColor: '#4f7a3a',
    canopy: 'none',
    accent: '#cf4646',
    accentCount: 1,
  },
};

export function plantLook(species: PlantSpecies): Look {
  return LOOKS[species];
}

export function buildPlant(object: PlantObject, ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  const look = LOOKS[object.species];
  const random = makeRandom(object.seed || 1);
  const count = Math.max(1, Math.round(object.count));

  let baseY = 0;
  if (object.potted) {
    const potHeight = Math.max(0.18, Math.min(0.6, object.height * 0.22));
    const potRadius = Math.max(0.12, object.spread * 0.34);
    group.add(
      mesh(
        cylinder(potRadius, potRadius * 0.78, potHeight, 20),
        faceMaterial('clay', object.potColor),
      ),
    );
    // Soil disc just below the rim.
    const soil = mesh(cylinder(potRadius * 0.94, potRadius * 0.94, 0.02, 20), plainMaterial('#4b3a2b', 1), false);
    soil.position.y = potHeight - 0.03;
    group.add(soil);
    baseY = potHeight - 0.02;
  }

  for (let i = 0; i < count; i++) {
    // A single specimen sits on its origin; a clump scatters within `spread`.
    const spreadRadius = count > 1 ? object.spread / 2 : 0;
    const angle = random() * Math.PI * 2;
    const radius = count > 1 ? Math.sqrt(random()) * spreadRadius : 0;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const scale = count > 1 ? 0.82 + random() * 0.36 : 1;

    const individual = buildIndividual(object, look, object.height * scale, random, ctx);
    individual.position.set(x, baseY, z);
    individual.rotation.y = random() * Math.PI * 2;
    group.add(individual);
  }

  return group;
}

function buildIndividual(
  object: PlantObject,
  look: Look,
  height: number,
  random: () => number,
  ctx: BuildContext,
): THREE.Group {
  const group = new THREE.Group();
  // In a clump, `spread` is the extent of the whole clump, so each plant is
  // narrower than the group; a solitary specimen uses the full spread.
  const spread =
    object.count > 1 ? Math.max(0.12, object.spread / Math.sqrt(object.count) * 1.2) : object.spread;
  const trunkHeight = height * look.trunkFraction;
  const canopyHeight = height - trunkHeight;

  if (trunkHeight > 0.03) {
    const radius = Math.max(0.015, Math.min(0.16, height * 0.028));
    const trunk = mesh(cylinder(radius * 0.82, radius, trunkHeight, 10), barkMaterial(look.trunkColor));
    group.add(trunk);

    // A couple of branches lifting into the canopy read as a real tree.
    if (look.canopy === 'blobs' && height > 1.6) {
      for (let i = 0; i < 3; i++) {
        const branch = mesh(
          cylinder(radius * 0.3, radius * 0.55, canopyHeight * 0.5, 6),
          barkMaterial(look.trunkColor),
        );
        branch.position.y = trunkHeight * 0.72;
        branch.rotation.z = (random() - 0.5) * 0.9;
        branch.rotation.y = (i / 3) * Math.PI * 2 + random();
        group.add(branch);
      }
    }
  }

  switch (look.canopy) {
    case 'blobs': {
      const blobs = Math.round((3 + random() * 3) * (ctx.quality === 'low' ? 0.6 : 1));
      for (let i = 0; i < blobs; i++) {
        const size = spread * (0.42 + random() * 0.3);
        const blob = mesh(sphere(), foliageMaterial(look.leafColor));
        blob.scale.set(size, size * 0.82, size);
        blob.position.set(
          (random() - 0.5) * spread * 0.5,
          trunkHeight + canopyHeight * (0.3 + random() * 0.5),
          (random() - 0.5) * spread * 0.5,
        );
        group.add(blob);
      }
      break;
    }
    case 'cone': {
      const cone = mesh(
        new THREE.ConeGeometry(spread / 2, canopyHeight, 12).translate(0, canopyHeight / 2, 0),
        plainMaterial(look.leafColor, 0.95),
      );
      cone.position.y = trunkHeight;
      group.add(cone);
      break;
    }
    case 'ball': {
      const ball = mesh(sphere(), plainMaterial(look.leafColor, 0.95));
      ball.scale.setScalar(Math.min(spread, canopyHeight));
      ball.position.y = trunkHeight + Math.min(spread, canopyHeight) / 2;
      group.add(ball);
      break;
    }
    case 'column': {
      // Canes with foliage clustered along the upper part.
      const canes = Math.max(3, Math.round(5 * DETAIL[ctx.quality] + 2));
      const matrices: THREE.Matrix4[] = [];
      for (let i = 0; i < canes; i++) {
        const a = random() * Math.PI * 2;
        const r = random() * spread * 0.4;
        matrices.push(
          boxMatrix(
            Math.cos(a) * r,
            0,
            Math.sin(a) * r,
            0.018,
            height * (0.75 + random() * 0.3),
            0.018,
            random(),
          ),
        );
      }
      const caneMesh = instanced(UNIT_BOX, plainMaterial(look.trunkColor, 0.9), matrices);
      if (caneMesh) group.add(caneMesh);
      for (let i = 0; i < canes; i++) {
        const leaf = mesh(sphere(), foliageMaterial(look.leafColor));
        const size = spread * (0.3 + random() * 0.25);
        leaf.scale.set(size, size * 1.5, size);
        leaf.position.set(
          (random() - 0.5) * spread * 0.7,
          height * (0.45 + random() * 0.5),
          (random() - 0.5) * spread * 0.7,
        );
        group.add(leaf);
      }
      break;
    }
    case 'spikes': {
      // Lavender: a low mound with flower spikes standing above it.
      const mound = mesh(sphere(), plainMaterial(look.leafColor, 0.98));
      mound.scale.set(spread, height * 0.9, spread);
      mound.position.y = height * 0.28;
      group.add(mound);
      const spikes = Math.round((look.accentCount ?? 8) * DETAIL[ctx.quality]) + 3;
      const matrices: THREE.Matrix4[] = [];
      for (let i = 0; i < spikes; i++) {
        const a = random() * Math.PI * 2;
        const r = random() * spread * 0.45;
        matrices.push(
          boxMatrix(
            Math.cos(a) * r,
            height * 0.45,
            Math.sin(a) * r,
            0.02,
            height * 0.5,
            0.02,
            random(),
          ),
        );
      }
      const spikeMesh = instanced(UNIT_BOX, plainMaterial(look.accent ?? '#8d7bc0', 0.9), matrices);
      if (spikeMesh) group.add(spikeMesh);
      break;
    }
    case 'billboard': {
      const blade = mesh(crossQuad(), tuftMaterial(look.leafColor), false);
      blade.scale.set(spread * 1.1, height, spread * 1.1);
      blade.position.y = height / 2;
      group.add(blade);
      break;
    }
    case 'none':
      break;
  }

  // Fruit, blooms and flower heads.
  if (look.accent && look.canopy !== 'spikes') {
    const accents = Math.round((look.accentCount ?? 6) * DETAIL[ctx.quality]);
    if (object.species === 'tulips' || object.species === 'flower-bed') {
      const head = mesh(plane(), flowerMaterial(look.accent), false);
      const size = Math.min(0.16, spread * 0.7);
      head.scale.setScalar(size);
      head.position.y = height - size * 0.4;
      group.add(head);
      if (object.species === 'tulips') {
        const stem = mesh(cylinder(0.006, 0.008, height - size * 0.4, 5), plainMaterial('#4f7a3a', 0.95), false);
        group.add(stem);
        const leaf = mesh(crossQuad(), tuftMaterial('#4f7a3a'), false);
        leaf.scale.set(0.12, height * 0.55, 0.12);
        leaf.position.y = height * 0.28;
        group.add(leaf);
      }
    } else {
      for (let i = 0; i < accents; i++) {
        const fruit = mesh(sphere(), plainMaterial(look.accent, 0.6), false);
        const size = Math.min(0.09, spread * 0.06);
        fruit.scale.setScalar(size);
        const a = random() * Math.PI * 2;
        const r = spread * 0.24 * (0.5 + random() * 0.5);
        fruit.position.set(
          Math.cos(a) * r,
          trunkHeight + canopyHeight * (0.25 + random() * 0.6),
          Math.sin(a) * r,
        );
        group.add(fruit);
      }
    }
  }

  return group;
}

/* ------------------------------------------------------------ primitives */

let sphereGeometry: THREE.BufferGeometry | null = null;
let crossGeometry: THREE.BufferGeometry | null = null;
let planeGeometry: THREE.BufferGeometry | null = null;

/** Unit sphere, scaled per use. */
function sphere(): THREE.BufferGeometry {
  if (!sphereGeometry) sphereGeometry = new THREE.SphereGeometry(0.5, 12, 9);
  return sphereGeometry;
}

function crossQuad(): THREE.BufferGeometry {
  if (crossGeometry) return crossGeometry;
  // Centred on the origin: callers scale by the plant's height and lift it by
  // half of that, so the top lands exactly at the stated height.
  const a = new THREE.PlaneGeometry(1, 1);
  const b = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2);
  crossGeometry = mergeGeometries([a, b]) ?? a;
  return crossGeometry;
}

function plane(): THREE.BufferGeometry {
  if (!planeGeometry) planeGeometry = new THREE.PlaneGeometry(1, 1);
  return planeGeometry;
}
