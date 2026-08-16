/**
 * The starter document: a rough stand-in for the garden this tool was built
 * for — tiles by the house, a raised planted bed walled in with stapelblokken,
 * a lawn with a footpath across it, and more tiles with a shed at the back.
 *
 * The site rectangle is centred on the origin, so the house end is at -Z and
 * the back fence at +Z.
 */

import {
  blockSpec,
  makeFence,
  makeFurniture,
  makeLight,
  makePath,
  makePerson,
  makePlant,
  makeStructure,
  makeSurface,
  tileSpec,
} from './factory';
import { rectangle, v2 } from './geometry';
import { emptyDoc } from './store';
import type { GardenDoc } from './types';

const WIDTH = 8;
const DEPTH = 16;

const stapelblok = () =>
  blockSpec({
    name: 'Stapelblok 60×20×12',
    length: 0.6,
    height: 0.2,
    depth: 0.12,
    color: '#8d8377',
    texture: 'split',
  });

export function sampleGarden(): GardenDoc {
  const doc = emptyDoc('Tuin — huidige situatie');
  doc.site.width = WIDTH;
  doc.site.depth = DEPTH;
  // The garden runs away from the house towards the south-west back corner.
  doc.site.northOffset = 200;

  doc.objects = [
    /* --------------------------------------------------------- house end */
    makeStructure('house-wall', {
      name: 'Achtergevel',
      position: v2(0, -8.15),
      width: WIDTH,
      depth: 0.3,
      height: 3.2,
      color: '#a8654b',
      doorWidth: 1.8,
      doorHeight: 2.4,
      doorOffset: 0.62,
      windowWidth: 1.6,
      windowHeight: 1.3,
      windowOffset: 0.28,
      windowSill: 0.95,
    }),

    /* ------------------------------------------------ terrace by the house */
    makeSurface({
      name: 'Terras bij huis (leisteen)',
      position: v2(0, -5.8),
      points: rectangle(WIDTH, 4),
      ground: {
        kind: 'tiles',
        tile: tileSpec({
          name: 'Leisteentegel 60×60',
          width: 0.6,
          depth: 0.6,
          color: '#6f7175',
          texture: 'slate',
          gap: 0.006,
          jointColor: '#4a4a48',
        }),
        patternAngle: 0,
      },
    }),

    /* ---------------------------- raised planting bed, walled in with blocks */
    makeSurface({
      name: 'Verhoogd plantvak',
      position: v2(-2.6, -2.3),
      points: rectangle(2.8, 3),
      elevation: 0,
      raise: 0.4,
      ground: { kind: 'dirt', color: '#5a4332', scatter: 0.4 },
      edging: { enabled: true, block: stapelblok(), courses: 2, openEdges: [] },
    }),
    makePlant('pear-tree', {
      name: 'Perenboom',
      position: v2(-2.6, -2.1),
      elevation: 0.4,
      height: 4.2,
      spread: 3.0,
      seed: 4211,
    }),
    makePlant('lavender', { position: v2(-3.4, -3.2), elevation: 0.4, count: 5, seed: 71 }),
    makePlant('box-ball', { position: v2(-1.8, -3.2), elevation: 0.4, seed: 93 }),
    makePlant('fern', { position: v2(-3.4, -1.2), elevation: 0.4, count: 3, seed: 158 }),
    makePlant('hosta', { position: v2(-1.8, -1.1), elevation: 0.4, count: 3, seed: 302 }),

    /* ------------------------------------------ lawn wrapping round the bed */
    makeSurface({
      name: 'Gazon',
      position: v2(0, 0),
      points: [
        v2(-1.2, -3.8),
        v2(4, -3.8),
        v2(4, 3.2),
        v2(-4, 3.2),
        v2(-4, -0.8),
        v2(-1.2, -0.8),
      ],
      ground: { kind: 'grass', scatter: 1, color: '#5c7f3f' },
    }),

    /* -------------------------------------------- footpath across the lawn */
    makePath({
      name: 'Looppad',
      position: v2(0, 0),
      path: [v2(0.1, -3.9), v2(-0.4, -2.0), v2(0.3, 0.6), v2(0.9, 3.3)],
      curved: true,
      width: 0.8,
      tile: tileSpec({
        name: 'Padtegel 40×40',
        width: 0.4,
        depth: 0.4,
        color: '#7e7c76',
        texture: 'slate',
        gap: 0.005,
      }),
    }),

    /* --------------------------------------------- back terrace and the shed */
    makeSurface({
      name: 'Terras achter (leisteen)',
      position: v2(0, 5.5),
      points: rectangle(WIDTH, 4.6),
      ground: {
        kind: 'tiles',
        tile: tileSpec({
          name: 'Leisteentegel 60×60',
          width: 0.6,
          depth: 0.6,
          color: '#6f7175',
          texture: 'slate',
          gap: 0.006,
          jointColor: '#4a4a48',
        }),
      },
    }),
    makeStructure('shed', {
      name: 'Stenen schuur',
      position: v2(-2.2, 6.4),
      width: 3.0,
      depth: 2.2,
      height: 2.1,
      material: 'brick',
      color: '#8f5a45',
      roof: 'mono-pitch',
      roofRise: 0.45,
      roofColor: '#3f4348',
      door: true,
      doorWidth: 0.9,
      doorHeight: 2.0,
      doorOffset: 0.3,
      window: true,
      windowWidth: 0.8,
      windowHeight: 0.7,
      windowOffset: 0.74,
      windowSill: 1.15,
    }),

    /* ------------------------------------------------------------- boundary */
    makeFence({
      name: 'Schutting links',
      position: v2(-4, 0),
      path: [v2(0, -8), v2(0, 8)],
      height: 1.8,
      style: 'slat',
    }),
    makeFence({
      name: 'Schutting rechts',
      position: v2(4, 0),
      path: [v2(0, -8), v2(0, 8)],
      height: 1.8,
      style: 'slat',
    }),
    makeFence({
      name: 'Schutting achter',
      position: v2(0, 8),
      path: [v2(-4, 0), v2(4, 0)],
      height: 1.8,
      style: 'slat',
    }),

    /* ------------------------------------------------------------ furniture */
    makeFurniture('dining-table', { position: v2(1.3, -6.0), rotation: 0 }),
    makeFurniture('chair', { position: v2(0.65, -6.75), rotation: Math.PI }),
    makeFurniture('chair', { position: v2(1.95, -6.75), rotation: Math.PI }),
    makeFurniture('chair', { position: v2(0.65, -5.25), rotation: 0 }),
    makeFurniture('chair', { position: v2(1.95, -5.25), rotation: 0 }),
    makeFurniture('parasol', { position: v2(1.3, -6.0) }),
    makeFurniture('bbq', { position: v2(3.4, -7.2), rotation: Math.PI }),
    makePlant('grass-tuft', { position: v2(3.5, -4.6), count: 3, seed: 512 }),
    makePlant('flower-bed', { position: v2(-3.6, 2.4), count: 12, spread: 0.7, seed: 88 }),
    makePlant('bush', { position: v2(3.4, 2.6), height: 1.2, seed: 640 }),

    /* --------------------------------------------------------------- lights */
    makeLight('string', {
      name: 'Lichtslinger terras',
      position: v2(0, 0),
      path: [v2(-3.8, -7.9), v2(0, -6.6), v2(3.8, -7.9)],
      height: 2.5,
      sag: 0.16,
      bulbSpacing: 0.55,
      festive: true,
    }),
    makeLight('post', { name: 'Tuinlamp pad', position: v2(-0.6, -2.4), height: 0.9 }),
    makeLight('post', { name: 'Tuinlamp pad 2', position: v2(1.4, 1.6), height: 0.9 }),
    makeLight('spot', { name: 'Spot perenboom', position: v2(-1.6, -2.1), elevation: 0.4 }),

    /* --------------------------------------------------- scale reference */
    makePerson({ name: 'Referentie 1,85 m', position: v2(0.4, -1.0), height: 1.85 }),
  ];

  return doc;
}
