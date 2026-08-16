/**
 * 2D plan export.
 *
 * Produces a dimensioned scale drawing as SVG: outlines of every surface,
 * wall, path and building, edge dimensions, a north arrow, a scale bar and a
 * legend. It is the drawing you take to the builders' merchant, so the numbers
 * on it are the numbers in the document — no re-derivation, no rounding until
 * the text is written.
 */

import { pathCentreLine, pathOutline } from '../render/build/path';
import { layTiles } from '../render/build/paving';
import { layBlocks } from '../render/build/masonry';
import { area, distance, lerp2, normalize, perp, rectangle, rotate, sub } from './geometry';
import { formatArea, formatShort, round } from './units';
import type { GardenDoc, GardenObject, Vec2 } from './types';

export interface PlanOptions {
  /** Millimetres of paper per metre of garden. 20 gives roughly 1:50. */
  scale: number;
  showDimensions: boolean;
  showGrid: boolean;
  showLegend: boolean;
  showTakeOff: boolean;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  // 40 px/m is roughly 1:25 on paper, which leaves room for the dimension
  // text to sit beside the lines instead of on top of them.
  scale: 40,
  showDimensions: true,
  showGrid: true,
  showLegend: true,
  showTakeOff: true,
};

const MARGIN = 90;
const LEGEND_WIDTH = 250;

interface Ctx {
  doc: GardenDoc;
  options: PlanOptions;
  /** Garden metres -> paper units. */
  s: number;
  parts: string[];
}

/** World point -> paper coordinates. +Z (away from the house) is down. */
function project(ctx: Ctx, point: Vec2): { x: number; y: number } {
  const { width, depth } = ctx.doc.site;
  return {
    x: MARGIN + (point.x + width / 2) * ctx.s,
    y: MARGIN + (point.z + depth / 2) * ctx.s,
  };
}

function worldPoints(object: GardenObject, points: Vec2[]): Vec2[] {
  return points.map((point) => {
    const turned = rotate(point, object.rotation);
    return { x: object.position.x + turned.x, z: object.position.z + turned.z };
  });
}

export function buildPlanSvg(doc: GardenDoc, options: PlanOptions = DEFAULT_PLAN_OPTIONS): string {
  const s = options.scale;
  const ctx: Ctx = { doc, options, s, parts: [] };

  const width = MARGIN * 2 + doc.site.width * s + (options.showLegend ? LEGEND_WIDTH : 0);
  const height = MARGIN * 2 + doc.site.depth * s + 80;

  ctx.parts.push(
    `<rect x="0" y="0" width="${round(width, 1)}" height="${round(height, 1)}" fill="#ffffff"/>`,
  );

  if (options.showGrid) drawGrid(ctx);
  drawSite(ctx);

  // Draw ground first, then everything that stands on it.
  const order: GardenObject['type'][] = [
    'surface',
    'path',
    'tile',
    'wall',
    'fence',
    'structure',
    'furniture',
    'plant',
    'light',
    'person',
    'measure',
  ];
  for (const type of order) {
    for (const object of doc.objects) {
      if (object.type !== type || object.hidden) continue;
      drawObject(ctx, object);
    }
  }

  if (options.showDimensions) {
    for (const object of doc.objects) {
      if (object.hidden) continue;
      drawDimensions(ctx, object);
    }
  }

  drawNorthArrow(ctx);
  drawScaleBar(ctx, height);
  drawTitle(ctx, height);
  if (options.showLegend) drawLegend(ctx, width, height);

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width, 1)}" height="${round(height, 1)}" viewBox="0 0 ${round(width, 1)} ${round(height, 1)}" font-family="Inter, system-ui, sans-serif">`,
    ctx.parts.join('\n'),
    `</svg>`,
  ].join('\n');
}

/* --------------------------------------------------------------- drawing */

function polygonPath(ctx: Ctx, points: Vec2[], close = true): string {
  const d = points
    .map((point, i) => {
      const p = project(ctx, point);
      return `${i === 0 ? 'M' : 'L'}${round(p.x, 2)},${round(p.y, 2)}`;
    })
    .join(' ');
  return close ? `${d} Z` : d;
}

function drawGrid(ctx: Ctx) {
  const { width, depth } = ctx.doc.site;
  const lines: string[] = [];
  for (let x = Math.ceil(-width / 2); x <= width / 2; x++) {
    const a = project(ctx, { x, z: -depth / 2 });
    const b = project(ctx, { x, z: depth / 2 });
    lines.push(
      `<line x1="${round(a.x, 2)}" y1="${round(a.y, 2)}" x2="${round(b.x, 2)}" y2="${round(b.y, 2)}" stroke="${x % 5 === 0 ? '#c9d3dc' : '#e8edf1'}" stroke-width="${x % 5 === 0 ? 1 : 0.6}"/>`,
    );
  }
  for (let z = Math.ceil(-depth / 2); z <= depth / 2; z++) {
    const a = project(ctx, { x: -width / 2, z });
    const b = project(ctx, { x: width / 2, z });
    lines.push(
      `<line x1="${round(a.x, 2)}" y1="${round(a.y, 2)}" x2="${round(b.x, 2)}" y2="${round(b.y, 2)}" stroke="${z % 5 === 0 ? '#c9d3dc' : '#e8edf1'}" stroke-width="${z % 5 === 0 ? 1 : 0.6}"/>`,
    );
  }
  ctx.parts.push(`<g id="grid">${lines.join('')}</g>`);
}

function drawSite(ctx: Ctx) {
  const { width, depth } = ctx.doc.site;
  const ring = rectangle(width, depth);
  ctx.parts.push(
    `<path d="${polygonPath(ctx, ring)}" fill="none" stroke="#1c2430" stroke-width="2.2"/>`,
  );

  // Overall dimensions outside the plot line.
  const top = project(ctx, { x: 0, z: -depth / 2 });
  const left = project(ctx, { x: -width / 2, z: 0 });
  ctx.parts.push(
    `<text x="${round(top.x, 1)}" y="${round(top.y - 16, 1)}" text-anchor="middle" font-size="15" font-weight="600" fill="#1c2430">${formatShort(width, 'm')}</text>`,
    `<text x="${round(left.x - 16, 1)}" y="${round(left.y, 1)}" text-anchor="middle" font-size="15" font-weight="600" fill="#1c2430" transform="rotate(-90 ${round(left.x - 16, 1)} ${round(left.y, 1)})">${formatShort(depth, 'm')}</text>`,
  );
}

/** Hatch/fill per ground type so the plan reads without colour. */
const GROUND_FILL: Record<string, { fill: string; stroke: string }> = {
  grass: { fill: '#dfeccd', stroke: '#7ea45a' },
  tiles: { fill: '#e6e7e8', stroke: '#8f9296' },
  dirt: { fill: '#e8dccc', stroke: '#a08a63' },
  mulch: { fill: '#e2d6c6', stroke: '#9c8060' },
  gravel: { fill: '#eceae5', stroke: '#a5a29b' },
  deck: { fill: '#eadfcd', stroke: '#a3835a' },
  water: { fill: '#d5e9f0', stroke: '#5d97ab' },
  concrete: { fill: '#eaeaea', stroke: '#9a9a9a' },
};

function drawObject(ctx: Ctx, object: GardenObject) {
  switch (object.type) {
    case 'surface': {
      const points = worldPoints(object, object.points);
      const look = GROUND_FILL[object.ground.kind] ?? GROUND_FILL.concrete;
      ctx.parts.push(
        `<path d="${polygonPath(ctx, points)}" fill="${look.fill}" stroke="${look.stroke}" stroke-width="1.2"/>`,
      );

      // Paving units, so the drawing shows the actual setting-out.
      if (object.ground.kind === 'tiles' && object.ground.tile && ctx.s >= 12) {
        const placements = layTiles(object.points, object.ground.tile, object.ground.patternAngle ?? 0);
        const lines = placements
          .map((placement) => {
            const corners = rectangle(placement.width, placement.depth)
              .map((corner) => rotate(corner, placement.angle))
              .map((corner) => ({ x: corner.x + placement.x, z: corner.z + placement.z }));
            return `<path d="${polygonPath(ctx, worldPoints(object, corners))}" fill="none" stroke="${look.stroke}" stroke-width="0.4" opacity="0.75"/>`;
          })
          .join('');
        ctx.parts.push(`<g>${lines}</g>`);
      }

      if (object.edging.enabled) {
        ctx.parts.push(
          `<path d="${polygonPath(ctx, points)}" fill="none" stroke="#4a4038" stroke-width="${round(object.edging.block.depth * ctx.s, 2)}" stroke-opacity="0.85"/>`,
        );
      }

      // Only name a surface if there is room inside it for the caption.
      const surfaceArea = area(object.points);
      if (surfaceArea > 1.2) {
        const label = project(ctx, centroidOf(points));
        ctx.parts.push(
          `<text x="${round(label.x, 1)}" y="${round(label.y, 1)}" text-anchor="middle" font-size="12" fill="#3a4653">${escape(object.name)}</text>`,
          `<text x="${round(label.x, 1)}" y="${round(label.y + 14, 1)}" text-anchor="middle" font-size="11" fill="#6b7684">${formatArea(surfaceArea)}</text>`,
        );
      }
      return;
    }

    case 'path': {
      const outline = pathOutline(object);
      if (outline.length < 3) return;
      ctx.parts.push(
        `<path d="${polygonPath(ctx, worldPoints(object, outline))}" fill="#e6e7e8" stroke="#8f9296" stroke-width="1"/>`,
      );
      const centre = worldPoints(object, pathCentreLine(object));
      ctx.parts.push(
        `<path d="${polygonPath(ctx, centre, false)}" fill="none" stroke="#8f9296" stroke-width="0.6" stroke-dasharray="6 4"/>`,
      );
      return;
    }

    case 'wall': {
      const points = worldPoints(object, object.path);
      ctx.parts.push(
        `<path d="${polygonPath(ctx, points, false)}" fill="none" stroke="#3c352e" stroke-width="${round(Math.max(1.5, object.block.depth * ctx.s), 2)}" stroke-linecap="square"/>`,
      );
      return;
    }

    case 'fence': {
      const points = worldPoints(object, object.path);
      ctx.parts.push(
        `<path d="${polygonPath(ctx, points, false)}" fill="none" stroke="#6b5334" stroke-width="2" stroke-dasharray="10 3"/>`,
      );
      return;
    }

    case 'structure': {
      const ring = worldPoints(object, rectangle(object.width, object.depth));
      const fill = object.kind === 'house-wall' ? '#cfd6dd' : '#ded3c6';
      ctx.parts.push(
        `<path d="${polygonPath(ctx, ring)}" fill="${fill}" stroke="#3a4653" stroke-width="1.6"/>`,
      );
      const label = project(ctx, object.position);
      ctx.parts.push(
        `<text x="${round(label.x, 1)}" y="${round(label.y, 1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#26313d">${escape(object.name)}</text>`,
      );
      return;
    }

    case 'furniture': {
      const ring = worldPoints(object, rectangle(object.width, object.depth));
      ctx.parts.push(
        `<path d="${polygonPath(ctx, ring)}" fill="#ffffff" stroke="#6b7684" stroke-width="1" stroke-dasharray="4 3"/>`,
      );
      return;
    }

    case 'tile': {
      const ring = worldPoints(object, rectangle(object.tile.width, object.tile.depth));
      ctx.parts.push(
        `<path d="${polygonPath(ctx, ring)}" fill="#e6e7e8" stroke="#8f9296" stroke-width="0.8"/>`,
      );
      return;
    }

    case 'plant': {
      const centre = project(ctx, object.position);
      const radius = Math.max(3, (object.spread / 2) * ctx.s);
      ctx.parts.push(
        `<circle cx="${round(centre.x, 1)}" cy="${round(centre.y, 1)}" r="${round(radius, 1)}" fill="#cfe3bd" fill-opacity="0.55" stroke="#5d8a45" stroke-width="1" stroke-dasharray="3 2"/>`,
        `<circle cx="${round(centre.x, 1)}" cy="${round(centre.y, 1)}" r="2.2" fill="#5d8a45"/>`,
      );
      return;
    }

    case 'light': {
      if (object.kind === 'string') {
        const points = worldPoints(object, object.path);
        ctx.parts.push(
          `<path d="${polygonPath(ctx, points, false)}" fill="none" stroke="#d9a300" stroke-width="1" stroke-dasharray="2 3"/>`,
        );
        return;
      }
      const centre = project(ctx, object.position);
      ctx.parts.push(
        `<circle cx="${round(centre.x, 1)}" cy="${round(centre.y, 1)}" r="4" fill="none" stroke="#d9a300" stroke-width="1.4"/>`,
        `<circle cx="${round(centre.x, 1)}" cy="${round(centre.y, 1)}" r="1.4" fill="#d9a300"/>`,
      );
      return;
    }

    case 'person': {
      const centre = project(ctx, object.position);
      ctx.parts.push(
        `<circle cx="${round(centre.x, 1)}" cy="${round(centre.y, 1)}" r="${round(0.25 * ctx.s, 1)}" fill="#c8d4e2" stroke="#4a5b6e" stroke-width="1"/>`,
      );
      return;
    }

    case 'measure': {
      if (object.path.length < 2) return;
      const points = worldPoints(object, object.path);
      drawDimensionLine(ctx, points[0], points[1], 0, '#c2410c');
      return;
    }
  }
}

/**
 * Edge dimensions for the shapes where they matter.
 *
 * Anything under half a metre is skipped: at plan scale the caption would be
 * wider than the edge it describes, and a drawing you cannot read is worse
 * than one that leaves a short edge to the reader.
 */
const MIN_DIMENSIONED_EDGE = 0.5;
const DIM_OFFSET = 0.38;

function drawDimensions(ctx: Ctx, object: GardenObject) {
  if (object.type === 'surface') {
    const points = worldPoints(object, object.points);
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (distance(a, b) < MIN_DIMENSIONED_EDGE) continue;
      drawDimensionLine(ctx, a, b, DIM_OFFSET, '#1c2430');
    }
    return;
  }
  if (object.type === 'wall' || object.type === 'fence') {
    const points = worldPoints(object, object.path);
    for (let i = 0; i < points.length - 1; i++) {
      if (distance(points[i], points[i + 1]) < MIN_DIMENSIONED_EDGE) continue;
      drawDimensionLine(ctx, points[i], points[i + 1], DIM_OFFSET, '#1c2430');
    }
    return;
  }
  if (object.type === 'structure') {
    const ring = worldPoints(object, rectangle(object.width, object.depth));
    drawDimensionLine(ctx, ring[0], ring[1], DIM_OFFSET, '#1c2430');
    drawDimensionLine(ctx, ring[1], ring[2], DIM_OFFSET, '#1c2430');
  }
}

/**
 * A dimension line offset from the measured edge, with witness ticks and the
 * length written along it the right way up.
 */
function drawDimensionLine(ctx: Ctx, a: Vec2, b: Vec2, offset: number, color: string) {
  const direction = normalize(sub(b, a));
  const normal = perp(direction);
  const shift = { x: normal.x * offset, z: normal.z * offset };
  const from = { x: a.x + shift.x, z: a.z + shift.z };
  const to = { x: b.x + shift.x, z: b.z + shift.z };

  const p1 = project(ctx, from);
  const p2 = project(ctx, to);
  const mid = project(ctx, lerp2(from, to, 0.5));
  const length = distance(a, b);

  // Keep the text upright: flip the label when the edge runs right-to-left.
  let angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;

  ctx.parts.push(
    `<g stroke="${color}" stroke-width="0.9">` +
      `<line x1="${round(p1.x, 2)}" y1="${round(p1.y, 2)}" x2="${round(p2.x, 2)}" y2="${round(p2.y, 2)}"/>` +
      tick(ctx, from, normal) +
      tick(ctx, to, normal) +
      `</g>` +
      `<text x="${round(mid.x, 1)}" y="${round(mid.y - 4, 1)}" text-anchor="middle" font-size="11" font-weight="600" fill="${color}" transform="rotate(${round(angle, 1)} ${round(mid.x, 1)} ${round(mid.y, 1)})">${formatShort(length, 'm')}</text>`,
  );
}

function tick(ctx: Ctx, point: Vec2, normal: Vec2): string {
  const a = project(ctx, { x: point.x - normal.x * 0.1, z: point.z - normal.z * 0.1 });
  const b = project(ctx, { x: point.x + normal.x * 0.1, z: point.z + normal.z * 0.1 });
  return `<line x1="${round(a.x, 2)}" y1="${round(a.y, 2)}" x2="${round(b.x, 2)}" y2="${round(b.y, 2)}"/>`;
}

function drawNorthArrow(ctx: Ctx) {
  const { width, depth } = ctx.doc.site;
  // Clear of the plot line and of the overall width dimension above it.
  const origin = project(ctx, { x: width / 2 + 1.4, z: -depth / 2 + 1.4 });
  const angle = ctx.doc.site.northOffset;
  ctx.parts.push(
    `<g transform="translate(${round(origin.x, 1)} ${round(origin.y, 1)}) rotate(${round(angle, 1)})">` +
      `<line x1="0" y1="22" x2="0" y2="-22" stroke="#1c2430" stroke-width="1.6"/>` +
      `<path d="M0,-30 L7,-14 L0,-18 L-7,-14 Z" fill="#c2410c"/>` +
      `<text x="0" y="-34" text-anchor="middle" font-size="12" font-weight="700" fill="#c2410c">N</text>` +
      `</g>`,
  );
}

function drawScaleBar(ctx: Ctx, height: number) {
  const y = height - 46;
  const x = MARGIN;
  const metres = 5;
  const segments = 5;
  const barWidth = metres * ctx.s;
  const parts: string[] = [];
  for (let i = 0; i < segments; i++) {
    parts.push(
      `<rect x="${round(x + (i * barWidth) / segments, 1)}" y="${round(y, 1)}" width="${round(barWidth / segments, 1)}" height="8" fill="${i % 2 ? '#ffffff' : '#1c2430'}" stroke="#1c2430" stroke-width="0.8"/>`,
    );
  }
  ctx.parts.push(
    `<g>${parts.join('')}` +
      `<text x="${round(x, 1)}" y="${round(y + 22, 1)}" font-size="11" fill="#1c2430">0</text>` +
      `<text x="${round(x + barWidth, 1)}" y="${round(y + 22, 1)}" text-anchor="middle" font-size="11" fill="#1c2430">${metres} m</text>` +
      `<text x="${round(x + barWidth + 24, 1)}" y="${round(y + 8, 1)}" font-size="11" fill="#6b7684">schaal 1:${Math.round(1000 / ctx.s)}</text>` +
      `</g>`,
  );
}

function drawTitle(ctx: Ctx, height: number) {
  const date = new Date(ctx.doc.updatedAt).toLocaleDateString('nl-NL');
  ctx.parts.push(
    `<text x="${MARGIN}" y="${round(height - 62, 1)}" font-size="18" font-weight="700" fill="#1c2430">${escape(ctx.doc.name)}</text>`,
    `<text x="${MARGIN}" y="${round(height - 12, 1)}" font-size="11" fill="#6b7684">Plattegrond · maten in meters · bijgewerkt ${date} · Gardenator</text>`,
  );
}

function drawLegend(ctx: Ctx, width: number, _height: number) {
  const x = width - LEGEND_WIDTH + 10;
  let y = MARGIN;
  const rows: string[] = [];

  rows.push(
    `<text x="${x}" y="${y}" font-size="14" font-weight="700" fill="#1c2430">Legenda</text>`,
  );
  y += 22;

  const kinds = new Set(
    ctx.doc.objects
      .filter((object) => object.type === 'surface' && !object.hidden)
      .map((object) => (object as { ground: { kind: string } }).ground.kind),
  );
  for (const kind of kinds) {
    const look = GROUND_FILL[kind] ?? GROUND_FILL.concrete;
    rows.push(
      `<rect x="${x}" y="${y - 10}" width="16" height="12" fill="${look.fill}" stroke="${look.stroke}"/>`,
      `<text x="${x + 24}" y="${y}" font-size="11" fill="#3a4653">${GROUND_LABELS[kind] ?? kind}</text>`,
    );
    y += 18;
  }

  if (ctx.options.showTakeOff) {
    y += 14;
    rows.push(
      `<text x="${x}" y="${y}" font-size="14" font-weight="700" fill="#1c2430">Materiaalstaat</text>`,
    );
    y += 20;
    for (const line of takeOff(ctx.doc)) {
      rows.push(`<text x="${x}" y="${y}" font-size="11" fill="#3a4653">${escape(line)}</text>`);
      y += 16;
    }
  }

  ctx.parts.push(`<g>${rows.join('')}</g>`);
}

const GROUND_LABELS: Record<string, string> = {
  grass: 'Gras',
  tiles: 'Tegels',
  dirt: 'Grond / plantvak',
  mulch: 'Houtsnippers',
  gravel: 'Grind',
  deck: 'Vlonder',
  water: 'Water',
  concrete: 'Beton',
  path: 'Pad',
};

/**
 * Quantities for ordering: tiles per specification, blocks per wall, areas per
 * ground type, and running metres of fence.
 */
export function takeOff(doc: GardenDoc): string[] {
  const lines: string[] = [];
  const tileCounts = new Map<string, number>();
  const blockCounts = new Map<string, number>();
  const areas = new Map<string, number>();
  let fenceLength = 0;

  for (const object of doc.objects) {
    if (object.hidden) continue;
    switch (object.type) {
      case 'surface': {
        const key = object.ground.kind;
        areas.set(key, (areas.get(key) ?? 0) + area(object.points));
        if (object.ground.kind === 'tiles' && object.ground.tile) {
          const spec = object.ground.tile;
          const count = layTiles(object.points, spec, object.ground.patternAngle ?? 0).length;
          const label = `${spec.name}`;
          tileCounts.set(label, (tileCounts.get(label) ?? 0) + count);
        }
        if (object.edging.enabled) {
          const blocks = layBlocks(object.points, object.edging.block, object.edging.courses, {
            closed: true,
            skipEdges: object.edging.openEdges,
          });
          const label = object.edging.block.name;
          blockCounts.set(label, (blockCounts.get(label) ?? 0) + blocks.length);
        }
        break;
      }
      case 'wall': {
        const blocks = layBlocks(object.path, object.block, object.courses, { closed: false });
        blockCounts.set(object.block.name, (blockCounts.get(object.block.name) ?? 0) + blocks.length);
        break;
      }
      case 'path': {
        const outline = pathOutline(object);
        if (outline.length >= 3) {
          const count = layTiles(outline, object.tile, 0).length;
          tileCounts.set(object.tile.name, (tileCounts.get(object.tile.name) ?? 0) + count);
          areas.set('path', (areas.get('path') ?? 0) + area(outline));
        }
        break;
      }
      case 'fence': {
        for (let i = 0; i < object.path.length - 1; i++) {
          fenceLength += distance(object.path[i], object.path[i + 1]);
        }
        break;
      }
      default:
        break;
    }
  }

  for (const [kind, value] of areas) {
    lines.push(`${GROUND_LABELS[kind] ?? kind}: ${formatArea(value)}`);
  }
  for (const [name, count] of tileCounts) {
    lines.push(`${name}: ${count} stuks`);
  }
  for (const [name, count] of blockCounts) {
    lines.push(`${name}: ${count} stuks`);
  }
  if (fenceLength > 0) lines.push(`Schutting: ${formatShort(fenceLength, 'm')}`);
  return lines;
}

function centroidOf(points: Vec2[]): Vec2 {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  return { x: sum.x / points.length, z: sum.z / points.length };
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
