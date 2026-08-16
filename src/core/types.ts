/**
 * Scene document model.
 *
 * Every length in this file is stored in METRES. The UI converts to/from
 * centimetres for display and input, but nothing below `src/ui` should ever
 * deal with centimetres — that way a measurement can never drift by a factor
 * of 100 depending on which code path wrote it.
 *
 * The ground plane is XZ: +x runs east, +z runs south, +y is up. `rotation`
 * is always radians about the Y axis, measured clockwise when seen from above.
 */

export interface Vec2 {
  x: number;
  z: number;
}

/** A stackable block / brick used to build walls. Dutch: stapelblok. */
export interface BlockSpec {
  id: string;
  name: string;
  /** Along the wall run. */
  length: number;
  /** One course. */
  height: number;
  /** Across the wall run. */
  depth: number;
  color: string;
  /** Joint width between blocks; 0 for dry-stacked blocks. */
  joint: number;
  jointColor: string;
  /** Half-block offset per course, 0..1. 0.5 = classic running bond. */
  bondOffset: number;
  texture: 'smooth' | 'rough' | 'brick' | 'split';
}

/** A paving unit used for floors and paths. */
export interface TileSpec {
  id: string;
  name: string;
  shape: 'rect' | 'round' | 'hex';
  width: number;
  depth: number;
  thickness: number;
  color: string;
  /** Gap between tiles, filled with the joint colour. */
  gap: number;
  jointColor: string;
  pattern: 'grid' | 'running' | 'herringbone' | 'basketweave' | 'stack';
  texture: 'smooth' | 'slate' | 'concrete' | 'clay' | 'wood';
}

export type GroundKind =
  | 'tiles'
  | 'grass'
  | 'dirt'
  | 'mulch'
  | 'gravel'
  | 'deck'
  | 'water'
  | 'concrete';

export interface GroundSpec {
  kind: GroundKind;
  /** Only used when kind === 'tiles'; otherwise the kind picks the look. */
  tile?: TileSpec;
  /** Overrides the default colour for non-tiled ground. */
  color?: string;
  /** Rotation of the paving pattern within the surface, radians. */
  patternAngle?: number;
  /** Density multiplier for grass tufts / mulch chips, 0..2. */
  scatter?: number;
}

/** Retaining edge around a raised surface. */
export interface EdgingSpec {
  enabled: boolean;
  block: BlockSpec;
  /** Number of courses; the wall height is courses * block.height. */
  courses: number;
  /** Sides of the polygon to skip, by edge index (e.g. an open side). */
  openEdges: number[];
}

interface ObjectBase {
  id: string;
  name: string;
  /** Local origin on the ground plane. */
  position: Vec2;
  /** Radians about Y. */
  rotation: number;
  /** Metres above the site datum (0 = original ground level). */
  elevation: number;
  locked: boolean;
  hidden: boolean;
}

/** A region of ground: a lawn, a tiled floor, a raised planting bed. */
export interface SurfaceObject extends ObjectBase {
  type: 'surface';
  /** Polygon outline, in local coordinates, counter-clockwise or clockwise. */
  points: Vec2[];
  ground: GroundSpec;
  /** Height of the fill above `elevation` — a raised bed is a positive value. */
  raise: number;
  edging: EdgingSpec;
}

/** A free-standing wall following a polyline. */
export interface WallObject extends ObjectBase {
  type: 'wall';
  path: Vec2[];
  block: BlockSpec;
  courses: number;
  /** A flat coping stone on top. */
  capstone: boolean;
  capstoneOverhang: number;
}

export interface FenceObject extends ObjectBase {
  type: 'fence';
  path: Vec2[];
  height: number;
  style: 'picket' | 'slat' | 'panel' | 'trellis' | 'wire';
  postSpacing: number;
  postSize: number;
  color: string;
  postColor: string;
}

/** A walkable path laid on top of whatever surface is underneath. */
export interface PathObject extends ObjectBase {
  type: 'path';
  /** Control points; sampled as a centripetal Catmull-Rom curve when curved. */
  path: Vec2[];
  curved: boolean;
  width: number;
  tile: TileSpec;
  /** Lay tiles as separate stepping stones instead of a continuous band. */
  steppingStones: boolean;
  /** Gap between stepping stones, along the path. */
  stoneSpacing: number;
}

/** A single paving unit placed by hand. */
export interface TileObject extends ObjectBase {
  type: 'tile';
  tile: TileSpec;
}

export type PlantSpecies =
  | 'pear-tree'
  | 'apple-tree'
  | 'birch'
  | 'conifer'
  | 'olive'
  | 'bush'
  | 'box-ball'
  | 'lavender'
  | 'grass-tuft'
  | 'fern'
  | 'hosta'
  | 'flower-bed'
  | 'tulips'
  | 'rose'
  | 'herb'
  | 'bamboo'
  | 'climber';

export interface PlantObject extends ObjectBase {
  type: 'plant';
  species: PlantSpecies;
  /** Overall height in metres — the model scales to match. */
  height: number;
  /** Canopy / clump diameter in metres. */
  spread: number;
  /** >1 scatters a clump of this many within `spread`. */
  count: number;
  potted: boolean;
  potColor: string;
  /** Deterministic variation so a plant looks the same on every reload. */
  seed: number;
}

export interface StructureObject extends ObjectBase {
  type: 'structure';
  kind: 'shed' | 'house-wall' | 'pergola' | 'raised-planter';
  width: number;
  depth: number;
  /** Wall height at the low eave. */
  height: number;
  material: 'brick' | 'wood' | 'render' | 'metal';
  color: string;
  roof: 'mono-pitch' | 'gable' | 'flat' | 'none';
  /** Rise across the roof span, metres. */
  roofRise: number;
  roofColor: string;
  roofOverhang: number;
  door: boolean;
  doorWidth: number;
  doorHeight: number;
  /** Position of the door along the front wall, 0..1. */
  doorOffset: number;
  window: boolean;
  windowWidth: number;
  windowHeight: number;
  windowOffset: number;
  windowSill: number;
  /** Brick used when material === 'brick'. */
  block: BlockSpec;
}

export interface FurnitureObject extends ObjectBase {
  type: 'furniture';
  kind:
    | 'dining-table'
    | 'coffee-table'
    | 'chair'
    | 'bench'
    | 'lounger'
    | 'parasol'
    | 'planter-box'
    | 'bbq'
    | 'firepit';
  width: number;
  depth: number;
  height: number;
  color: string;
  accentColor: string;
}

export interface LightObject extends ObjectBase {
  type: 'light';
  kind: 'spot' | 'post' | 'wall' | 'string' | 'lantern';
  /** Anchor points for `string` lights; the cable hangs between them. */
  path: Vec2[];
  /** Suspension height for string lights, mounting height for the rest. */
  height: number;
  /** Cable slack as a fraction of span length. */
  sag: number;
  /** Bulbs per metre of cable. */
  bulbSpacing: number;
  color: string;
  /** Multi-coloured festoon bulbs. */
  festive: boolean;
  intensity: number;
  /** Beam half-angle in radians, for spots. */
  coneAngle: number;
  /** Only on after sunset. */
  duskOnly: boolean;
}

/** A human figure, purely as a sense-of-scale reference. */
export interface PersonObject extends ObjectBase {
  type: 'person';
  height: number;
  color: string;
  skinColor: string;
}

/** A stand-alone dimension annotation between two points. */
export interface MeasureObject extends ObjectBase {
  type: 'measure';
  /** Exactly two points, in local coordinates. */
  path: Vec2[];
  /** Show on the 2D plan export. */
  onPlan: boolean;
}

export type GardenObject =
  | SurfaceObject
  | WallObject
  | FenceObject
  | PathObject
  | TileObject
  | PlantObject
  | StructureObject
  | FurnitureObject
  | LightObject
  | PersonObject
  | MeasureObject;

export type ObjectType = GardenObject['type'];

/** Objects whose shape is a polyline/polygon the user can edit vertex by vertex. */
export type ShapedObject =
  | SurfaceObject
  | WallObject
  | FenceObject
  | PathObject
  | LightObject
  | MeasureObject;

export interface SiteSettings {
  /** Plot size, used for the ground plane and the plan sheet. */
  width: number;
  depth: number;
  /**
   * Compass bearing of the -Z direction ("up" on the plan), in degrees.
   * 0 means the top of the plan points north.
   */
  northOffset: number;
  latitude: number;
  longitude: number;
  /** Base ground colour beyond any surface. */
  groundColor: string;
}

export interface EnvironmentSettings {
  /** Day of year, 1..365, drives the sun's declination. */
  dayOfYear: number;
  /** Local solar time in minutes from midnight, 0..1440. */
  timeMinutes: number;
  playing: boolean;
  /** Simulated minutes per real second. */
  speed: number;
  /** 0 = clear, 1 = fully overcast. */
  cloudiness: number;
  showShadows: boolean;
}

export interface ViewSettings {
  cameraMode: 'orbit' | 'fly' | 'walk';
  /** Eye height for walk mode — the "how big is this really" reference. */
  personHeight: number;
  showGrid: boolean;
  /** Grid and drag snap in metres. */
  snap: number;
  showDimensions: boolean;
  showGrass: boolean;
  unit: 'm' | 'cm';
  quality: 'low' | 'medium' | 'high';
}

export interface TemplateLibrary {
  blocks: BlockSpec[];
  tiles: TileSpec[];
}

export interface GardenDoc {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  site: SiteSettings;
  environment: EnvironmentSettings;
  view: ViewSettings;
  templates: TemplateLibrary;
  objects: GardenObject[];
}
