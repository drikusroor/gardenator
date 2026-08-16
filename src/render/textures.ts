/**
 * Procedurally painted textures.
 *
 * Everything is drawn on a canvas at load time rather than shipped as image
 * files: the whole app stays a single static bundle with no asset requests,
 * which is what makes the GitHub Pages deploy trivial, and colours become
 * parameters the user can change instead of baked-in pixels.
 */

import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

function cached(key: string, paint: () => THREE.Texture): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const texture = paint();
  cache.set(key, texture);
  return texture;
}

function canvas(size: number): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const el = document.createElement('canvas');
  el.width = size;
  el.height = size;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { el, ctx };
}

function toTexture(el: HTMLCanvasElement, repeatWrap = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(el);
  if (repeatWrap) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Deterministic value noise so a texture looks the same on every reload. */
function rng(seed: number): () => number {
  let state = seed | 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000000) / 1000000;
  };
}

function shade(hex: string, amount: number): string {
  const color = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  color.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)));
  return `#${color.getHexString()}`;
}

/** Sprinkles soft speckles; the workhorse behind most natural surfaces. */
function speckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  count: number,
  seed: number,
  paint: (random: () => number) => { color: string; radius: number },
) {
  const random = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = random() * size;
    const y = random() * size;
    const { color, radius } = paint(random);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    // Repeat near the edges so the tile wraps seamlessly.
    if (x < radius || x > size - radius || y < radius || y > size - radius) {
      ctx.beginPath();
      ctx.arc(x - size * Math.sign(x - size / 2), y, radius, 0, Math.PI * 2);
      ctx.arc(x, y - size * Math.sign(y - size / 2), radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Ground surfaces                                                            */
/* -------------------------------------------------------------------------- */

export type GroundTextureKind = 'grass' | 'dirt' | 'mulch' | 'gravel' | 'concrete' | 'water';

/** One square metre of ground, tileable. */
export function groundTexture(kind: GroundTextureKind, color: string): THREE.Texture {
  return cached(`ground:${kind}:${color}`, () => {
    const size = 256;
    const { el, ctx } = canvas(size);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);

    switch (kind) {
      case 'grass':
        // Broad mottling first, then fine blades, so it reads as turf at any zoom.
        speckle(ctx, size, 260, 11, (r) => ({
          color: shade(color, (r() - 0.5) * 0.16),
          radius: 6 + r() * 16,
        }));
        speckle(ctx, size, 1800, 37, (r) => ({
          color: shade(color, (r() - 0.4) * 0.3),
          radius: 0.7 + r() * 1.6,
        }));
        break;
      case 'dirt':
        speckle(ctx, size, 300, 5, (r) => ({
          color: shade(color, (r() - 0.5) * 0.14),
          radius: 5 + r() * 18,
        }));
        speckle(ctx, size, 1400, 19, (r) => ({
          color: shade(color, (r() - 0.5) * 0.35),
          radius: 0.8 + r() * 2.4,
        }));
        break;
      case 'mulch':
        // Short dashes read as bark chips.
        {
          const random = rng(23);
          for (let i = 0; i < 700; i++) {
            const x = random() * size;
            const y = random() * size;
            const a = random() * Math.PI;
            const len = 4 + random() * 12;
            ctx.strokeStyle = shade(color, (random() - 0.45) * 0.35);
            ctx.lineWidth = 2 + random() * 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
            ctx.stroke();
          }
        }
        break;
      case 'gravel':
        speckle(ctx, size, 2600, 71, (r) => ({
          color: shade(color, (r() - 0.5) * 0.4),
          radius: 1.5 + r() * 3.5,
        }));
        break;
      case 'concrete':
        speckle(ctx, size, 900, 91, (r) => ({
          color: shade(color, (r() - 0.5) * 0.08),
          radius: 2 + r() * 10,
        }));
        break;
      case 'water':
        {
          // Overlapping sine ripples; the shader adds the motion.
          const random = rng(13);
          ctx.globalAlpha = 0.25;
          for (let i = 0; i < 40; i++) {
            ctx.strokeStyle = shade(color, 0.18);
            ctx.lineWidth = 1 + random() * 2;
            ctx.beginPath();
            const y = random() * size;
            for (let x = 0; x <= size; x += 8) {
              const yy = y + Math.sin((x / size) * Math.PI * 4 + i) * 6;
              if (x === 0) ctx.moveTo(x, yy);
              else ctx.lineTo(x, yy);
            }
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        break;
    }
    return toTexture(el);
  });
}

/* -------------------------------------------------------------------------- */
/* Paving and masonry faces                                                   */
/* -------------------------------------------------------------------------- */

export type FaceTexture = 'smooth' | 'slate' | 'concrete' | 'clay' | 'wood' | 'rough' | 'brick' | 'split';

/** The top face of one paving unit or the visible face of one block. */
export function faceTexture(kind: FaceTexture, color: string): THREE.Texture {
  return cached(`face:${kind}:${color}`, () => {
    const size = 128;
    const { el, ctx } = canvas(size);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    const random = rng(hash(`${kind}${color}`));

    switch (kind) {
      case 'slate':
        // Cleft slate: long flaky streaks with darker mineral bands.
        for (let i = 0; i < 90; i++) {
          ctx.strokeStyle = shade(color, (random() - 0.5) * 0.22);
          ctx.lineWidth = 1 + random() * 6;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          const y = random() * size;
          ctx.moveTo(-10, y);
          ctx.bezierCurveTo(size * 0.3, y + (random() - 0.5) * 26, size * 0.7, y + (random() - 0.5) * 26, size + 10, y + (random() - 0.5) * 14);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      case 'concrete':
        speckle(ctx, size, 700, 3, (r) => ({
          color: shade(color, (r() - 0.5) * 0.12),
          radius: 1 + r() * 4,
        }));
        break;
      case 'clay':
        speckle(ctx, size, 500, 7, (r) => ({
          color: shade(color, (r() - 0.5) * 0.16),
          radius: 1 + r() * 5,
        }));
        break;
      case 'wood':
        // Grain runs along the length of the plank (the U axis).
        for (let i = 0; i < 46; i++) {
          ctx.strokeStyle = shade(color, (random() - 0.55) * 0.22);
          ctx.lineWidth = 0.7 + random() * 2.6;
          ctx.globalAlpha = 0.55;
          const y = random() * size;
          ctx.beginPath();
          ctx.moveTo(0, y);
          for (let x = 0; x <= size; x += 10) {
            ctx.lineTo(x, y + Math.sin(x * 0.06 + i) * 1.6);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // A couple of knots.
        for (let i = 0; i < 2; i++) {
          const x = random() * size;
          const y = random() * size;
          ctx.strokeStyle = shade(color, -0.16);
          ctx.lineWidth = 1.4;
          for (let r = 2; r < 9; r += 2) {
            ctx.beginPath();
            ctx.ellipse(x, y, r * 1.7, r, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        break;
      case 'rough':
        // Fine pitted aggregate — bumpy but not fractured.
        speckle(ctx, size, 260, 29, (r) => ({
          color: shade(color, (r() - 0.5) * 0.16),
          radius: 1.5 + r() * 4,
        }));
        break;
      case 'split': {
        // Split-face stapelblok: a handful of large angular facets, the way
        // a real broken-concrete face catches light in a few flat planes —
        // fine speckle alone reads as loose rubble, not a stacked block.
        const facets = 6 + Math.floor(random() * 3);
        for (let i = 0; i < facets; i++) {
          const cx = random() * size;
          const cy = random() * size;
          ctx.fillStyle = shade(color, (random() - 0.5) * 0.32);
          ctx.beginPath();
          const points = 5 + Math.floor(random() * 3);
          const r0 = size * (0.22 + random() * 0.18);
          for (let k = 0; k < points; k++) {
            const a = (k / points) * Math.PI * 2 + random() * 0.6;
            const r = r0 * (0.6 + random() * 0.6);
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
        }
        speckle(ctx, size, 140, 31, (r) => ({
          color: shade(color, (r() - 0.5) * 0.12),
          radius: 1 + r() * 2.4,
        }));
        break;
      }
      case 'brick':
        speckle(ctx, size, 900, 53, (r) => ({
          color: shade(color, (r() - 0.5) * 0.2),
          radius: 0.8 + r() * 3,
        }));
        break;
      case 'smooth':
        speckle(ctx, size, 200, 61, (r) => ({
          color: shade(color, (r() - 0.5) * 0.05),
          radius: 2 + r() * 8,
        }));
        break;
    }

    if (kind === 'split' || kind === 'rough') {
      // A dry-stacked stapelblok has no mortar joint, but each block still
      // reads as its own unit because of the shadow line at its edge — draw
      // that here so the wall doesn't dissolve into one continuous texture
      // when the joint width is 0.
      const bevel = size * 0.05;
      ctx.strokeStyle = shade(color, -0.24);
      ctx.lineWidth = bevel;
      ctx.strokeRect(bevel / 2, bevel / 2, size - bevel, size - bevel);
      ctx.strokeStyle = shade(color, 0.1);
      ctx.lineWidth = bevel * 0.3;
      ctx.beginPath();
      ctx.moveTo(bevel * 0.7, bevel * 0.7);
      ctx.lineTo(size - bevel * 0.7, bevel * 0.7);
      ctx.stroke();
    }

    return toTexture(el);
  });
}

/**
 * A tiling patch of laid masonry, for surfaces where individual block geometry
 * would be wasteful (the walls of a shed or a house).
 *
 * The patch covers a whole number of blocks in each direction and carries the
 * matching `repeat`, so geometry can keep writing UVs in plain metres.
 */
export function masonryTexture(
  blockLength: number,
  blockHeight: number,
  joint: number,
  bondOffset: number,
  color: string,
  jointColor: string,
  face: FaceTexture,
): THREE.Texture {
  const key = `masonry:${blockLength}:${blockHeight}:${joint}:${bondOffset}:${color}:${jointColor}:${face}`;
  return cached(key, () => {
    const pitchX = blockLength + joint;
    const pitchY = blockHeight + joint;
    // Two courses wide/high covers the bond, so the patch repeats cleanly.
    const cols = 2;
    const rows = 2;
    const moduleW = pitchX * cols;
    const moduleH = pitchY * rows;
    const pxPerMetre = 256;
    const w = Math.max(32, Math.round(moduleW * pxPerMetre));
    const h = Math.max(32, Math.round(moduleH * pxPerMetre));

    const el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    const ctx = el.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');

    ctx.fillStyle = jointColor;
    ctx.fillRect(0, 0, w, h);

    const random = rng(hash(key));
    const bw = (blockLength / moduleW) * w;
    const bh = (blockHeight / moduleH) * h;
    const jx = (joint / moduleW) * w;
    const jy = (joint / moduleH) * h;

    for (let row = -1; row <= rows; row++) {
      const shift = ((row % 2) + 2) % 2 === 1 ? bondOffset * (bw + jx) : 0;
      const y = h - (row + 1) * (bh + jy) + jy / 2;
      for (let col = -1; col <= cols + 1; col++) {
        const x = col * (bw + jx) + shift + jx / 2;
        // Per-block tonal variation is what stops brickwork looking printed.
        ctx.fillStyle = shade(color, (random() - 0.5) * 0.1);
        ctx.fillRect(x, y, bw, bh);
        // A lit top edge and shaded bottom edge fake the relief.
        ctx.fillStyle = shade(color, 0.07);
        ctx.fillRect(x, y, bw, Math.max(1, bh * 0.08));
        ctx.fillStyle = shade(color, -0.09);
        ctx.fillRect(x, y + bh - Math.max(1, bh * 0.1), bw, Math.max(1, bh * 0.1));
      }
    }

    // Overlay the block face grain at low opacity to break up the flatness.
    const grain = faceTexture(face, color).image as HTMLCanvasElement | undefined;
    if (grain) {
      ctx.globalAlpha = 0.22;
      for (let y = 0; y < h; y += grain.height) {
        for (let x = 0; x < w; x += grain.width) ctx.drawImage(grain, x, y);
      }
      ctx.globalAlpha = 1;
    }

    const texture = toTexture(el);
    texture.repeat.set(1 / moduleW, 1 / moduleH);
    return texture;
  });
}

/* -------------------------------------------------------------------------- */
/* Sprites (alpha-tested billboards)                                          */
/* -------------------------------------------------------------------------- */

/** A clump of grass blades on transparent background, for the lawn tufts. */
export function grassTuftTexture(color: string): THREE.Texture {
  return cached(`tuft:${color}`, () => {
    const size = 128;
    const { el, ctx } = canvas(size);
    ctx.clearRect(0, 0, size, size);
    const random = rng(hash(color) ^ 0x5eed);
    for (let i = 0; i < 26; i++) {
      const baseX = size * 0.5 + (random() - 0.5) * size * 0.85;
      const height = size * (0.45 + random() * 0.5);
      const lean = (random() - 0.5) * size * 0.35;
      const width = 2.2 + random() * 3.2;
      const grad = ctx.createLinearGradient(baseX, size, baseX, size - height);
      grad.addColorStop(0, shade(color, -0.16));
      grad.addColorStop(1, shade(color, 0.12));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(baseX - width, size);
      ctx.quadraticCurveTo(baseX + lean * 0.4, size - height * 0.6, baseX + lean, size - height);
      ctx.quadraticCurveTo(baseX + lean * 0.4 + width, size - height * 0.6, baseX + width, size);
      ctx.closePath();
      ctx.fill();
    }
    const texture = toTexture(el, false);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  });
}

/** A soft blob of foliage used for tree canopies and shrubs. */
export function foliageTexture(color: string): THREE.Texture {
  return cached(`foliage:${color}`, () => {
    const size = 128;
    const { el, ctx } = canvas(size);
    ctx.clearRect(0, 0, size, size);
    const random = rng(hash(color) ^ 0x1eaf);
    for (let i = 0; i < 90; i++) {
      const angle = random() * Math.PI * 2;
      // Bias towards the centre so the silhouette stays roughly round.
      const radius = Math.pow(random(), 0.6) * size * 0.46;
      const x = size / 2 + Math.cos(angle) * radius;
      const y = size / 2 + Math.sin(angle) * radius;
      const leaf = 5 + random() * 11;
      ctx.fillStyle = shade(color, (random() - 0.45) * 0.3);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(x, y, leaf, leaf * 0.66, random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const texture = toTexture(el, false);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  });
}

/** A single flower head, used for bedding plants. */
export function flowerTexture(petal: string, centre = '#f3d55b'): THREE.Texture {
  return cached(`flower:${petal}:${centre}`, () => {
    const size = 64;
    const { el, ctx } = canvas(size);
    ctx.clearRect(0, 0, size, size);
    const petals = 6;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      ctx.fillStyle = shade(petal, i % 2 ? 0.05 : -0.05);
      ctx.beginPath();
      ctx.ellipse(
        size / 2 + Math.cos(a) * size * 0.2,
        size / 2 + Math.sin(a) * size * 0.2,
        size * 0.19,
        size * 0.12,
        a,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = centre;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.12, 0, Math.PI * 2);
    ctx.fill();
    const texture = toTexture(el, false);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  });
}

/** Vertically streaked bark for trunks. */
export function barkTexture(color: string): THREE.Texture {
  return cached(`bark:${color}`, () => {
    const size = 128;
    const { el, ctx } = canvas(size);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    const random = rng(hash(color) ^ 0xba21);
    for (let i = 0; i < 120; i++) {
      ctx.strokeStyle = shade(color, (random() - 0.5) * 0.3);
      ctx.lineWidth = 0.8 + random() * 3;
      const x = random() * size;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y <= size; y += 12) {
        ctx.lineTo(x + Math.sin(y * 0.1 + i) * 2.5, y);
      }
      ctx.stroke();
    }
    return toTexture(el);
  });
}

/** Radial falloff used as the glow sprite on lit bulbs at night. */
export function glowTexture(): THREE.Texture {
  return cached('glow', () => {
    const size = 128;
    const { el, ctx } = canvas(size);
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,240,210,0.55)');
    grad.addColorStop(1, 'rgba(255,220,180,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const texture = toTexture(el, false);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  });
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
