/**
 * Direct manipulation in the viewport.
 *
 * Covers the Blender-style transform gizmo, per-vertex editing of polygons and
 * paths, the click-to-draw tools, and the live dimension read-out that makes
 * the whole thing usable as a measuring tool rather than a toy.
 */

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { isShaped, isClosedShape, shapePoints, uid } from '../core/factory';
import {
  add,
  centroid,
  distance,
  lerp2,
  pointInPolygon,
  rotate,
  snapPoint,
  snapValue,
  sub,
  toLocal,
} from '../core/geometry';
import type { Store } from '../core/store';
import type { GardenObject, Vec2 } from '../core/types';
import { formatShort } from '../core/units';
import { makeLabel } from './label';
import type { Viewer } from './viewer';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

export type DrawKind = 'surface' | 'wall' | 'fence' | 'path' | 'string-light';

export type Tool =
  | { kind: 'select' }
  | { kind: 'draw'; draw: DrawKind }
  | { kind: 'place'; make: (point: Vec2) => GardenObject; label: string }
  | { kind: 'measure' };

export interface EditorEvents {
  onToolFinished?: () => void;
  onStatus?: (message: string) => void;
}

const HANDLE_COLOR = '#ffd166';
const HANDLE_HOVER = '#ffffff';
const INSERT_COLOR = '#6fd3a8';

export class Editor {
  tool: Tool = { kind: 'select' };
  gizmoMode: GizmoMode = 'translate';
  /** Snap increment in metres; 0 disables snapping. */
  private get snap(): number {
    return this.store.doc.view.snap;
  }

  private controls: TransformControls;
  private proxy = new THREE.Object3D();
  private handleGroup = new THREE.Group();
  private dimensionGroup = new THREE.Group();
  private draftGroup = new THREE.Group();

  private vertexHandles: THREE.Mesh[] = [];
  private insertHandles: THREE.Mesh[] = [];
  private draggingVertex: { index: number; objectId: string } | null = null;
  private hoveredHandle: THREE.Mesh | null = null;

  /** Points collected so far by a draw tool, in world space. */
  private draft: Vec2[] = [];
  private draftCursor: Vec2 | null = null;

  /** Baseline captured when a scale drag starts. */
  private scaleBaseline: GardenObject | null = null;

  private disposers: (() => void)[] = [];

  constructor(
    private viewer: Viewer,
    private store: Store,
    private events: EditorEvents = {},
  ) {
    this.controls = new TransformControls(viewer.rig.camera, viewer.renderer.domElement);
    this.controls.setSize(0.9);
    this.controls.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean((event as unknown as { value: boolean }).value);
      viewer.rig.orbit.enabled = !dragging && viewer.rig.mode === 'orbit';
      if (dragging) {
        this.scaleBaseline = this.store.primary ? structuredClone(this.store.primary) : null;
      } else {
        this.scaleBaseline = null;
        this.store.commit();
      }
    });
    this.controls.addEventListener('objectChange', () => this.applyGizmo());

    viewer.gadgets.add(this.controls.getHelper());
    viewer.gadgets.add(this.proxy);
    viewer.gadgets.add(this.handleGroup);
    viewer.gadgets.add(this.dimensionGroup);
    viewer.gadgets.add(this.draftGroup);

    this.bindPointer();
    viewer.addFrameCallback(() => this.scaleHandles());
  }

  /* ---------------------------------------------------------------- tools */

  setTool(tool: Tool) {
    this.cancelDraft();
    this.tool = tool;
    this.refresh();
    if (tool.kind === 'draw') {
      this.events.onStatus?.(
        'Klik om punten te zetten · Enter of dubbelklik om af te ronden · Esc annuleert',
      );
    } else if (tool.kind === 'place') {
      this.events.onStatus?.(`Klik in de tuin om ${tool.label} te plaatsen · Esc annuleert`);
    } else if (tool.kind === 'measure') {
      this.events.onStatus?.('Klik twee punten om een maat te zetten · Esc annuleert');
    } else {
      this.events.onStatus?.('');
    }
  }

  setGizmoMode(mode: GizmoMode) {
    this.gizmoMode = mode;
    this.controls.mode = mode;
    this.refresh();
  }

  /** Rebuilds the gizmo, handles and dimension labels for the selection. */
  refresh() {
    const selected = this.store.selected;
    const primary = selected[0] ?? null;

    // Gizmo: only on a single unlocked object, and never mid-draw.
    if (primary && !primary.locked && this.tool.kind === 'select' && selected.length === 1) {
      this.proxy.position.set(primary.position.x, primary.elevation, primary.position.z);
      this.proxy.rotation.set(0, primary.rotation, 0);
      this.proxy.scale.set(1, 1, 1);
      this.proxy.updateMatrixWorld();
      this.controls.attach(this.proxy);
      this.controls.enabled = true;
      this.controls.mode = this.gizmoMode;
      this.controls.translationSnap = this.snap > 0 ? this.snap : null;
      this.controls.rotationSnap = Math.PI / 36;
      this.controls.showY = this.gizmoMode !== 'rotate';
    } else {
      this.controls.detach();
      this.controls.enabled = false;
    }

    this.rebuildHandles();
    this.rebuildDimensions();
  }

  /* ---------------------------------------------------------------- gizmo */

  private applyGizmo() {
    const object = this.store.primary;
    if (!object || object.locked) return;

    this.store.updateLive((doc) => {
      const target = doc.objects.find((o) => o.id === object.id);
      if (!target) return;

      if (this.gizmoMode === 'translate') {
        target.position = {
          x: snapValue(this.proxy.position.x, this.snap),
          z: snapValue(this.proxy.position.z, this.snap),
        };
        target.elevation = snapValue(Math.max(0, this.proxy.position.y), this.snap);
      } else if (this.gizmoMode === 'rotate') {
        target.rotation = this.proxy.rotation.y;
      } else if (this.scaleBaseline) {
        applyScale(target, this.scaleBaseline, this.proxy.scale);
      }
    });

    this.rebuildHandles();
    this.rebuildDimensions();
  }

  /* ------------------------------------------------------- vertex editing */

  private rebuildHandles() {
    clearGroup(this.handleGroup);
    this.vertexHandles = [];
    this.insertHandles = [];

    const selected = this.store.selected;
    if (selected.length !== 1) return;
    const object = selected[0];
    if (!isShaped(object) || object.locked) return;
    const points = shapePoints(object);
    if (!points) return;

    const closed = isClosedShape(object);
    const geometry = new THREE.SphereGeometry(1, 12, 10);

    points.forEach((point, index) => {
      const handle = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: HANDLE_COLOR, depthTest: false }),
      );
      handle.renderOrder = 900;
      const world = this.toWorld(object, point);
      handle.position.set(world.x, object.elevation + 0.02, world.z);
      handle.userData.handleIndex = index;
      this.handleGroup.add(handle);
      this.vertexHandles.push(handle);
    });

    // Midpoint "+" handles insert a new vertex on that edge.
    const edgeCount = closed ? points.length : points.length - 1;
    for (let i = 0; i < edgeCount; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (distance(a, b) < 0.25) continue;
      const handle = new THREE.Mesh(
        new THREE.OctahedronGeometry(1),
        new THREE.MeshBasicMaterial({ color: INSERT_COLOR, depthTest: false, opacity: 0.85, transparent: true }),
      );
      handle.renderOrder = 899;
      const world = this.toWorld(object, lerp2(a, b, 0.5));
      handle.position.set(world.x, object.elevation + 0.02, world.z);
      handle.userData.insertAfter = i;
      this.handleGroup.add(handle);
      this.insertHandles.push(handle);
    }
  }

  /** Keeps handles a constant size on screen regardless of camera distance. */
  private scaleHandles() {
    const camera = this.viewer.rig.camera;
    for (const handle of [...this.vertexHandles, ...this.insertHandles]) {
      const distanceToCamera = camera.position.distanceTo(handle.position);
      handle.scale.setScalar(Math.max(0.02, distanceToCamera * 0.011));
    }
  }

  private toWorld(object: GardenObject, point: Vec2): Vec2 {
    return add(rotate(point, object.rotation), object.position);
  }

  /* ------------------------------------------------------------ dimensions */

  private rebuildDimensions() {
    clearGroup(this.dimensionGroup);
    if (!this.store.doc.view.showDimensions) return;

    const selected = this.store.selected;
    if (selected.length !== 1) return;
    const object = selected[0];

    const points = shapePoints(object);
    if (points && points.length >= 2) {
      const closed = isClosedShape(object);
      const edgeCount = closed ? points.length : points.length - 1;
      for (let i = 0; i < edgeCount; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const length = distance(a, b);
        if (length < 0.06) continue;
        const mid = this.toWorld(object, lerp2(a, b, 0.5));
        const label = makeLabel(formatShort(length), {
          color: '#0f1115',
          background: 'rgba(255,209,102,0.95)',
          bold: true,
          size: 0.026,
        });
        label.position.set(mid.x, object.elevation + 0.22, mid.z);
        this.dimensionGroup.add(label);
      }
      return;
    }

    // Non-shaped objects: label the overall size from the scene bounds.
    const box = this.viewer.boundsOf([object.id]);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const text = `${formatShort(size.x)} × ${formatShort(size.z)} × ${formatShort(size.y)} h`;
    const label = makeLabel(text, {
      color: '#0f1115',
      background: 'rgba(255,209,102,0.95)',
      bold: true,
      size: 0.026,
    });
    label.position.set(centre.x, box.max.y + 0.25, centre.z);
    this.dimensionGroup.add(label);
  }

  /* ---------------------------------------------------------------- input */

  private bindPointer() {
    const element = this.viewer.renderer.domElement;
    let downAt: { x: number; y: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (this.controls.dragging) return;
      downAt = { x: event.clientX, y: event.clientY };

      if (this.tool.kind === 'select') {
        // A handle under the cursor takes priority over picking an object.
        const hit = this.viewer.pickObjects(event, this.handleGroup.children)[0];
        if (hit) {
          const handle = hit.object as THREE.Mesh;
          if (typeof handle.userData.insertAfter === 'number') {
            this.insertVertex(handle.userData.insertAfter as number);
            downAt = null;
            return;
          }
          const object = this.store.primary;
          if (object) {
            this.draggingVertex = {
              index: handle.userData.handleIndex as number,
              objectId: object.id,
            };
            this.viewer.rig.orbit.enabled = false;
            element.setPointerCapture(event.pointerId);
          }
          return;
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (this.draggingVertex) {
        this.dragVertex(event);
        return;
      }
      if (this.tool.kind === 'draw' && this.draft.length > 0) {
        const point = this.viewer.groundPoint(event, this.draftElevation());
        if (point) {
          this.draftCursor = snapPoint(point, this.snap);
          this.renderDraft();
        }
        return;
      }
      // Highlight the handle under the pointer so it is obvious it can be grabbed.
      if (this.tool.kind === 'select' && this.handleGroup.children.length) {
        const hit = this.viewer.pickObjects(event, this.handleGroup.children)[0];
        const handle = (hit?.object as THREE.Mesh) ?? null;
        if (handle !== this.hoveredHandle) {
          if (this.hoveredHandle) {
            (this.hoveredHandle.material as THREE.MeshBasicMaterial).color.set(
              typeof this.hoveredHandle.userData.insertAfter === 'number'
                ? INSERT_COLOR
                : HANDLE_COLOR,
            );
          }
          if (handle) (handle.material as THREE.MeshBasicMaterial).color.set(HANDLE_HOVER);
          this.hoveredHandle = handle;
          element.style.cursor = handle ? 'grab' : '';
        }
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (this.draggingVertex) {
        this.draggingVertex = null;
        this.store.commit();
        this.viewer.rig.orbit.enabled = this.viewer.rig.mode === 'orbit';
        if (element.hasPointerCapture(event.pointerId)) {
          element.releasePointerCapture(event.pointerId);
        }
        return;
      }
      if (!downAt || event.button !== 0) return;
      // Treat it as a click only if the pointer barely moved — otherwise the
      // user was orbiting the camera, not selecting.
      const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
      downAt = null;
      if (moved > 4) return;
      this.handleClick(event);
    };

    const onDoubleClick = () => {
      if (this.tool.kind === 'draw') this.finishDraft();
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    element.addEventListener('dblclick', onDoubleClick);

    this.disposers.push(() => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('dblclick', onDoubleClick);
    });
  }

  private handleClick(event: PointerEvent) {
    switch (this.tool.kind) {
      case 'select': {
        const hit = this.viewer.pick(event);
        if (!hit.objectId) {
          if (!event.shiftKey) this.store.select([]);
          return;
        }
        if (event.shiftKey) this.store.toggleSelect(hit.objectId);
        else this.store.select([hit.objectId]);
        return;
      }
      case 'place': {
        const point = this.viewer.groundPoint(event, 0);
        if (!point) return;
        const snapped = snapPoint(point, this.snap);
        const object = this.tool.make(snapped);
        // Dropping onto a raised bed should sit on top of it, not sink in.
        object.elevation = this.elevationAt(snapped);
        this.store.add(object);
        this.setTool({ kind: 'select' });
        this.events.onToolFinished?.();
        return;
      }
      case 'measure':
      case 'draw': {
        const point = this.viewer.groundPoint(event, this.draftElevation());
        if (!point) return;
        this.draft.push(snapPoint(point, this.snap));
        if (this.tool.kind === 'measure' && this.draft.length === 2) {
          this.finishDraft();
          return;
        }
        this.renderDraft();
        return;
      }
    }
  }

  private dragVertex(event: PointerEvent) {
    if (!this.draggingVertex) return;
    const object = this.store.find(this.draggingVertex.objectId);
    if (!object) return;
    const point = this.viewer.groundPoint(event, object.elevation);
    if (!point) return;

    const index = this.draggingVertex.index;
    const local = snapPoint(toLocal(point, object.position, object.rotation), this.snap);

    this.store.updateLive((doc) => {
      const target = doc.objects.find((o) => o.id === object.id);
      if (!target) return;
      const points = shapePoints(target);
      if (!points || index >= points.length) return;
      points[index] = local;
    });

    const world = this.toWorld(object, local);
    const handle = this.vertexHandles[index];
    if (handle) handle.position.set(world.x, object.elevation + 0.02, world.z);
    this.rebuildDimensions();
  }

  private insertVertex(edgeIndex: number) {
    const object = this.store.primary;
    if (!object) return;
    this.store.patch(object.id, (target) => {
      const points = shapePoints(target);
      if (!points) return;
      const a = points[edgeIndex];
      const b = points[(edgeIndex + 1) % points.length];
      points.splice(edgeIndex + 1, 0, lerp2(a, b, 0.5));
    });
    this.refresh();
  }

  /**
   * Removes the vertex currently under the pointer, if any.
   *
   * Returns true when it consumed the gesture, so the caller can fall back to
   * deleting the whole object when no handle was hovered.
   */
  deleteHoveredVertex(): boolean {
    const handle = this.hoveredHandle;
    if (!handle || typeof handle.userData.handleIndex !== 'number') return false;
    const object = this.store.primary;
    if (!object || object.locked) return false;
    const points = shapePoints(object);
    if (!points) return false;

    // A polygon needs three corners and a line needs two; below that the
    // object would have no shape left to edit.
    const minimum = isClosedShape(object) ? 3 : 2;
    if (points.length <= minimum) {
      this.events.onStatus?.(`Een ${isClosedShape(object) ? 'vlak' : 'lijn'} heeft minstens ${minimum} punten nodig`);
      return true;
    }

    const index = handle.userData.handleIndex as number;
    this.store.patch(object.id, (target) => {
      shapePoints(target)?.splice(index, 1);
    });
    this.hoveredHandle = null;
    this.refresh();
    return true;
  }

  /* ------------------------------------------------------------ draw tool */

  private draftElevation(): number {
    return 0;
  }

  /** Ground height at a point, so placed objects land on raised beds. */
  private elevationAt(point: Vec2): number {
    let best = 0;
    for (const object of this.store.doc.objects) {
      if (object.type !== 'surface' || object.raise <= 0) continue;
      const local = toLocal(point, object.position, object.rotation);
      if (!pointInPolygon(local, object.points)) continue;
      best = Math.max(best, object.elevation + object.raise);
    }
    return best;
  }

  private renderDraft() {
    clearGroup(this.draftGroup);
    const points = [...this.draft];
    if (this.draftCursor) points.push(this.draftCursor);
    if (points.length === 0) return;

    const closed = this.tool.kind === 'draw' && this.tool.draw === 'surface' && points.length > 2;
    const vertices = points.map((p) => new THREE.Vector3(p.x, 0.05, p.z));
    if (closed) vertices.push(vertices[0].clone());

    this.draftGroup.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(vertices),
        new THREE.LineBasicMaterial({ color: INSERT_COLOR, depthTest: false }),
      ),
    );

    for (const point of points) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 10, 8),
        new THREE.MeshBasicMaterial({ color: INSERT_COLOR, depthTest: false }),
      );
      dot.position.set(point.x, 0.05, point.z);
      dot.renderOrder = 901;
      this.draftGroup.add(dot);
    }

    // Live segment lengths — the number you actually need while drawing.
    const segments = closed ? points.length : points.length - 1;
    for (let i = 0; i < segments; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const length = distance(a, b);
      if (length < 0.05) continue;
      const mid = lerp2(a, b, 0.5);
      const label = makeLabel(formatShort(length), {
        color: '#06231a',
        background: 'rgba(111,211,168,0.95)',
        bold: true,
        size: 0.026,
      });
      label.position.set(mid.x, 0.28, mid.z);
      this.draftGroup.add(label);
    }
  }

  /** Ends the current draw, turning the collected points into an object. */
  finishDraft() {
    if (this.tool.kind === 'measure') {
      if (this.draft.length === 2) {
        const origin = this.draft[0];
        this.store.add({
          id: uid(),
          type: 'measure',
          name: 'Maat',
          position: origin,
          rotation: 0,
          elevation: 0,
          locked: false,
          hidden: false,
          path: [{ x: 0, z: 0 }, sub(this.draft[1], origin)],
          onPlan: true,
        });
      }
      this.cancelDraft();
      this.setTool({ kind: 'select' });
      this.events.onToolFinished?.();
      return;
    }

    if (this.tool.kind !== 'draw') return;
    const kind = this.tool.draw;
    const minimum = kind === 'surface' ? 3 : 2;
    if (this.draft.length < minimum) {
      this.events.onStatus?.(`Nog minstens ${minimum - this.draft.length} punt(en) nodig`);
      return;
    }

    const origin = centroid(this.draft);
    const local = this.draft.map((p) => sub(p, origin));
    const object = this.makeDrawnObject(kind, origin, local);
    this.cancelDraft();
    this.setTool({ kind: 'select' });
    if (object) this.store.add(object);
    this.events.onToolFinished?.();
  }

  cancelDraft() {
    this.draft = [];
    this.draftCursor = null;
    clearGroup(this.draftGroup);
  }

  get drafting(): boolean {
    return this.draft.length > 0;
  }

  /** Hook set by the UI so a drawn object inherits the chosen presets. */
  drawDefaults: Partial<Record<DrawKind, (origin: Vec2, points: Vec2[]) => GardenObject>> = {};

  private makeDrawnObject(kind: DrawKind, origin: Vec2, points: Vec2[]): GardenObject | null {
    const factory = this.drawDefaults[kind];
    return factory ? factory(origin, points) : null;
  }

  dispose() {
    for (const dispose of this.disposers) dispose();
    this.controls.detach();
    this.controls.disconnect();
    this.controls.dispose();
  }
}

/* -------------------------------------------------------------------------- */

/** Applies a gizmo scale to whichever fields that object type calls "size". */
function applyScale(target: GardenObject, baseline: GardenObject, scale: THREE.Vector3) {
  const sx = Math.max(0.02, scale.x);
  const sy = Math.max(0.02, scale.y);
  const sz = Math.max(0.02, scale.z);

  switch (target.type) {
    case 'surface': {
      const base = baseline as typeof target;
      target.points = base.points.map((p) => ({ x: p.x * sx, z: p.z * sz }));
      target.raise = base.raise * sy;
      return;
    }
    case 'wall':
    case 'fence':
    case 'path':
    case 'measure': {
      const base = baseline as typeof target;
      target.path = base.path.map((p) => ({ x: p.x * sx, z: p.z * sz }));
      if (target.type === 'fence') target.height = (baseline as typeof target).height * sy;
      if (target.type === 'path') target.width = (baseline as typeof target).width * Math.max(sx, sz);
      return;
    }
    case 'structure': {
      const base = baseline as typeof target;
      target.width = base.width * sx;
      target.depth = base.depth * sz;
      target.height = base.height * sy;
      return;
    }
    case 'furniture': {
      const base = baseline as typeof target;
      target.width = base.width * sx;
      target.depth = base.depth * sz;
      target.height = base.height * sy;
      return;
    }
    case 'plant': {
      const base = baseline as typeof target;
      target.height = base.height * sy;
      target.spread = base.spread * Math.max(sx, sz);
      return;
    }
    case 'person': {
      target.height = (baseline as typeof target).height * sy;
      return;
    }
    case 'tile': {
      const base = baseline as typeof target;
      target.tile = { ...base.tile, width: base.tile.width * sx, depth: base.tile.depth * sz };
      return;
    }
    case 'light': {
      target.height = (baseline as typeof target).height * sy;
      return;
    }
  }
}

function clearGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((node) => {
      const asMesh = node as THREE.Mesh;
      asMesh.geometry?.dispose();
    });
  }
}
