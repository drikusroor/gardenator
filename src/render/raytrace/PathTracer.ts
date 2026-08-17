/**
 * Progressive GPU path tracer for the "ray traced" render mode.
 *
 * Owns a persistent float render target that accumulates one path-traced
 * sample per frame via additive blending; a small resolve pass divides by
 * the accumulated sample count and hands off to the shared renderer's own
 * tone mapping / colour space so the result matches the rasterised view's
 * look. Accumulation resets whenever the camera moves or the sun/scene
 * changes — hold the camera still and the image keeps sharpening.
 *
 * See `shaders.ts` for the path tracing shader itself and how this relates
 * to erichlof's THREE.js-PathTracing-Renderer.
 */

import * as THREE from 'three';
import type { SunState } from '../sky';
import { buildRaytraceGeometry, NODE_TEXELS, TEXTURE_WIDTH, TRIANGLE_TEXELS } from './sceneData';
import { FULLSCREEN_VERTEX, PATHTRACE_FRAGMENT, RESOLVE_FRAGMENT } from './shaders';

/** Everything the path tracer needs from `SkySystem` for a frame. */
export interface RaytraceLighting {
  sun: SunState;
  sunColor: THREE.Color;
  sunIntensity: number;
  sunVisible: number;
  skyTop: THREE.Color;
  skyBottom: THREE.Color;
}

const MOVE_EPSILON = 1e-5;
const COLOR_EPSILON = 1e-4;

function matrixDiffers(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  const ae = a.elements;
  const be = b.elements;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(ae[i] - be[i]) > MOVE_EPSILON) return true;
  }
  return false;
}

function colorDiffers(a: THREE.Color, b: THREE.Color): boolean {
  return (
    Math.abs(a.r - b.r) > COLOR_EPSILON ||
    Math.abs(a.g - b.g) > COLOR_EPSILON ||
    Math.abs(a.b - b.b) > COLOR_EPSILON
  );
}

function vectorDiffers(a: THREE.Vector3, b: THREE.Vector3): boolean {
  return a.distanceToSquared(b) > MOVE_EPSILON;
}

/** A 1x1 white pixel, used before the first real geometry upload. */
function placeholderTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Float32Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}

export class PathTracer {
  private accumTarget: THREE.WebGLRenderTarget;
  private accumulateMaterial: THREE.ShaderMaterial;
  private resolveMaterial: THREE.ShaderMaterial;
  private accumulateScene: THREE.Scene;
  private resolveScene: THREE.Scene;
  private quadCamera = new THREE.Camera();

  private triangleTexture: THREE.DataTexture;
  private bvhTexture: THREE.DataTexture;

  private sampleCounter = 0;
  private frameSeed = 0;

  /** True once `lastCameraMatrix`/`lastSun*` hold a real previous value —
   *  NaN sentinels don't work here since any NaN comparison is false, which
   *  would silently skip the reset a first render needs. */
  private hasPreviousState = false;
  private lastCameraMatrix = new THREE.Matrix4();
  private lastSunDirection = new THREE.Vector3();
  private lastSunColor = new THREE.Color();
  private lastSkyTop = new THREE.Color();
  private lastSkyBottom = new THREE.Color();

  constructor(private renderer: THREE.WebGLRenderer) {
    this.triangleTexture = placeholderTexture();
    this.bvhTexture = placeholderTexture();

    this.accumTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this.accumulateMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: PATHTRACE_FRAGMENT,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        tTriangleTexture: { value: this.triangleTexture },
        uTriangleTextureSize: { value: new THREE.Vector2(TEXTURE_WIDTH, 1) },
        tBvhTexture: { value: this.bvhTexture },
        uBvhTextureSize: { value: new THREE.Vector2(TEXTURE_WIDTH, 1) },
        uTriangleCount: { value: 0 },
        uCameraMatrix: { value: new THREE.Matrix4() },
        uCameraFovScale: { value: 1 },
        uCameraAspect: { value: 1 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uFrameCounter: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color('#fff2dc') },
        uSunIntensity: { value: 0 },
        uSunVisible: { value: 0 },
        uSkyTop: { value: new THREE.Color('#3e7cc4') },
        uSkyBottom: { value: new THREE.Color('#bcd4e6') },
        uAmbientColor: { value: new THREE.Color('#bcd4e6').multiplyScalar(0.12) },
      },
    });

    this.resolveMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: RESOLVE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tAccumulated: { value: this.accumTarget.texture },
      },
    });

    const quad = new THREE.PlaneGeometry(2, 2);
    this.accumulateScene = new THREE.Scene();
    this.accumulateScene.add(new THREE.Mesh(quad, this.accumulateMaterial));
    this.resolveScene = new THREE.Scene();
    this.resolveScene.add(new THREE.Mesh(quad, this.resolveMaterial));
  }

  get samples(): number {
    return this.sampleCounter;
  }

  setSize(width: number, height: number) {
    this.accumTarget.setSize(Math.max(1, width), Math.max(1, height));
    (this.accumulateMaterial.uniforms.uResolution.value as THREE.Vector2).set(width, height);
    this.reset();
  }

  /** Rebuilds the triangle + BVH textures from the current scene graph. Call
   *  sparingly — this walks every triangle on the main thread. */
  updateGeometry(root: THREE.Object3D) {
    const geometry = buildRaytraceGeometry(root);

    this.triangleTexture.dispose();
    this.triangleTexture = new THREE.DataTexture(
      geometry.triangleData,
      TEXTURE_WIDTH,
      geometry.triangleTextureHeight,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.triangleTexture.minFilter = THREE.NearestFilter;
    this.triangleTexture.magFilter = THREE.NearestFilter;
    this.triangleTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.triangleTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.triangleTexture.generateMipmaps = false;
    this.triangleTexture.flipY = false;
    this.triangleTexture.needsUpdate = true;

    this.bvhTexture.dispose();
    this.bvhTexture = new THREE.DataTexture(
      geometry.bvhData,
      TEXTURE_WIDTH,
      geometry.bvhTextureHeight,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.bvhTexture.minFilter = THREE.NearestFilter;
    this.bvhTexture.magFilter = THREE.NearestFilter;
    this.bvhTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.bvhTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.bvhTexture.generateMipmaps = false;
    this.bvhTexture.needsUpdate = true;

    const u = this.accumulateMaterial.uniforms;
    u.tTriangleTexture.value = this.triangleTexture;
    (u.uTriangleTextureSize.value as THREE.Vector2).set(TEXTURE_WIDTH, geometry.triangleTextureHeight);
    u.tBvhTexture.value = this.bvhTexture;
    (u.uBvhTextureSize.value as THREE.Vector2).set(TEXTURE_WIDTH, geometry.bvhTextureHeight);
    u.uTriangleCount.value = geometry.triangleCount;

    this.reset();
  }

  /** Clears the accumulation buffer and restarts convergence from sample 0. */
  reset() {
    this.sampleCounter = 0;
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.accumTarget);
    this.renderer.clear(true, true, true);
    this.renderer.setRenderTarget(previous);
  }

  /** Pushes sun/sky uniforms, resetting accumulation if the lighting moved. */
  private syncEnvironment({ sun, sunColor, sunIntensity, sunVisible, skyTop, skyBottom }: RaytraceLighting) {
    const changed =
      vectorDiffers(this.lastSunDirection, sun.direction) ||
      colorDiffers(this.lastSunColor, sunColor) ||
      colorDiffers(this.lastSkyTop, skyTop) ||
      colorDiffers(this.lastSkyBottom, skyBottom);

    const u = this.accumulateMaterial.uniforms;
    (u.uSunDirection.value as THREE.Vector3).copy(sun.direction);
    (u.uSunColor.value as THREE.Color).copy(sunColor);
    u.uSunIntensity.value = sunIntensity;
    u.uSunVisible.value = sunVisible;
    (u.uSkyTop.value as THREE.Color).copy(skyTop);
    (u.uSkyBottom.value as THREE.Color).copy(skyBottom);
    (u.uAmbientColor.value as THREE.Color).copy(skyBottom).multiplyScalar(0.12);

    this.lastSunDirection.copy(sun.direction);
    this.lastSunColor.copy(sunColor);
    this.lastSkyTop.copy(skyTop);
    this.lastSkyBottom.copy(skyBottom);

    if (changed || !this.hasPreviousState) this.reset();
  }

  private syncCamera(camera: THREE.PerspectiveCamera) {
    const moved =
      !this.hasPreviousState ||
      matrixDiffers(this.lastCameraMatrix, camera.matrixWorld) ||
      camera.aspect !== this.accumulateMaterial.uniforms.uCameraAspect.value;
    if (moved) this.reset();
    this.lastCameraMatrix.copy(camera.matrixWorld);

    const u = this.accumulateMaterial.uniforms;
    (u.uCameraMatrix.value as THREE.Matrix4).copy(camera.matrixWorld);
    u.uCameraFovScale.value = Math.tan((camera.fov * Math.PI) / 360);
    u.uCameraAspect.value = camera.aspect;
  }

  /** Accumulates one more sample and resolves it to the canvas. */
  render(camera: THREE.PerspectiveCamera, lighting: RaytraceLighting) {
    this.syncCamera(camera);
    this.syncEnvironment(lighting);
    this.hasPreviousState = true;

    this.sampleCounter += 1;
    this.accumulateMaterial.uniforms.uFrameCounter.value = this.frameSeed++;

    const previousAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;

    this.renderer.setRenderTarget(this.accumTarget);
    this.renderer.render(this.accumulateScene, this.quadCamera);

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.resolveScene, this.quadCamera);

    this.renderer.autoClear = previousAutoClear;
  }

  /** Runs `count` accumulation samples for a clean one-shot photo export.
   *  Yields to the event loop between samples so a slow GPU (or a big
   *  export resolution) doesn't freeze the tab for the whole run. */
  async renderSamples(count: number, camera: THREE.PerspectiveCamera, lighting: RaytraceLighting) {
    for (let i = 0; i < count; i++) {
      this.render(camera, lighting);
      await new Promise(requestAnimationFrame);
    }
  }

  dispose() {
    this.accumTarget.dispose();
    this.triangleTexture.dispose();
    this.bvhTexture.dispose();
    this.accumulateMaterial.dispose();
    this.resolveMaterial.dispose();
    for (const scene of [this.accumulateScene, this.resolveScene]) {
      scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
    }
  }
}

export { TEXTURE_WIDTH, TRIANGLE_TEXELS, NODE_TEXELS };
