/** Non-pickable scene furniture: ground, grid, site outline, compass, sun path. */

import * as THREE from 'three';
import type { Store } from '../core/store';
import type { SiteSettings } from '../core/types';
import { formatShort } from '../core/units';
import { makeLabel } from './label';
import { solarPosition, type SunState } from './sky';

export class Overlays {
  private root = new THREE.Group();
  private ground: THREE.Mesh;
  private grid: THREE.GridHelper | null = null;
  private outline = new THREE.Group();
  private compass = new THREE.Group();
  private sunPath = new THREE.Group();
  private sunMarker: THREE.Mesh;
  private signature = '';

  constructor(
    scene: THREE.Scene,
    private store: Store,
  ) {
    this.root.name = 'overlays';
    scene.add(this.root);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: '#6f7a52', roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.004;
    this.ground.receiveShadow = true;
    this.root.add(this.ground);

    this.root.add(this.outline);
    this.root.add(this.compass);
    this.root.add(this.sunPath);

    this.sunMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 12, 10),
      new THREE.MeshBasicMaterial({ color: '#ffd166' }),
    );
    this.sunPath.add(this.sunMarker);
  }

  /** Rebuilds when the site or view settings change; cheap when they have not. */
  sync(sun: SunState) {
    const { site, view } = this.store.doc;
    const signature = [
      site.width,
      site.depth,
      site.northOffset,
      site.latitude,
      site.groundColor,
      view.showGrid,
      view.snap,
      view.unit,
      this.store.doc.environment.dayOfYear,
    ].join('|');

    if (signature !== this.signature) {
      this.signature = signature;
      this.rebuild(site);
    }
    this.updateSunPath(sun);
  }

  private rebuild(site: SiteSettings) {
    const view = this.store.doc.view;

    // Ground extends well past the plot so the horizon does not float.
    this.ground.geometry.dispose();
    this.ground.geometry = new THREE.PlaneGeometry(site.width + 400, site.depth + 400);
    (this.ground.material as THREE.MeshStandardMaterial).color.set(site.groundColor);

    if (this.grid) {
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
      this.root.remove(this.grid);
      this.grid = null;
    }
    if (view.showGrid) {
      // One grid line per metre, with a heavier line every five.
      const span = Math.ceil(Math.max(site.width, site.depth)) + 4;
      this.grid = new THREE.GridHelper(span, span, '#8d9ba6', '#5d6a72');
      const material = this.grid.material as THREE.Material;
      material.transparent = true;
      material.opacity = 0.28;
      material.depthWrite = false;
      this.grid.position.y = 0.002;
      this.root.add(this.grid);
    }

    clear(this.outline);
    const w = site.width / 2;
    const d = site.depth / 2;
    const corners = [
      new THREE.Vector3(-w, 0.01, -d),
      new THREE.Vector3(w, 0.01, -d),
      new THREE.Vector3(w, 0.01, d),
      new THREE.Vector3(-w, 0.01, d),
      new THREE.Vector3(-w, 0.01, -d),
    ];
    this.outline.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(corners),
        new THREE.LineDashedMaterial({
          color: '#f2f2f0',
          dashSize: 0.4,
          gapSize: 0.25,
          transparent: true,
          opacity: 0.6,
        }),
      ),
    );
    (this.outline.children[0] as THREE.Line).computeLineDistances();

    // Plot dimensions along two edges.
    const widthLabel = makeLabel(formatShort(site.width), { color: '#dfe6ec' });
    widthLabel.position.set(0, 0.35, -d - 0.5);
    this.outline.add(widthLabel);
    const depthLabel = makeLabel(formatShort(site.depth), { color: '#dfe6ec' });
    depthLabel.position.set(-w - 0.5, 0.35, 0);
    this.outline.add(depthLabel);

    this.rebuildCompass(site);
  }

  /** North arrow at the corner of the plot, rotated by the site's bearing. */
  private rebuildCompass(site: SiteSettings) {
    clear(this.compass);
    const x = site.width / 2 + 1.6;
    const z = -site.depth / 2 - 1.6;

    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.8, 4),
      new THREE.MeshBasicMaterial({ color: '#e05c4a' }),
    );
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0.05, -0.4);
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.02, 0.9),
      new THREE.MeshBasicMaterial({ color: '#dfe6ec' }),
    );
    tail.position.set(0, 0.05, 0.35);

    const needle = new THREE.Group();
    needle.add(arrow, tail);
    // -Z points along the site's north offset, so the needle rotates back.
    needle.rotation.y = (site.northOffset * Math.PI) / 180;

    const label = makeLabel('N', { color: '#e05c4a', bold: true, size: 0.028 });
    label.position.set(0, 0.7, 0);

    this.compass.add(needle, label);
    this.compass.position.set(x, 0, z);
  }

  /** Draws the arc the sun travels today, with a marker at the current time. */
  updateSunPath(sun: SunState) {
    const { site, environment, view } = this.store.doc;
    if (!view.showGrid) {
      this.sunPath.visible = false;
      return;
    }
    this.sunPath.visible = true;

    const radius = Math.max(site.width, site.depth) * 0.85 + 8;

    // Rebuild the arc only when the day or the orientation changes.
    const key = `${environment.dayOfYear}|${site.latitude}|${site.northOffset}|${radius}`;
    if (this.sunPath.userData.key !== key) {
      this.sunPath.userData.key = key;
      for (const child of [...this.sunPath.children]) {
        if (child === this.sunMarker) continue;
        this.sunPath.remove(child);
        disposeNode(child);
      }
      const points: THREE.Vector3[] = [];
      for (let minutes = 0; minutes <= 1440; minutes += 10) {
        const position = solarPosition(environment.dayOfYear, minutes, site.latitude);
        if (position.elevation < 0) continue;
        points.push(toScene(position.azimuth, position.elevation, site.northOffset, radius));
      }
      if (points.length > 1) {
        this.sunPath.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({
              color: '#ffd166',
              transparent: true,
              opacity: 0.45,
            }),
          ),
        );
      }
    }

    this.sunMarker.visible = sun.elevation > 0;
    this.sunMarker.position.copy(sun.direction).multiplyScalar(radius);
    this.sunMarker.scale.setScalar(Math.max(0.6, radius / 40));
  }

  dispose() {
    disposeNode(this.root);
    this.root.removeFromParent();
  }
}

function toScene(
  azimuthDeg: number,
  elevationDeg: number,
  northOffset: number,
  radius: number,
): THREE.Vector3 {
  const theta = ((azimuthDeg - northOffset) * Math.PI) / 180;
  const phi = (elevationDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.sin(theta) * Math.cos(phi),
    Math.sin(phi),
    -Math.cos(theta) * Math.cos(phi),
  ).multiplyScalar(radius);
}

function clear(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeNode(child);
  }
}

function disposeNode(node: THREE.Object3D) {
  node.traverse((child) => {
    const asMesh = child as THREE.Mesh;
    asMesh.geometry?.dispose();
  });
}
