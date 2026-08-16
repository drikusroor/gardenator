/**
 * Three ways to look at the garden.
 *
 * - orbit: drag to swing round a focus point on the ground, right-drag to pan.
 * - fly:   WASD/QE with right-button mouse-look, for getting anywhere fast.
 * - walk:  eye height locked to the reference person, so what you see through
 *          the camera is what you would see standing there.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type CameraMode = 'orbit' | 'fly' | 'walk';

const MOVE_SPEED = 4.5;
const SPRINT_MULTIPLIER = 3;
const LOOK_SENSITIVITY = 0.0022;
/** Stops the pitch reaching straight up/down, which would flip the view. */
const MAX_PITCH = Math.PI / 2 - 0.02;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitControls;

  mode: CameraMode = 'orbit';
  /** Eye height used in walk mode. */
  eyeHeight = 1.85;
  /** Ground level under the walker, updated by the viewer each frame. */
  groundHeight = 0;

  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private looking = false;
  private velocity = new THREE.Vector3();
  private disposers: (() => void)[] = [];

  constructor(
    private element: HTMLElement,
    aspect: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.05, 800);
    this.camera.position.set(0, 12, 16);

    this.orbit = new OrbitControls(this.camera, element);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    // Panning along the ground rather than the screen plane is what makes
    // "drag the ground to move" feel right.
    this.orbit.screenSpacePanning = false;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbit.minDistance = 0.8;
    this.orbit.maxDistance = 160;
    this.orbit.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.orbit.target.set(0, 0, 0);
    this.orbit.update();

    this.bind();
  }

  private bind() {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      this.keys.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => this.keys.delete(event.code);
    const onBlur = () => this.keys.clear();

    const onPointerDown = (event: PointerEvent) => {
      if (this.mode === 'orbit') return;
      // Right button (or any button in walk mode) starts a free look.
      if (event.button === 2 || this.mode === 'walk') {
        this.looking = true;
        this.element.setPointerCapture(event.pointerId);
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!this.looking || this.mode === 'orbit') return;
      this.yaw -= event.movementX * LOOK_SENSITIVITY;
      this.pitch -= event.movementY * LOOK_SENSITIVITY;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
      this.applyLook();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!this.looking) return;
      this.looking = false;
      if (this.element.hasPointerCapture(event.pointerId)) {
        this.element.releasePointerCapture(event.pointerId);
      }
    };
    const onContextMenu = (event: MouseEvent) => {
      // Right-drag is a look/pan gesture here, so suppress the browser menu.
      event.preventDefault();
    };
    const onWheel = (event: WheelEvent) => {
      if (this.mode === 'orbit') return;
      // In the free modes the wheel adjusts walking speed rather than zoom.
      event.preventDefault();
      this.speedScale = Math.max(0.15, Math.min(6, this.speedScale * (event.deltaY > 0 ? 0.9 : 1.1)));
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.element.addEventListener('pointerdown', onPointerDown);
    this.element.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    this.element.addEventListener('contextmenu', onContextMenu);
    this.element.addEventListener('wheel', onWheel, { passive: false });

    this.disposers.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      this.element.removeEventListener('pointerdown', onPointerDown);
      this.element.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      this.element.removeEventListener('contextmenu', onContextMenu);
      this.element.removeEventListener('wheel', onWheel);
    });
  }

  private speedScale = 1;

  setMode(mode: CameraMode) {
    if (mode === this.mode) return;
    const previous = this.mode;
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';

    if (mode === 'orbit') {
      // Re-anchor the orbit target in front of wherever the free camera ended
      // up, so switching back does not teleport the view.
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const target = this.camera.position
        .clone()
        .add(forward.multiplyScalar(Math.max(3, this.camera.position.y * 1.6)));
      target.y = 0;
      this.orbit.target.copy(target);
      this.orbit.update();
      return;
    }

    // Entering a free mode: adopt the current heading so the view is stable.
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.yaw = Math.atan2(-direction.x, -direction.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, direction.y)));

    if (mode === 'walk') {
      // Drop to standing height wherever the camera currently is.
      if (previous === 'orbit') {
        const target = this.orbit.target.clone();
        const back = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        this.camera.position.copy(target.add(back.multiplyScalar(2.5)));
      }
      this.camera.position.y = this.groundHeight + this.eyeHeight;
      this.pitch = Math.max(-0.6, Math.min(0.4, this.pitch));
    }
    this.applyLook();
  }

  private applyLook() {
    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'),
    );
    this.camera.quaternion.copy(quaternion);
  }

  /** Advances the controller. `delta` is in seconds. */
  update(delta: number) {
    if (this.mode === 'orbit') {
      this.orbit.update();
      return;
    }

    const speed =
      MOVE_SPEED *
      this.speedScale *
      (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? SPRINT_MULTIPLIER : 1) *
      (this.mode === 'walk' ? 0.32 : 1);

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const wish = new THREE.Vector3();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) wish.add(forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) wish.sub(forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) wish.add(right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) wish.sub(right);

    if (this.mode === 'fly') {
      // In fly mode W follows the look direction, including its pitch.
      if (wish.lengthSq() > 0 && (this.keys.has('KeyW') || this.keys.has('KeyS'))) {
        wish.y += Math.sin(this.pitch) * (this.keys.has('KeyS') ? -1 : 1);
      }
      if (this.keys.has('KeyQ') || this.keys.has('Space')) wish.y += 1;
      if (this.keys.has('KeyZ') || this.keys.has('ControlLeft')) wish.y -= 1;
    }

    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    // Critically damped approach to the wished-for velocity: no jerk on key
    // press, no drift after release.
    this.velocity.lerp(wish, Math.min(1, delta * 12));
    this.camera.position.addScaledVector(this.velocity, delta);

    if (this.mode === 'walk') {
      this.camera.position.y = this.groundHeight + this.eyeHeight;
    } else {
      this.camera.position.y = Math.max(0.15, this.camera.position.y);
    }
  }

  /** Frames a box, used by "zoom to selection" and by the initial view. */
  frame(box: THREE.Box3, padding = 1.4) {
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 * padding + 1;
    const distance = radius / Math.sin((this.camera.fov * Math.PI) / 360);

    if (this.mode === 'orbit') {
      const direction = this.camera.position.clone().sub(this.orbit.target);
      if (direction.lengthSq() < 1e-6) direction.set(0.6, 0.7, 1);
      direction.normalize().multiplyScalar(distance);
      this.orbit.target.copy(centre);
      this.camera.position.copy(centre).add(direction);
      this.orbit.update();
    } else {
      const back = new THREE.Vector3(Math.sin(this.yaw), 0.45, Math.cos(this.yaw)).normalize();
      this.camera.position.copy(centre).addScaledVector(back, distance);
      this.camera.lookAt(centre);
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);
      this.yaw = Math.atan2(-direction.x, -direction.z);
      this.pitch = Math.asin(Math.max(-1, Math.min(1, direction.y)));
    }
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Preset viewpoints offered in the toolbar. */
  setPreset(preset: 'top' | 'iso' | 'house' | 'back', width: number, depth: number) {
    const span = Math.max(width, depth);
    this.setMode('orbit');
    this.orbit.target.set(0, 0, 0);
    switch (preset) {
      case 'top':
        this.camera.position.set(0, span * 1.5, 0.01);
        break;
      case 'iso':
        // Deliberately shallow: a steeper angle fills the frame with ground
        // and hides the horizon, which makes the garden hard to read.
        this.camera.position.set(span * 0.62, span * 0.42, span * 0.82);
        this.orbit.target.set(0, 0.8, 0);
        break;
      case 'house':
        this.camera.position.set(0, 3.2, -depth / 2 - 3);
        this.orbit.target.set(0, 0.6, depth * 0.15);
        break;
      case 'back':
        this.camera.position.set(0, 3.2, depth / 2 + 3);
        this.orbit.target.set(0, 0.6, -depth * 0.15);
        break;
    }
    this.orbit.update();
  }

  dispose() {
    for (const dispose of this.disposers) dispose();
    this.orbit.dispose();
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
