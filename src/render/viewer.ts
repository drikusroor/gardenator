/**
 * The 3D viewport.
 *
 * Owns the renderer, the scene graph mirror of the document, picking, and the
 * render loop. Editing gadgets (gizmo, vertex handles, draw tool) live in
 * `editing.ts` and are driven from here.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import type { Store } from '../core/store';
import type { Vec2 } from '../core/types';
import { buildObject } from './build';
import type { BuildContext } from './build/context';
import { CameraRig, type CameraMode } from './cameras';
import { Overlays } from './overlays';
import { SkySystem, type SunState } from './sky';

export interface PickResult {
  objectId: string | null;
  /** Where the ray met the scene, in world space. */
  point: THREE.Vector3;
  /** Where the ray met the ground plane (y = 0). */
  ground: Vec2;
}

const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly sky: SkySystem;
  readonly overlays: Overlays;
  /** Everything built from the document lives under here. */
  readonly world = new THREE.Group();
  /** Editing gadgets that must not be picked or outlined. */
  readonly gadgets = new THREE.Group();

  sun: SunState;

  private composer: EffectComposer;
  private outline: OutlinePass;
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private frame = 0;
  private built = new Map<string, { hash: string; node: THREE.Group }>();
  private resizeObserver: ResizeObserver;
  private running = true;
  private onBeforeRender: (() => void)[] = [];

  constructor(
    private container: HTMLElement,
    private store: Store,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // ACES rolls the midtones down; a little extra exposure puts a sunlit
    // garden back where the eye expects it.
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('viewport-canvas');

    this.scene.add(this.world);
    this.scene.add(this.gadgets);

    const rect = container.getBoundingClientRect();
    this.rig = new CameraRig(this.renderer.domElement, Math.max(0.1, rect.width / rect.height));
    this.sky = new SkySystem(this.scene);
    this.overlays = new Overlays(this.scene, store);

    // Multisampled composer target: the outline pass would otherwise give up
    // the antialiasing the renderer was created with.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));

    this.outline = new OutlinePass(new THREE.Vector2(1, 1), this.scene, this.rig.camera);
    this.outline.edgeStrength = 4.2;
    this.outline.edgeGlow = 0.45;
    this.outline.edgeThickness = 1.6;
    this.outline.pulsePeriod = 0;
    this.outline.visibleEdgeColor.set('#ffb340');
    this.outline.hiddenEdgeColor.set('#7a4d12');
    this.composer.addPass(this.outline);
    this.composer.addPass(new OutputPass());

    this.sun = this.sky.update(store.doc.environment, store.doc.site);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.rebuildAll();
    this.rig.setPreset('iso', store.doc.site.width, store.doc.site.depth);
    this.loop();
  }

  /* --------------------------------------------------------------- scene */

  private context(layer: number): BuildContext {
    const view = this.store.doc.view;
    return {
      quality: view.quality,
      showGrass: view.showGrass,
      night: this.sun?.night ?? false,
      layer,
      doc: this.store.doc,
    };
  }

  /**
   * Rebuilds only the objects whose serialised form changed.
   * A snapshot comparison is cheap next to rebuilding a tiled terrace, and it
   * means the caller never has to say what it touched.
   */
  syncFromDocument() {
    const objects = this.store.doc.objects;
    const seen = new Set<string>();
    // Night flips lamp geometry, so it forms part of every object's hash.
    const globals = `${this.sun.night}|${this.store.doc.view.quality}|${this.store.doc.view.showGrass}|${this.store.doc.view.unit}`;

    objects.forEach((object, index) => {
      seen.add(object.id);
      const hash = `${index}|${globals}|${JSON.stringify(object)}`;
      const existing = this.built.get(object.id);
      if (existing && existing.hash === hash) return;
      if (existing) this.removeNode(existing.node);
      const node = buildObject(object, this.context(index));
      this.world.add(node);
      this.built.set(object.id, { hash, node });
    });

    for (const [id, entry] of this.built) {
      if (seen.has(id)) continue;
      this.removeNode(entry.node);
      this.built.delete(id);
    }

    this.overlays.sync(this.sun);
    this.refreshOutline();
  }

  rebuildAll() {
    for (const entry of this.built.values()) this.removeNode(entry.node);
    this.built.clear();
    this.syncFromDocument();
  }

  private removeNode(node: THREE.Group) {
    this.world.remove(node);
    node.traverse((child) => {
      const asMesh = child as THREE.Mesh;
      // Geometry is per-object; materials and textures are shared and cached.
      if (asMesh.geometry && !asMesh.geometry.userData.shared) asMesh.geometry.dispose();
    });
  }

  /** The scene node for a document object, if it has been built. */
  nodeFor(id: string): THREE.Group | null {
    return this.built.get(id)?.node ?? null;
  }

  /* ----------------------------------------------------------- selection */

  refreshOutline() {
    const objects: THREE.Object3D[] = [];
    for (const id of this.store.selection) {
      const node = this.built.get(id)?.node;
      if (node) objects.push(node);
    }
    this.outline.selectedObjects = objects;
  }

  /* ------------------------------------------------------------- picking */

  /** Normalised device coordinates for a pointer event. */
  private ndc(event: { clientX: number; clientY: number }): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  /** Raycasts the built world; ignores gadgets, helpers and hidden objects. */
  pick(event: { clientX: number; clientY: number }): PickResult {
    this.raycaster.setFromCamera(this.ndc(event), this.rig.camera);
    const hits = this.raycaster.intersectObject(this.world, true);

    const ground = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(GROUND_PLANE, ground);

    for (const hit of hits) {
      const id = findObjectId(hit.object);
      if (!id) continue;
      const object = this.store.find(id);
      if (!object || object.hidden) continue;
      return { objectId: id, point: hit.point, ground: { x: ground.x, z: ground.z } };
    }
    return { objectId: null, point: ground.clone(), ground: { x: ground.x, z: ground.z } };
  }

  /** Where a pointer ray meets a horizontal plane at height `y`. */
  groundPoint(event: { clientX: number; clientY: number }, y = 0): Vec2 | null {
    this.raycaster.setFromCamera(this.ndc(event), this.rig.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, point)) return null;
    return { x: point.x, z: point.z };
  }

  /** Raycasts a specific set of objects, used by the vertex handles. */
  pickObjects(event: { clientX: number; clientY: number }, targets: THREE.Object3D[]) {
    this.raycaster.setFromCamera(this.ndc(event), this.rig.camera);
    return this.raycaster.intersectObjects(targets, true);
  }

  /** World-space bounding box of a document object. */
  boundsOf(ids: string[]): THREE.Box3 {
    const box = new THREE.Box3();
    for (const id of ids) {
      const node = this.built.get(id)?.node;
      if (node) box.expandByObject(node);
    }
    return box;
  }

  /* --------------------------------------------------------------- camera */

  setCameraMode(mode: CameraMode) {
    this.rig.eyeHeight = this.store.doc.view.personHeight;
    this.rig.setMode(mode);
  }

  frameSelection() {
    const ids = this.store.selection.length
      ? this.store.selection
      : this.store.doc.objects.map((o) => o.id);
    const box = this.boundsOf(ids);
    if (!box.isEmpty()) this.rig.frame(box);
  }

  /* ----------------------------------------------------------------- loop */

  addFrameCallback(callback: () => void) {
    this.onBeforeRender.push(callback);
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.outline.setSize(width, height);
    this.rig.setAspect(width / height);
  }

  private loop = () => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.loop);
    const delta = Math.min(0.1, this.clock.getDelta());

    const environment = this.store.doc.environment;
    if (environment.playing) {
      environment.timeMinutes = (environment.timeMinutes + environment.speed * delta) % 1440;
      const wasNight = this.sun.night;
      this.sun = this.sky.update(environment, this.store.doc.site);
      // Only the day/night flip changes geometry; the rest is just lighting.
      if (wasNight !== this.sun.night) this.syncFromDocument();
      this.overlays.updateSunPath(this.sun);
    }

    this.rig.eyeHeight = this.store.doc.view.personHeight;
    this.rig.update(delta);
    for (const callback of this.onBeforeRender) callback();

    this.composer.render();
  };

  /** Recomputes lighting after the environment settings change. */
  updateSun() {
    const wasNight = this.sun.night;
    this.sun = this.sky.update(this.store.doc.environment, this.store.doc.site);
    if (wasNight !== this.sun.night) this.syncFromDocument();
    this.overlays.updateSunPath(this.sun);
  }

  /** Renders one frame off-screen at a given size and returns a PNG blob. */
  async snapshot(width: number, height: number): Promise<Blob | null> {
    const previous = new THREE.Vector2();
    this.renderer.getSize(previous);
    const ratio = this.renderer.getPixelRatio();

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.rig.setAspect(width / height);
    this.composer.setSize(width, height);
    this.outline.setSize(width, height);
    this.composer.render();

    const blob = await new Promise<Blob | null>((resolve) =>
      this.renderer.domElement.toBlob(resolve, 'image/png'),
    );

    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(previous.x, previous.y, false);
    this.rig.setAspect(previous.x / previous.y);
    this.composer.setSize(previous.x, previous.y);
    this.outline.setSize(previous.x, previous.y);
    return blob;
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.rig.dispose();
    this.sky.dispose();
    this.overlays.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Walks up to the tagged root of whatever the ray hit. */
function findObjectId(object: THREE.Object3D): string | null {
  let node: THREE.Object3D | null = object;
  while (node) {
    const id = node.userData.objectId;
    if (typeof id === 'string') return id;
    node = node.parent;
  }
  return null;
}
