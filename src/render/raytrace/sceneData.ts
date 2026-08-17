/**
 * Turns the already-built rasterised scene graph (`Viewer.world`) into the
 * flat triangle soup + BVH the path tracing shader needs.
 *
 * Re-using the rasteriser's own scene graph (rather than rebuilding geometry
 * from the document a second time) means the ray-traced view always matches
 * what's actually on screen — same quality setting, same grass toggle, same
 * night-time lamp geometry — for free.
 *
 * Materials are reduced to a flat colour + emissive per triangle (sampled
 * from each material's procedural canvas texture, alpha-weighted so cutout
 * foliage textures don't average in their transparent pixels). That is a
 * real simplification next to the source project this is adapted from —
 * see the module doc on `PathTracer` for why a full texture/BRDF pipeline
 * wasn't in scope — but it keeps every existing garden object recognisable
 * under path tracing without a second texture-authoring pass.
 */

import * as THREE from 'three';
import { buildBVH } from './bvh';

export const TRIANGLE_TEXELS = 5;
export const NODE_TEXELS = 2;
/** Position+range, then colour×intensity+decay — mirrors three.js's
 *  physically-correct point/spot light attenuation (see `getDistanceAttenuation`
 *  in three's `lights_pars_begin.glsl.js`), spot lights simplified to
 *  omnidirectional since none of the fittings' cones are narrow. */
export const LIGHT_TEXELS = 2;
/** Fixed texture width; height grows with scene size. Matches the texel
 *  addressing scheme in `shaders.ts` (`mod`/`floor` against this constant). */
export const TEXTURE_WIDTH = 2048;

export interface RaytraceGeometry {
  triangleCount: number;
  triangleData: Float32Array;
  triangleTextureHeight: number;
  nodeCount: number;
  bvhData: Float32Array;
  bvhTextureHeight: number;
  lightCount: number;
  lightData: Float32Array;
  lightTextureHeight: number;
}

const materialLookCache = new WeakMap<THREE.Material, { color: THREE.Color; emissive: THREE.Color }>();

/** Alpha-weighted average of a canvas texture, so cutout foliage textures
 *  read as leaf-green rather than washed-out grey from their transparent
 *  fringe pixels. */
function averageCanvasColor(image: unknown): { r: number; g: number; b: number } | null {
  if (!(image instanceof HTMLCanvasElement) && !(image instanceof OffscreenCanvas)) return null;
  const size = 8;
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image as CanvasImageSource, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let aSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    r += data[i] * a;
    g += data[i + 1] * a;
    b += data[i + 2] * a;
    aSum += a;
  }
  if (aSum < 1e-6) return null;
  return { r: r / aSum / 255, g: g / aSum / 255, b: b / aSum / 255 };
}

function materialLook(material: THREE.Material): { color: THREE.Color; emissive: THREE.Color } {
  const cached = materialLookCache.get(material);
  if (cached) return cached;

  const std = material as THREE.MeshStandardMaterial;
  const color = std.color ? std.color.clone() : new THREE.Color(1, 1, 1);
  const map = std.map;
  if (map) {
    const avg = averageCanvasColor(map.image);
    if (avg) color.multiply(new THREE.Color().setRGB(avg.r, avg.g, avg.b, THREE.SRGBColorSpace));
  }

  const emissive = std.emissive ? std.emissive.clone().multiplyScalar(std.emissiveIntensity ?? 1) : new THREE.Color(0, 0, 0);

  const look = { color, emissive };
  materialLookCache.set(material, look);
  return look;
}

function meshMaterial(mesh: THREE.Mesh): THREE.Material | null {
  const material = mesh.material;
  if (!material) return null;
  return Array.isArray(material) ? material[0] : material;
}

/** Number of triangles a mesh contributes, accounting for instancing. */
function triangleCountOf(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  if (!geometry) return 0;
  const perInstance = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
  const instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
  return Math.floor(perInstance) * instances;
}

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchNormal = new THREE.Vector3();
const scratchEdge1 = new THREE.Vector3();
const scratchEdge2 = new THREE.Vector3();
const scratchMatrix = new THREE.Matrix4();
const scratchInstance = new THREE.Matrix4();

/** Builds the triangle + BVH buffers a `PathTracer` uploads to the GPU. */
export function buildRaytraceGeometry(root: THREE.Object3D): RaytraceGeometry {
  root.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  const lights: (THREE.PointLight | THREE.SpotLight)[] = [];
  root.traverse((child) => {
    if (!child.visible) return;
    if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    else if ((child as THREE.PointLight).isPointLight || (child as THREE.SpotLight).isSpotLight) {
      lights.push(child as THREE.PointLight | THREE.SpotLight);
    }
  });

  let triangleCount = 0;
  for (const mesh of meshes) triangleCount += triangleCountOf(mesh);

  const triangleData = new Float32Array(Math.max(1, triangleCount) * TRIANGLE_TEXELS * 4);
  // Sized for the BVH build's worst case (2 nodes per triangle, 8 floats
  // each) — always >= the 9-floats-per-triangle input it starts out holding.
  const aabb = new Float32Array(Math.max(1, triangleCount) * 2 * 8);

  let triIndex = 0;
  for (const mesh of meshes) {
    const material = meshMaterial(mesh);
    if (!material) continue;
    const { color, emissive } = materialLook(material);
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;
    const trisPerInstance = index ? index.count / 3 : position.count / 3;
    const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh;
    const instanceCount = instanced ? (mesh as THREE.InstancedMesh).count : 1;

    for (let instance = 0; instance < instanceCount; instance++) {
      if (instanced) {
        (mesh as THREE.InstancedMesh).getMatrixAt(instance, scratchInstance);
        scratchMatrix.multiplyMatrices(mesh.matrixWorld, scratchInstance);
      } else {
        scratchMatrix.copy(mesh.matrixWorld);
      }

      for (let tri = 0; tri < trisPerInstance; tri++) {
        const i0 = index ? index.getX(tri * 3 + 0) : tri * 3 + 0;
        const i1 = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
        const i2 = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;

        scratchA.fromBufferAttribute(position, i0).applyMatrix4(scratchMatrix);
        scratchB.fromBufferAttribute(position, i1).applyMatrix4(scratchMatrix);
        scratchC.fromBufferAttribute(position, i2).applyMatrix4(scratchMatrix);

        scratchEdge1.subVectors(scratchB, scratchA);
        scratchEdge2.subVectors(scratchC, scratchA);
        scratchNormal.crossVectors(scratchEdge1, scratchEdge2);
        if (scratchNormal.lengthSq() < 1e-12) {
          scratchNormal.set(0, 1, 0);
        } else {
          scratchNormal.normalize();
        }

        const t = triIndex * TRIANGLE_TEXELS * 4;
        triangleData[t + 0] = scratchA.x;
        triangleData[t + 1] = scratchA.y;
        triangleData[t + 2] = scratchA.z;
        triangleData[t + 3] = scratchB.x;

        triangleData[t + 4] = scratchB.y;
        triangleData[t + 5] = scratchB.z;
        triangleData[t + 6] = scratchC.x;
        triangleData[t + 7] = scratchC.y;

        triangleData[t + 8] = scratchC.z;
        triangleData[t + 9] = scratchNormal.x;
        triangleData[t + 10] = scratchNormal.y;
        triangleData[t + 11] = scratchNormal.z;

        triangleData[t + 12] = color.r;
        triangleData[t + 13] = color.g;
        triangleData[t + 14] = color.b;
        triangleData[t + 15] = emissive.r;

        triangleData[t + 16] = emissive.g;
        triangleData[t + 17] = emissive.b;
        triangleData[t + 18] = 0;
        triangleData[t + 19] = 0;

        const bMin = scratchA.clone().min(scratchB).min(scratchC);
        const bMax = scratchA.clone().max(scratchB).max(scratchC);
        const a = triIndex * 9;
        aabb[a + 0] = bMin.x;
        aabb[a + 1] = bMin.y;
        aabb[a + 2] = bMin.z;
        aabb[a + 3] = bMax.x;
        aabb[a + 4] = bMax.y;
        aabb[a + 5] = bMax.z;
        aabb[a + 6] = (scratchA.x + scratchB.x + scratchC.x) / 3;
        aabb[a + 7] = (scratchA.y + scratchB.y + scratchC.y) / 3;
        aabb[a + 8] = (scratchA.z + scratchB.z + scratchC.z) / 3;

        triIndex++;
      }
    }
  }

  const { nodeCount } = triangleCount > 0 ? buildBVH(aabb, triangleCount) : { nodeCount: 0 };

  const triangleTextureHeight = Math.max(1, Math.ceil((triangleCount * TRIANGLE_TEXELS) / TEXTURE_WIDTH));
  const bvhTextureHeight = Math.max(1, Math.ceil((nodeCount * NODE_TEXELS) / TEXTURE_WIDTH));

  const paddedTriangleData = new Float32Array(TEXTURE_WIDTH * triangleTextureHeight * 4);
  paddedTriangleData.set(triangleData.subarray(0, Math.min(triangleData.length, paddedTriangleData.length)));

  const paddedBvhData = new Float32Array(TEXTURE_WIDTH * bvhTextureHeight * 4);
  paddedBvhData.set(aabb.subarray(0, Math.min(nodeCount * 8, paddedBvhData.length)));

  // Point/spot fittings (post lamps, ground spots, lanterns, festoon bulbs)
  // — captured separately from their small emissive bulb mesh above, since a
  // random diffuse bounce has almost no chance of hitting something that
  // small. Without these as real next-event-estimation lights, night scenes
  // go nearly black beyond whatever bulb geometry the camera looks straight
  // at, since the raster view's actual illumination comes from these lights.
  const scratchLightPos = new THREE.Vector3();
  const lightData = new Float32Array(Math.max(1, lights.length) * LIGHT_TEXELS * 4);
  let lightIndex = 0;
  for (const light of lights) {
    if (light.intensity <= 0) continue;
    light.getWorldPosition(scratchLightPos);
    const l = lightIndex * LIGHT_TEXELS * 4;
    lightData[l + 0] = scratchLightPos.x;
    lightData[l + 1] = scratchLightPos.y;
    lightData[l + 2] = scratchLightPos.z;
    lightData[l + 3] = light.distance;
    lightData[l + 4] = light.color.r * light.intensity;
    lightData[l + 5] = light.color.g * light.intensity;
    lightData[l + 6] = light.color.b * light.intensity;
    lightData[l + 7] = light.decay;
    lightIndex++;
  }
  const lightCount = lightIndex;
  const lightTextureHeight = Math.max(1, Math.ceil((lightCount * LIGHT_TEXELS) / TEXTURE_WIDTH));
  const paddedLightData = new Float32Array(TEXTURE_WIDTH * lightTextureHeight * 4);
  paddedLightData.set(lightData.subarray(0, Math.min(lightCount * LIGHT_TEXELS * 4, paddedLightData.length)));

  return {
    triangleCount,
    triangleData: paddedTriangleData,
    triangleTextureHeight,
    nodeCount,
    bvhData: paddedBvhData,
    lightCount,
    lightData: paddedLightData,
    lightTextureHeight,
    bvhTextureHeight,
  };
}
