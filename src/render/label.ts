/**
 * Text labels in the 3D view.
 *
 * Rendered to a canvas and shown as a camera-facing sprite scaled in world
 * units, so a dimension caption keeps a constant apparent size as you zoom —
 * the behaviour you want from an annotation, not from a billboard.
 */

import * as THREE from 'three';

export interface LabelStyle {
  color?: string;
  background?: string;
  /** Cap height in metres at a viewing distance of one metre. */
  size?: number;
  bold?: boolean;
}

const cache = new Map<string, THREE.SpriteMaterial>();

function materialFor(text: string, style: Required<LabelStyle>): THREE.SpriteMaterial {
  const key = `${text}|${style.color}|${style.background}|${style.bold}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const fontSize = 48;
  const padding = 14;
  const font = `${style.bold ? '700 ' : '600 '}${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;

  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('2D canvas context unavailable');
  measure.font = font;
  const width = Math.ceil(measure.measureText(text).width) + padding * 2;
  const height = fontSize + padding * 2;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  if (style.background !== 'none') {
    ctx.fillStyle = style.background;
    roundRect(ctx, 0, 0, width, height, 10);
    ctx.fill();
  }
  ctx.font = font;
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
  });
  material.userData.aspect = width / height;
  cache.set(key, material);
  return material;
}

/**
 * Builds a text sprite. `sizeAttenuation` is off, so `size` is a fraction of
 * the viewport height rather than a world length.
 */
export function makeLabel(text: string, style: LabelStyle = {}): THREE.Sprite {
  const resolved: Required<LabelStyle> = {
    color: style.color ?? '#f2f2f0',
    background: style.background ?? 'rgba(20,22,26,0.82)',
    size: style.size ?? 0.032,
    bold: style.bold ?? false,
  };
  const material = materialFor(text, resolved);
  const sprite = new THREE.Sprite(material);
  const aspect = (material.userData.aspect as number) ?? 3;
  sprite.scale.set(resolved.size * aspect, resolved.size, 1);
  // Annotations must sit on top of the scene, never inside a wall.
  sprite.renderOrder = 999;
  return sprite;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
