/** Fences and screens along a polyline. */

import * as THREE from 'three';
import { distance, normalize, sub } from '../../core/geometry';
import type { FenceObject } from '../../core/types';
import { faceMaterial, plainMaterial } from '../materials';
import { UNIT_BOX, boxMatrix, instanced } from './common';
import type { BuildContext } from './context';

export function buildFence(object: FenceObject, _ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  if (object.path.length < 2) return group;

  const posts: THREE.Matrix4[] = [];
  const boards: THREE.Matrix4[] = [];
  const height = Math.max(0.1, object.height);
  const postSize = Math.max(0.02, object.postSize);

  for (let i = 0; i < object.path.length - 1; i++) {
    const a = object.path[i];
    const b = object.path[i + 1];
    const span = distance(a, b);
    if (span < 1e-4) continue;
    const dir = normalize(sub(b, a));
    const angle = Math.atan2(dir.x, dir.z);

    // Posts at both ends of the run, then evenly spaced in between so the
    // bays all come out the same width instead of leaving a stub at the end.
    const bays = Math.max(1, Math.round(span / Math.max(0.3, object.postSpacing)));
    const bayWidth = span / bays;
    const first = i === 0;
    for (let p = first ? 0 : 1; p <= bays; p++) {
      const t = p * bayWidth;
      posts.push(
        boxMatrix(
          a.x + dir.x * t,
          0,
          a.z + dir.z * t,
          postSize,
          height + 0.06,
          postSize,
          angle,
        ),
      );
    }

    for (let bay = 0; bay < bays; bay++) {
      const start = bay * bayWidth + postSize / 2;
      const width = bayWidth - postSize;
      if (width <= 0.01) continue;
      const cx = a.x + dir.x * (start + width / 2);
      const cz = a.z + dir.z * (start + width / 2);
      addBay(boards, object, cx, cz, width, height, angle, dir);
    }
  }

  const postMesh = instanced(UNIT_BOX, faceMaterial('wood', object.postColor), posts);
  if (postMesh) group.add(postMesh);

  const boardMaterial =
    object.style === 'wire' ? plainMaterial('#6b6f6a', 0.6, 0.4) : faceMaterial('wood', object.color);
  const boardMesh = instanced(UNIT_BOX, boardMaterial, boards);
  if (boardMesh) group.add(boardMesh);

  return group;
}

function addBay(
  out: THREE.Matrix4[],
  object: FenceObject,
  cx: number,
  cz: number,
  width: number,
  height: number,
  angle: number,
  dir: { x: number; z: number },
) {
  const thickness = 0.018;
  switch (object.style) {
    case 'panel':
      out.push(boxMatrix(cx, 0.05, cz, width, height - 0.05, thickness * 2, angle));
      break;

    case 'slat': {
      // Horizontal slats with a gap, the standard Dutch schutting look.
      const slatHeight = 0.14;
      const gap = 0.02;
      const pitch = slatHeight + gap;
      const count = Math.max(1, Math.floor((height - 0.04) / pitch));
      for (let i = 0; i < count; i++) {
        out.push(boxMatrix(cx, 0.04 + i * pitch, cz, width, slatHeight, thickness * 1.6, angle));
      }
      break;
    }

    case 'picket': {
      // Vertical pickets between two rails.
      const picketWidth = 0.09;
      const gap = 0.05;
      const pitch = picketWidth + gap;
      const count = Math.max(1, Math.floor(width / pitch));
      const used = count * pitch - gap;
      const start = -used / 2 + picketWidth / 2;
      for (let i = 0; i < count; i++) {
        const offset = start + i * pitch;
        out.push(
          boxMatrix(
            cx + dir.x * offset,
            0.06,
            cz + dir.z * offset,
            picketWidth,
            height - 0.06,
            thickness * 1.6,
            angle,
          ),
        );
      }
      out.push(boxMatrix(cx, height * 0.28, cz, width, 0.06, thickness, angle));
      out.push(boxMatrix(cx, height * 0.78, cz, width, 0.06, thickness, angle));
      break;
    }

    case 'trellis': {
      // A diagonal lattice, approximated with a coarse grid of thin bars.
      const pitch = 0.18;
      const cols = Math.max(1, Math.floor(width / pitch));
      const rows = Math.max(1, Math.floor(height / pitch));
      for (let c = 0; c <= cols; c++) {
        const offset = -width / 2 + (c * width) / cols;
        out.push(
          boxMatrix(
            cx + dir.x * offset,
            0,
            cz + dir.z * offset,
            0.022,
            height,
            thickness,
            angle,
          ),
        );
      }
      for (let r = 0; r <= rows; r++) {
        out.push(boxMatrix(cx, (r * height) / rows, cz, width, 0.022, thickness * 0.8, angle));
      }
      break;
    }

    case 'wire': {
      const strands = Math.max(2, Math.round(height / 0.25));
      for (let s = 1; s <= strands; s++) {
        out.push(boxMatrix(cx, (s * height) / strands, cz, width, 0.008, 0.008, angle));
      }
      break;
    }
  }
}
