/** Factories: sensible real-world defaults for every object type. */

import { rectangle, v2 } from './geometry';
import type {
  BlockSpec,
  FenceObject,
  FurnitureObject,
  GardenObject,
  LightObject,
  MeasureObject,
  ObjectType,
  PathObject,
  PersonObject,
  PlantObject,
  PlantSpecies,
  StructureObject,
  SurfaceObject,
  TileObject,
  TileSpec,
  Vec2,
  WallObject,
} from './types';

let counter = 0;

export function uid(prefix = 'o'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

/* -------------------------------------------------------------------------- */
/* Material specs                                                             */
/* -------------------------------------------------------------------------- */

export function blockSpec(patch: Partial<BlockSpec> = {}): BlockSpec {
  return {
    id: uid('blk'),
    name: 'Stapelblok 60×20×12',
    length: 0.6,
    height: 0.2,
    depth: 0.12,
    color: '#8d8377',
    joint: 0,
    jointColor: '#6f675d',
    bondOffset: 0.5,
    texture: 'split',
    ...patch,
  };
}

export function tileSpec(patch: Partial<TileSpec> = {}): TileSpec {
  return {
    id: uid('tl'),
    name: 'Tegel 60×60',
    shape: 'rect',
    width: 0.6,
    depth: 0.6,
    thickness: 0.04,
    color: '#8e8e8c',
    gap: 0.005,
    jointColor: '#57544f',
    pattern: 'grid',
    texture: 'slate',
    ...patch,
  };
}

/** The block and tile presets a new document starts with. */
export function defaultBlocks(): BlockSpec[] {
  return [
    blockSpec({ name: 'Stapelblok 60×20×12', length: 0.6, height: 0.2, depth: 0.12, color: '#8d8377' }),
    blockSpec({
      name: 'Stapelblok 40×15×15',
      length: 0.4,
      height: 0.15,
      depth: 0.15,
      color: '#9a9084',
      texture: 'rough',
    }),
    blockSpec({
      name: 'Betonblok 40×20×20',
      length: 0.4,
      height: 0.2,
      depth: 0.2,
      color: '#a8a49c',
      texture: 'smooth',
    }),
    blockSpec({
      name: 'Baksteen (waalformaat)',
      length: 0.21,
      height: 0.05,
      depth: 0.1,
      color: '#9c5b46',
      joint: 0.012,
      jointColor: '#b8b0a2',
      texture: 'brick',
    }),
    blockSpec({
      name: 'Gabion-look 100×50×30',
      length: 1.0,
      height: 0.5,
      depth: 0.3,
      color: '#7c7a74',
      texture: 'rough',
      bondOffset: 0.5,
    }),
  ];
}

export function defaultTiles(): TileSpec[] {
  return [
    tileSpec({ name: 'Tegel 60×60 grijs', width: 0.6, depth: 0.6, color: '#8e8e8c', texture: 'slate' }),
    tileSpec({
      name: 'Tegel 30×30 antraciet',
      width: 0.3,
      depth: 0.3,
      color: '#4a4d50',
      texture: 'concrete',
    }),
    tileSpec({
      name: 'Klinker 20×10 rood',
      width: 0.2,
      depth: 0.1,
      color: '#9b543f',
      pattern: 'herringbone',
      texture: 'clay',
      gap: 0.004,
    }),
    tileSpec({
      name: 'Vlonderplank 200×14',
      width: 2.0,
      depth: 0.14,
      thickness: 0.028,
      color: '#8a6a45',
      pattern: 'running',
      texture: 'wood',
      gap: 0.006,
      jointColor: '#3a2f24',
    }),
    tileSpec({
      name: 'Stapsteen rond ø40',
      shape: 'round',
      width: 0.4,
      depth: 0.4,
      color: '#7d7c78',
      texture: 'slate',
    }),
    tileSpec({
      name: 'Grote tegel 80×80',
      width: 0.8,
      depth: 0.8,
      color: '#b3aca1',
      texture: 'concrete',
    }),
  ];
}

/* -------------------------------------------------------------------------- */
/* Object factories                                                           */
/* -------------------------------------------------------------------------- */

interface Base {
  position?: Vec2;
  rotation?: number;
  elevation?: number;
  name?: string;
}

function base(name: string, patch: Base = {}) {
  return {
    id: uid(),
    name: patch.name ?? name,
    position: patch.position ?? v2(0, 0),
    rotation: patch.rotation ?? 0,
    elevation: patch.elevation ?? 0,
    locked: false,
    hidden: false,
  };
}

export function makeSurface(patch: Partial<SurfaceObject> & Base = {}): SurfaceObject {
  return {
    ...base('Vlak', patch),
    type: 'surface',
    points: rectangle(3, 3),
    ground: { kind: 'grass', scatter: 1, patternAngle: 0 },
    raise: 0,
    edging: { enabled: false, block: blockSpec(), courses: 2, openEdges: [] },
    ...patch,
  } as SurfaceObject;
}

export function makeWall(patch: Partial<WallObject> & Base = {}): WallObject {
  return {
    ...base('Muur', patch),
    type: 'wall',
    path: [v2(-1.5, 0), v2(1.5, 0)],
    block: blockSpec(),
    courses: 3,
    capstone: false,
    capstoneOverhang: 0.02,
    ...patch,
  } as WallObject;
}

export function makeFence(patch: Partial<FenceObject> & Base = {}): FenceObject {
  return {
    ...base('Schutting', patch),
    type: 'fence',
    path: [v2(-2, 0), v2(2, 0)],
    height: 1.8,
    style: 'slat',
    postSpacing: 1.8,
    postSize: 0.07,
    color: '#7a6142',
    postColor: '#5d4a33',
    ...patch,
  } as FenceObject;
}

export function makePath(patch: Partial<PathObject> & Base = {}): PathObject {
  return {
    ...base('Pad', patch),
    type: 'path',
    path: [v2(-2, 0), v2(0, 0.6), v2(2, 0)],
    curved: true,
    width: 0.8,
    tile: tileSpec({ name: 'Padtegel 30×30', width: 0.3, depth: 0.3, color: '#8a8880' }),
    steppingStones: false,
    stoneSpacing: 0.15,
    ...patch,
  } as PathObject;
}

export function makeTile(patch: Partial<TileObject> & Base = {}): TileObject {
  return {
    ...base('Tegel', patch),
    type: 'tile',
    tile: tileSpec(),
    ...patch,
  } as TileObject;
}

/** Height, spread and canopy shape that make each species read as itself. */
export const PLANT_PRESETS: Record<
  PlantSpecies,
  { label: string; height: number; spread: number; count: number; group: string }
> = {
  'pear-tree': { label: 'Perenboom', height: 4.2, spread: 3.0, count: 1, group: 'Bomen' },
  'apple-tree': { label: 'Appelboom', height: 3.8, spread: 3.2, count: 1, group: 'Bomen' },
  birch: { label: 'Berk', height: 6.5, spread: 2.6, count: 1, group: 'Bomen' },
  conifer: { label: 'Conifeer', height: 3.0, spread: 1.1, count: 1, group: 'Bomen' },
  olive: { label: 'Olijfboom', height: 2.2, spread: 1.8, count: 1, group: 'Bomen' },
  bush: { label: 'Struik', height: 1.1, spread: 1.2, count: 1, group: 'Struiken' },
  'box-ball': { label: 'Buxusbol', height: 0.6, spread: 0.6, count: 1, group: 'Struiken' },
  bamboo: { label: 'Bamboe', height: 2.6, spread: 0.9, count: 1, group: 'Struiken' },
  climber: { label: 'Klimplant', height: 1.8, spread: 0.5, count: 1, group: 'Struiken' },
  lavender: { label: 'Lavendel', height: 0.45, spread: 0.5, count: 5, group: 'Vaste planten' },
  'grass-tuft': { label: 'Siergras', height: 0.8, spread: 0.6, count: 3, group: 'Vaste planten' },
  fern: { label: 'Varen', height: 0.6, spread: 0.7, count: 3, group: 'Vaste planten' },
  hosta: { label: 'Hosta', height: 0.45, spread: 0.7, count: 3, group: 'Vaste planten' },
  rose: { label: 'Roos', height: 0.9, spread: 0.7, count: 3, group: 'Vaste planten' },
  herb: { label: 'Kruiden', height: 0.3, spread: 0.35, count: 6, group: 'Vaste planten' },
  'flower-bed': { label: 'Bloemenmix', height: 0.5, spread: 0.4, count: 12, group: 'Bloemen' },
  tulips: { label: 'Tulpen', height: 0.4, spread: 0.25, count: 14, group: 'Bloemen' },
};

export function makePlant(
  species: PlantSpecies = 'bush',
  patch: Partial<PlantObject> & Base = {},
): PlantObject {
  const preset = PLANT_PRESETS[species];
  return {
    ...base(preset.label, patch),
    type: 'plant',
    species,
    height: preset.height,
    spread: preset.spread,
    count: preset.count,
    potted: false,
    potColor: '#a9633f',
    seed: Math.floor(Math.random() * 100000) + 1,
    ...patch,
  } as PlantObject;
}

export function makeStructure(
  kind: StructureObject['kind'] = 'shed',
  patch: Partial<StructureObject> & Base = {},
): StructureObject {
  const presets: Record<StructureObject['kind'], Partial<StructureObject>> = {
    shed: {
      name: 'Schuur',
      width: 3.0,
      depth: 2.2,
      height: 2.1,
      material: 'brick',
      roof: 'mono-pitch',
      roofRise: 0.4,
      door: true,
      window: true,
    },
    'house-wall': {
      name: 'Huismuur',
      width: 7.0,
      depth: 0.3,
      height: 3.2,
      material: 'brick',
      roof: 'none',
      roofRise: 0,
      door: true,
      window: true,
      doorWidth: 1.6,
      doorHeight: 2.3,
      windowWidth: 1.8,
      windowHeight: 1.4,
      windowSill: 0.9,
    },
    pergola: {
      name: 'Pergola',
      width: 3.5,
      depth: 3.0,
      height: 2.4,
      material: 'wood',
      color: '#8a6c46',
      roof: 'none',
      roofRise: 0,
      door: false,
      window: false,
    },
    'raised-planter': {
      name: 'Plantenbak',
      width: 1.2,
      depth: 0.6,
      height: 0.6,
      material: 'wood',
      color: '#7d6144',
      roof: 'none',
      roofRise: 0,
      door: false,
      window: false,
    },
  };
  return {
    ...base('Bouwwerk', patch),
    type: 'structure',
    kind,
    width: 3,
    depth: 2.2,
    height: 2.1,
    material: 'brick',
    color: '#9c5b46',
    roof: 'mono-pitch',
    roofRise: 0.4,
    roofColor: '#3f4348',
    roofOverhang: 0.12,
    door: true,
    doorWidth: 0.9,
    doorHeight: 2.0,
    doorOffset: 0.3,
    window: true,
    windowWidth: 0.8,
    windowHeight: 0.7,
    windowOffset: 0.72,
    windowSill: 1.1,
    block: blockSpec({
      name: 'Baksteen (waalformaat)',
      length: 0.21,
      height: 0.05,
      depth: 0.1,
      color: '#9c5b46',
      joint: 0.012,
      jointColor: '#b8b0a2',
      texture: 'brick',
    }),
    ...presets[kind],
    ...patch,
  } as StructureObject;
}

export const FURNITURE_PRESETS: Record<
  FurnitureObject['kind'],
  { label: string; width: number; depth: number; height: number; color: string; accent: string }
> = {
  'dining-table': { label: 'Eettafel', width: 1.8, depth: 0.9, height: 0.75, color: '#8a6a45', accent: '#5d4a33' },
  'coffee-table': { label: 'Salontafel', width: 1.0, depth: 0.55, height: 0.42, color: '#8a6a45', accent: '#5d4a33' },
  chair: { label: 'Stoel', width: 0.5, depth: 0.55, height: 0.9, color: '#8a6a45', accent: '#5d4a33' },
  bench: { label: 'Bank', width: 1.6, depth: 0.6, height: 0.85, color: '#7d6144', accent: '#4d3f2e' },
  lounger: { label: 'Ligbed', width: 0.7, depth: 1.9, height: 0.6, color: '#9a9086', accent: '#5a5550' },
  parasol: { label: 'Parasol', width: 2.8, depth: 2.8, height: 2.4, color: '#c9c3b4', accent: '#4a4a48' },
  'planter-box': { label: 'Plantenbak', width: 0.8, depth: 0.4, height: 0.45, color: '#7d6144', accent: '#4d3f2e' },
  bbq: { label: 'Barbecue', width: 0.7, depth: 0.55, height: 1.0, color: '#3d4045', accent: '#8e9297' },
  firepit: { label: 'Vuurkorf', width: 0.7, depth: 0.7, height: 0.5, color: '#4a4441', accent: '#c96a2a' },
};

export function makeFurniture(
  kind: FurnitureObject['kind'] = 'chair',
  patch: Partial<FurnitureObject> & Base = {},
): FurnitureObject {
  const preset = FURNITURE_PRESETS[kind];
  return {
    ...base(preset.label, patch),
    type: 'furniture',
    kind,
    width: preset.width,
    depth: preset.depth,
    height: preset.height,
    color: preset.color,
    accentColor: preset.accent,
    ...patch,
  } as FurnitureObject;
}

export function makeLight(
  kind: LightObject['kind'] = 'spot',
  patch: Partial<LightObject> & Base = {},
): LightObject {
  const presets: Record<LightObject['kind'], Partial<LightObject>> = {
    spot: { name: 'Grondspot', height: 0.12, intensity: 1, color: '#ffd9a0', coneAngle: 0.5 },
    post: { name: 'Tuinlamp', height: 0.9, intensity: 1.1, color: '#ffcf90' },
    wall: { name: 'Wandlamp', height: 2.0, intensity: 1, color: '#ffd9a0' },
    lantern: { name: 'Lantaarn', height: 0.4, intensity: 0.6, color: '#ffb96b' },
    string: {
      name: 'Lichtslinger',
      height: 2.4,
      intensity: 1,
      color: '#ffc27a',
      sag: 0.14,
      bulbSpacing: 0.5,
      festive: true,
      path: [v2(-3, 0), v2(3, 0)],
    },
  };
  return {
    ...base('Licht', patch),
    type: 'light',
    kind,
    path: [v2(-2, 0), v2(2, 0)],
    height: 0.9,
    sag: 0.14,
    bulbSpacing: 0.5,
    color: '#ffd0a0',
    festive: false,
    intensity: 1,
    coneAngle: 0.6,
    duskOnly: true,
    ...presets[kind],
    ...patch,
  } as LightObject;
}

export function makePerson(patch: Partial<PersonObject> & Base = {}): PersonObject {
  return {
    ...base('Persoon', patch),
    type: 'person',
    height: 1.85,
    color: '#3d5a80',
    skinColor: '#d6a97f',
    ...patch,
  } as PersonObject;
}

export function makeMeasure(patch: Partial<MeasureObject> & Base = {}): MeasureObject {
  return {
    ...base('Maat', patch),
    type: 'measure',
    path: [v2(0, 0), v2(2, 0)],
    onPlan: true,
    ...patch,
  } as MeasureObject;
}

/** Human-readable label per object type, used across the UI. */
export const TYPE_LABELS: Record<ObjectType, string> = {
  surface: 'Vlak',
  wall: 'Muur',
  fence: 'Schutting',
  path: 'Pad',
  tile: 'Tegel',
  plant: 'Plant',
  structure: 'Bouwwerk',
  furniture: 'Meubel',
  light: 'Licht',
  person: 'Persoon',
  measure: 'Maat',
};

export function isShaped(object: GardenObject): boolean {
  return (
    object.type === 'surface' ||
    object.type === 'wall' ||
    object.type === 'fence' ||
    object.type === 'path' ||
    object.type === 'measure' ||
    (object.type === 'light' && object.kind === 'string')
  );
}

/** The editable point list of a shaped object, or null. */
export function shapePoints(object: GardenObject): Vec2[] | null {
  switch (object.type) {
    case 'surface':
      return object.points;
    case 'wall':
    case 'fence':
    case 'path':
    case 'measure':
      return object.path;
    case 'light':
      return object.kind === 'string' ? object.path : null;
    default:
      return null;
  }
}

export function isClosedShape(object: GardenObject): boolean {
  return object.type === 'surface';
}
