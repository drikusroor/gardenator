/**
 * Cached materials.
 *
 * Textures are authored so that one texture repeat covers a known number of
 * metres (ground) or one paving unit (faces). Geometry writes UVs in those
 * units, which means a single shared texture instance can serve every object
 * in the scene — no per-object clones, no per-object `repeat` juggling.
 */

import * as THREE from 'three';
import {
  barkTexture,
  faceTexture,
  flowerTexture,
  foliageTexture,
  glowTexture,
  grassTuftTexture,
  groundTexture,
  masonryTexture,
  type FaceTexture,
  type GroundTextureKind,
} from './textures';
import type { BlockSpec, GroundKind } from '../core/types';

const cache = new Map<string, THREE.Material>();

function cached<T extends THREE.Material>(key: string, create: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const material = create();
  cache.set(key, material);
  return material;
}

/** Roughness/metalness per ground type, so wet-looking things read as wet. */
const GROUND_LOOK: Record<GroundKind, { roughness: number; metalness: number }> = {
  grass: { roughness: 0.98, metalness: 0 },
  dirt: { roughness: 1, metalness: 0 },
  mulch: { roughness: 1, metalness: 0 },
  gravel: { roughness: 0.95, metalness: 0 },
  concrete: { roughness: 0.85, metalness: 0 },
  tiles: { roughness: 0.75, metalness: 0 },
  deck: { roughness: 0.7, metalness: 0 },
  water: { roughness: 0.08, metalness: 0.2 },
};

export const GROUND_DEFAULT_COLOR: Record<GroundKind, string> = {
  grass: '#5f8542',
  dirt: '#5c4633',
  mulch: '#4a382a',
  gravel: '#9a958c',
  concrete: '#a5a29b',
  tiles: '#8e8e8c',
  deck: '#8a6a45',
  water: '#2f6b7a',
};

const GROUND_TEXTURE: Record<GroundKind, GroundTextureKind> = {
  grass: 'grass',
  dirt: 'dirt',
  mulch: 'mulch',
  gravel: 'gravel',
  concrete: 'concrete',
  tiles: 'concrete',
  deck: 'concrete',
  water: 'water',
};

/** Material for a ground surface. UVs must be in metres. */
export function groundMaterial(kind: GroundKind, color?: string): THREE.MeshStandardMaterial {
  const tint = color ?? GROUND_DEFAULT_COLOR[kind];
  return cached(`ground:${kind}:${tint}`, () => {
    const look = GROUND_LOOK[kind];
    const material = new THREE.MeshStandardMaterial({
      map: groundTexture(GROUND_TEXTURE[kind], tint),
      roughness: look.roughness,
      metalness: look.metalness,
    });
    if (kind === 'water') {
      material.transparent = true;
      material.opacity = 0.82;
    }
    return material;
  });
}

/** Material for a paving unit or a masonry block face. UVs in unit space. */
export function faceMaterial(kind: FaceTexture, color: string): THREE.MeshStandardMaterial {
  return cached(`face:${kind}:${color}`, () => {
    const rough = kind === 'wood' ? 0.72 : kind === 'smooth' ? 0.62 : 0.88;
    return new THREE.MeshStandardMaterial({
      map: faceTexture(kind, color),
      roughness: rough,
      metalness: 0,
    });
  });
}

/** Flat colour, no texture — mortar beds, joints, painted parts. */
export function plainMaterial(
  color: string,
  roughness = 0.85,
  metalness = 0,
): THREE.MeshStandardMaterial {
  return cached(`plain:${color}:${roughness}:${metalness}`, () => {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  });
}

/** Laid masonry for large wall faces. UVs in metres. */
export function masonryMaterial(spec: BlockSpec): THREE.MeshStandardMaterial {
  const key = `masonry:${spec.length}:${spec.height}:${spec.joint}:${spec.bondOffset}:${spec.color}:${spec.jointColor}:${spec.texture}`;
  return cached(key, () => {
    return new THREE.MeshStandardMaterial({
      map: masonryTexture(
        spec.length,
        spec.height,
        spec.joint,
        spec.bondOffset,
        spec.color,
        spec.jointColor,
        spec.texture,
      ),
      roughness: 0.92,
      metalness: 0,
    });
  });
}

export function barkMaterial(color: string): THREE.MeshStandardMaterial {
  return cached(`bark:${color}`, () => {
    return new THREE.MeshStandardMaterial({
      map: barkTexture(color),
      roughness: 0.95,
      metalness: 0,
    });
  });
}

/**
 * Alpha-tested billboard material. Alpha *test* rather than blending keeps
 * sprites sorting correctly against each other and casting real shadows,
 * which is what makes a lawn of thousands of tufts affordable.
 */
export function spriteMaterial(
  texture: THREE.Texture,
  key: string,
  doubleSided = true,
): THREE.MeshStandardMaterial {
  return cached(`sprite:${key}`, () => {
    return new THREE.MeshStandardMaterial({
      map: texture,
      transparent: false,
      alphaTest: 0.42,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      roughness: 0.9,
      metalness: 0,
    });
  });
}

export function tuftMaterial(color: string): THREE.MeshStandardMaterial {
  return spriteMaterial(grassTuftTexture(color), `tuft:${color}`);
}

export function foliageMaterial(color: string): THREE.MeshStandardMaterial {
  return spriteMaterial(foliageTexture(color), `foliage:${color}`);
}

export function flowerMaterial(color: string): THREE.MeshStandardMaterial {
  return spriteMaterial(flowerTexture(color), `flower:${color}`);
}

/** Emissive bulb glass — bright at night, plain during the day. */
export function bulbMaterial(color: string, lit: boolean): THREE.MeshStandardMaterial {
  return cached(`bulb:${color}:${lit}`, () => {
    return new THREE.MeshStandardMaterial({
      color: lit ? color : '#d8d4cc',
      emissive: new THREE.Color(lit ? color : '#000000'),
      emissiveIntensity: lit ? 2.4 : 0,
      roughness: 0.3,
      metalness: 0,
    });
  });
}

export function glowMaterial(color: string): THREE.SpriteMaterial {
  return cached(`glow:${color}`, () => {
    return new THREE.SpriteMaterial({
      map: glowTexture(),
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
    });
  }) as unknown as THREE.SpriteMaterial;
}

export function glassMaterial(): THREE.MeshStandardMaterial {
  return cached('glass', () => {
    return new THREE.MeshStandardMaterial({
      color: '#8fb6c8',
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.45,
    });
  });
}

export function lineMaterial(color: string, opacity = 1): THREE.LineBasicMaterial {
  return cached(`line:${color}:${opacity}`, () => {
    return new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthTest: true,
    });
  });
}
