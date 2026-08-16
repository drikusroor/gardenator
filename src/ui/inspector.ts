/**
 * Property panel for the current selection.
 *
 * Everything the gizmo can do by dragging is also here as a number you can
 * type, because "roughly there" is not good enough when you are ordering
 * paving slabs.
 */

import { PLANT_PRESETS, TYPE_LABELS, blockSpec, isClosedShape, isShaped, shapePoints, tileSpec } from '../core/factory';
import { area, distance, perimeter } from '../core/geometry';
import type { Store } from '../core/store';
import type {
  BlockSpec,
  GardenObject,
  GroundKind,
  PlantSpecies,
  TileSpec,
  Vec2,
} from '../core/types';
import { formatArea, formatShort } from '../core/units';
import { layBlocks, wallHeight } from '../render/build/masonry';
import { pathLength, pathOutline } from '../render/build/path';
import { layTiles } from '../render/build/paving';
import { bulbCount } from '../render/build/lights';
import { colorField, lengthField, numberField, select, slider, textField, toggle } from './controls';
import { ICONS, button, el, note, row, section } from './dom';

export interface InspectorHost {
  store: Store;
  /** Re-renders the panel after a structural change. */
  refresh: () => void;
  /** Applies a change without an undo step; `commit` closes the gesture. */
  live: (id: string, mutate: (object: GardenObject) => void, commit: boolean) => void;
}

type SectionChild = Node | string | null | undefined | false;

/**
 * Collapse state for panel sections, keyed by a stable id and kept outside
 * the render function so it survives the full-panel rebuild that follows
 * every committed edit (see `renderPanels` in app.ts).
 */
const sectionCollapse = new Map<string, boolean>();

function persistentSection(
  key: string,
  title: string,
  children: SectionChild[],
  options: { collapsed?: boolean; actions?: SectionChild[] } = {},
): HTMLElement {
  return section(title, children, {
    collapsed: sectionCollapse.get(key) ?? options.collapsed ?? false,
    onToggle: (collapsed) => sectionCollapse.set(key, collapsed),
    actions: options.actions,
  });
}

const GROUND_OPTIONS: { value: GroundKind; label: string }[] = [
  { value: 'grass', label: 'Gras' },
  { value: 'tiles', label: 'Tegels' },
  { value: 'dirt', label: 'Grond / plantvak' },
  { value: 'mulch', label: 'Houtsnippers' },
  { value: 'gravel', label: 'Grind' },
  { value: 'deck', label: 'Vlonder' },
  { value: 'concrete', label: 'Beton' },
  { value: 'water', label: 'Water' },
];

export function renderInspector(host: InspectorHost): HTMLElement {
  const { store } = host;
  const selected = store.selected;

  if (selected.length === 0) {
    return el('div', { class: 'inspector' }, [
      note('Niets geselecteerd. Klik op een object in de tuin of in de lijst hieronder.'),
    ]);
  }

  if (selected.length > 1) {
    return el('div', { class: 'inspector' }, [
      note(`${selected.length} objecten geselecteerd.`),
      row([
        button({
          label: 'Dupliceer',
          icon: ICONS.copy,
          onClick: () => store.duplicate(store.selection),
        }),
        button({
          label: 'Verwijder',
          icon: ICONS.trash,
          variant: 'danger',
          onClick: () => store.remove(store.selection),
        }),
      ]),
    ]);
  }

  const object = selected[0];
  const unit = store.doc.view.unit;
  const root = el('div', { class: 'inspector' });

  /* ------------------------------------------------------------- identity */
  root.append(
    persistentSection('object', 'Object', [
      textField({
        label: 'Naam',
        value: object.name,
        onChange: (value) => store.patch(object.id, (o) => void (o.name = value)),
      }),
      row([
        el('span', { class: 'tag' }, [TYPE_LABELS[object.type]]),
        toggle({
          label: 'Zichtbaar',
          value: !object.hidden,
          onChange: (value) => store.patch(object.id, (o) => void (o.hidden = !value)),
        }),
        toggle({
          label: 'Vergrendeld',
          value: object.locked,
          onChange: (value) => store.patch(object.id, (o) => void (o.locked = value)),
        }),
      ]),
      row([
        button({ label: 'Dupliceer', icon: ICONS.copy, onClick: () => store.duplicate([object.id]) }),
        button({
          label: 'Verwijder',
          icon: ICONS.trash,
          variant: 'danger',
          onClick: () => store.remove([object.id]),
        }),
      ]),
    ]),
  );

  /* ------------------------------------------------------------ transform */
  root.append(
    persistentSection('placement', 'Plaats', [
      row(
        [
          lengthField({
            label: 'X (naar rechts)',
            value: object.position.x,
            unit,
            onChange: (value) =>
              store.patch(object.id, (o) => void (o.position = { ...o.position, x: value })),
          }),
          lengthField({
            label: 'Z (van huis af)',
            value: object.position.z,
            unit,
            onChange: (value) =>
              store.patch(object.id, (o) => void (o.position = { ...o.position, z: value })),
          }),
        ],
        'row-pair',
      ),
      row(
        [
          lengthField({
            label: 'Hoogte boven maaiveld',
            value: object.elevation,
            unit,
            min: 0,
            onChange: (value) => store.patch(object.id, (o) => void (o.elevation = value)),
          }),
          numberField({
            label: 'Draaiing',
            value: Math.round(((object.rotation * 180) / Math.PI) * 10) / 10,
            step: 5,
            suffix: '°',
            onChange: (value) =>
              store.patch(object.id, (o) => void (o.rotation = (value * Math.PI) / 180)),
          }),
        ],
        'row-pair',
      ),
    ]),
  );

  /* --------------------------------------------------------- type specific */
  switch (object.type) {
    case 'surface':
      root.append(...surfaceSections(host, object));
      break;
    case 'wall':
      root.append(
        persistentSection('wall-main', 'Muur', [
          numberField({
            label: 'Aantal lagen',
            value: object.courses,
            min: 1,
            max: 40,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'wall') o.courses = Math.max(1, Math.round(value));
              }),
          }),
          note(
            `Muurhoogte: ${formatShort(wallHeight(object.block, object.courses))} · lengte ${formatShort(perimeter(object.path, false))}`,
          ),
          toggle({
            label: 'Afdeksteen bovenop',
            value: object.capstone,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'wall') o.capstone = value;
              }),
          }),
        ]),
        blockSection(host, object.block, 'Steen', (mutate, commit) =>
          host.live(
            object.id,
            (o) => {
              if (o.type === 'wall') mutate(o.block);
            },
            commit,
          ),
        ),
        takeOffSection([
          `Stenen nodig: ${layBlocks(object.path, object.block, object.courses, { closed: false }).length} stuks`,
          `Waarvan gezaagd: ${layBlocks(object.path, object.block, object.courses, { closed: false }).filter((b) => b.cut).length}`,
        ]),
      );
      break;
    case 'fence':
      root.append(
        persistentSection('fence-main', 'Schutting', [
          lengthField({
            label: 'Hoogte',
            value: object.height,
            unit,
            min: 0.2,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'fence') o.height = value;
              }),
          }),
          select({
            label: 'Stijl',
            value: object.style,
            options: [
              { value: 'slat', label: 'Horizontale planken' },
              { value: 'picket', label: 'Verticale planken' },
              { value: 'panel', label: 'Dicht paneel' },
              { value: 'trellis', label: 'Trellis' },
              { value: 'wire', label: 'Draad' },
            ],
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'fence') o.style = value;
              }),
          }),
          row(
            [
              lengthField({
                label: 'Paalafstand',
                value: object.postSpacing,
                unit,
                min: 0.3,
                onChange: (value) =>
                  store.patch(object.id, (o) => {
                    if (o.type === 'fence') o.postSpacing = value;
                  }),
              }),
              lengthField({
                label: 'Paaldikte',
                value: object.postSize,
                unit,
                min: 0.02,
                onChange: (value) =>
                  store.patch(object.id, (o) => {
                    if (o.type === 'fence') o.postSize = value;
                  }),
              }),
            ],
            'row-pair',
          ),
          row(
            [
              colorField({
                label: 'Kleur',
                value: object.color,
                onChange: (value, commit) =>
                  host.live(
                    object.id,
                    (o) => {
                      if (o.type === 'fence') o.color = value;
                    },
                    commit,
                  ),
              }),
              colorField({
                label: 'Palen',
                value: object.postColor,
                onChange: (value, commit) =>
                  host.live(
                    object.id,
                    (o) => {
                      if (o.type === 'fence') o.postColor = value;
                    },
                    commit,
                  ),
              }),
            ],
            'row-pair',
          ),
          note(`Lengte: ${formatShort(perimeter(object.path, false))}`),
        ]),
      );
      break;
    case 'path': {
      const outline = pathOutline(object);
      root.append(
        persistentSection('path-main', 'Pad', [
          lengthField({
            label: 'Breedte',
            value: object.width,
            unit,
            min: 0.1,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'path') o.width = value;
              }),
          }),
          toggle({
            label: 'Vloeiende bocht',
            value: object.curved,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'path') o.curved = value;
              }),
          }),
          toggle({
            label: 'Losse stapstenen',
            value: object.steppingStones,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'path') o.steppingStones = value;
              }),
          }),
          object.steppingStones
            ? lengthField({
                label: 'Tussenruimte',
                value: object.stoneSpacing,
                unit,
                min: 0,
                onChange: (value) =>
                  store.patch(object.id, (o) => {
                    if (o.type === 'path') o.stoneSpacing = value;
                  }),
              })
            : null,
          note(
            `Lengte ${formatShort(pathLength(object))} · oppervlak ${formatArea(area(outline))}`,
          ),
        ]),
        tileSection(host, object.tile, 'Tegel', (mutate, commit) =>
          host.live(
            object.id,
            (o) => {
              if (o.type === 'path') mutate(o.tile);
            },
            commit,
          ),
        ),
        takeOffSection([
          `Tegels nodig: ${outline.length >= 3 ? layTiles(outline, object.tile, 0).length : 0} stuks`,
        ]),
      );
      break;
    }
    case 'tile':
      root.append(
        tileSection(host, object.tile, 'Tegel', (mutate, commit) =>
          host.live(
            object.id,
            (o) => {
              if (o.type === 'tile') mutate(o.tile);
            },
            commit,
          ),
        ),
      );
      break;
    case 'plant':
      root.append(
        persistentSection('plant-main', 'Plant', [
          select({
            label: 'Soort',
            value: object.species,
            options: Object.entries(PLANT_PRESETS).map(([value, preset]) => ({
              value: value as PlantSpecies,
              label: `${preset.group} — ${preset.label}`,
            })),
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type !== 'plant') return;
                const preset = PLANT_PRESETS[value];
                o.species = value;
                o.height = preset.height;
                o.spread = preset.spread;
                o.count = preset.count;
                o.name = preset.label;
              }),
          }),
          row(
            [
              lengthField({
                label: 'Hoogte',
                value: object.height,
                unit,
                min: 0.05,
                onChange: (value) =>
                  store.patch(object.id, (o) => {
                    if (o.type === 'plant') o.height = value;
                  }),
              }),
              lengthField({
                label: 'Breedte',
                value: object.spread,
                unit,
                min: 0.05,
                onChange: (value) =>
                  store.patch(object.id, (o) => {
                    if (o.type === 'plant') o.spread = value;
                  }),
              }),
            ],
            'row-pair',
          ),
          numberField({
            label: 'Aantal in de pol',
            value: object.count,
            min: 1,
            max: 60,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'plant') o.count = Math.max(1, Math.round(value));
              }),
          }),
          toggle({
            label: 'In een pot',
            value: object.potted,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'plant') o.potted = value;
              }),
          }),
          object.potted
            ? colorField({
                label: 'Potkleur',
                value: object.potColor,
                onChange: (value, commit) =>
                  host.live(
                    object.id,
                    (o) => {
                      if (o.type === 'plant') o.potColor = value;
                    },
                    commit,
                  ),
              })
            : null,
          button({
            label: 'Andere vorm',
            title: 'Zelfde soort, andere willekeurige groei',
            onClick: () =>
              store.patch(object.id, (o) => {
                if (o.type === 'plant') o.seed = Math.floor(Math.random() * 100000) + 1;
              }),
          }),
        ]),
      );
      break;
    case 'structure':
      root.append(...structureSections(host, object));
      break;
    case 'furniture':
      root.append(
        persistentSection('furniture-main', 'Meubel', [
          row(
            [
              lengthField({
                label: 'Breedte',
                value: object.width,
                unit,
                min: 0.05,
                onChange: (value) =>
                  store.patch(object.id, (o) => {
                    if (o.type === 'furniture') o.width = value;
                  }),
              }),
              lengthField({
                label: 'Diepte',
                value: object.depth,
                unit,
                min: 0.05,
                onChange: (value) =>
                  store.patch(object.id, (o) => {
                    if (o.type === 'furniture') o.depth = value;
                  }),
              }),
            ],
            'row-pair',
          ),
          lengthField({
            label: 'Hoogte',
            value: object.height,
            unit,
            min: 0.05,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'furniture') o.height = value;
              }),
          }),
          row(
            [
              colorField({
                label: 'Kleur',
                value: object.color,
                onChange: (value, commit) =>
                  host.live(
                    object.id,
                    (o) => {
                      if (o.type === 'furniture') o.color = value;
                    },
                    commit,
                  ),
              }),
              colorField({
                label: 'Accent',
                value: object.accentColor,
                onChange: (value, commit) =>
                  host.live(
                    object.id,
                    (o) => {
                      if (o.type === 'furniture') o.accentColor = value;
                    },
                    commit,
                  ),
              }),
            ],
            'row-pair',
          ),
        ]),
      );
      break;
    case 'light':
      root.append(
        persistentSection('light-main', 'Verlichting', [
          lengthField({
            label: object.kind === 'string' ? 'Ophanghoogte' : 'Hoogte',
            value: object.height,
            unit,
            min: 0.02,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'light') o.height = value;
              }),
          }),
          colorField({
            label: 'Lichtkleur',
            value: object.color,
            onChange: (value, commit) =>
              host.live(
                object.id,
                (o) => {
                  if (o.type === 'light') o.color = value;
                },
                commit,
              ),
          }),
          slider({
            label: 'Sterkte',
            value: object.intensity,
            min: 0.1,
            max: 3,
            step: 0.1,
            format: (value) => `${value.toFixed(1)}×`,
            onInput: (value, commit) =>
              host.live(
                object.id,
                (o) => {
                  if (o.type === 'light') o.intensity = value;
                },
                commit,
              ),
          }),
          toggle({
            label: 'Alleen aan na zonsondergang',
            value: object.duskOnly,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'light') o.duskOnly = value;
              }),
          }),
          object.kind === 'string'
            ? row(
                [
                  lengthField({
                    label: 'Afstand tussen lampjes',
                    value: object.bulbSpacing,
                    unit,
                    min: 0.1,
                    onChange: (value) =>
                      store.patch(object.id, (o) => {
                        if (o.type === 'light') o.bulbSpacing = value;
                      }),
                  }),
                  slider({
                    label: 'Doorhang',
                    value: object.sag,
                    min: 0,
                    max: 0.4,
                    step: 0.01,
                    format: (value) => `${Math.round(value * 100)}%`,
                    onInput: (value, commit) =>
                      host.live(
                        object.id,
                        (o) => {
                          if (o.type === 'light') o.sag = value;
                        },
                        commit,
                      ),
                  }),
                ],
                'row-pair',
              )
            : null,
          object.kind === 'string'
            ? toggle({
                label: 'Gekleurde feestlampjes',
                value: object.festive,
                onChange: (value) =>
                  store.patch(object.id, (o) => {
                    if (o.type === 'light') o.festive = value;
                  }),
              })
            : null,
          object.kind === 'string' ? note(`${bulbCount(object)} lampjes`) : null,
        ]),
      );
      break;
    case 'person':
      root.append(
        persistentSection('person-main', 'Referentiepersoon', [
          lengthField({
            label: 'Lengte',
            value: object.height,
            unit,
            min: 0.5,
            max: 2.5,
            hint: 'Handig om te zien hoe groot alles echt is',
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'person') o.height = value;
              }),
          }),
          colorField({
            label: 'Kleding',
            value: object.color,
            onChange: (value, commit) =>
              host.live(
                object.id,
                (o) => {
                  if (o.type === 'person') o.color = value;
                },
                commit,
              ),
          }),
        ]),
      );
      break;
    case 'measure':
      root.append(
        persistentSection('measure-main', 'Maat', [
          note(
            object.path.length > 2
              ? `${object.path.length - 1} stukken · totaal ${formatShort(perimeter(object.path, false))}`
              : object.path.length === 2
                ? `Afstand: ${formatShort(distance(object.path[0], object.path[1]))}`
                : 'Sleep de punten om te meten',
          ),
          note(
            'Sleep de gele bolletjes om te verplaatsen, klik een groen ruitje op een stuk om er een punt aan toe te voegen — handig als meetlat om iets uit te zetten.',
          ),
          toggle({
            label: 'Tonen op de plattegrond',
            value: object.onPlan,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'measure') o.onPlan = value;
              }),
          }),
        ]),
      );
      break;
  }

  if (isShaped(object)) {
    const vertices = verticesSection(host, object);
    if (vertices) root.append(vertices);
  }

  return root;
}

/* -------------------------------------------------------------------------- */
/* Exact coordinates                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Lets a shape be typed in exactly instead of only dragged into place —
 * dragging a corner or the scale gizmo by eye is what turns a "5 metre"
 * patch into 5.02 or 4.97. A plain rectangle gets a width/depth shortcut, a
 * straight two-point path (wall, fence, string light) gets a single length,
 * and anything else falls back to per-corner X/Z fields.
 */
function verticesSection(host: InspectorHost, object: GardenObject): HTMLElement | null {
  const points = shapePoints(object);
  if (!points || points.length === 0) return null;
  const { store } = host;
  const unit = store.doc.view.unit;
  const closed = isClosedShape(object);
  const rows: SectionChild[] = [];

  const rect = closed ? rectangleSize(points) : null;
  if (rect) {
    rows.push(
      row(
        [
          lengthField({
            label: 'Breedte',
            value: rect.width,
            unit,
            min: 0.05,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                const p = shapePoints(o);
                if (p) resizeRectangle(p, value, rect.depth, rect.center);
              }),
          }),
          lengthField({
            label: 'Diepte',
            value: rect.depth,
            unit,
            min: 0.05,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                const p = shapePoints(o);
                if (p) resizeRectangle(p, rect.width, value, rect.center);
              }),
          }),
        ],
        'row-pair',
      ),
      note('Rekt symmetrisch rond het midden van het vlak.'),
    );
  } else if (!closed && points.length === 2) {
    rows.push(
      lengthField({
        label: 'Lengte',
        value: distance(points[0], points[1]),
        unit,
        min: 0.02,
        onChange: (value) =>
          store.patch(object.id, (o) => {
            const p = shapePoints(o);
            if (p) resizeSegment(p, value);
          }),
      }),
    );
  } else {
    points.forEach((point, index) => {
      rows.push(
        row(
          [
            lengthField({
              label: `Punt ${index + 1} · X`,
              value: point.x,
              unit,
              onChange: (value) =>
                store.patch(object.id, (o) => {
                  const p = shapePoints(o);
                  if (p?.[index]) p[index] = { ...p[index], x: value };
                }),
            }),
            lengthField({
              label: `Punt ${index + 1} · Z`,
              value: point.z,
              unit,
              onChange: (value) =>
                store.patch(object.id, (o) => {
                  const p = shapePoints(o);
                  if (p?.[index]) p[index] = { ...p[index], z: value };
                }),
            }),
          ],
          'row-pair',
        ),
      );
    });
  }

  return persistentSection('vertices', 'Hoekpunten (exact)', rows, { collapsed: true });
}

/** Detects a plain axis-aligned rectangle so it can be resized by width/depth. */
function rectangleSize(points: Vec2[]): { width: number; depth: number; center: Vec2 } | null {
  if (points.length !== 4) return null;
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const width = maxX - minX;
  const depth = maxZ - minZ;
  if (width < 0.05 || depth < 0.05) return null;

  const eps = 0.01;
  const corners = new Set<string>();
  for (const p of points) {
    const onMinX = Math.abs(p.x - minX) < eps;
    const onMaxX = Math.abs(p.x - maxX) < eps;
    const onMinZ = Math.abs(p.z - minZ) < eps;
    const onMaxZ = Math.abs(p.z - maxZ) < eps;
    if (!((onMinX || onMaxX) && (onMinZ || onMaxZ))) return null;
    corners.add(`${onMaxX ? 1 : 0}:${onMaxZ ? 1 : 0}`);
  }
  // Four points each on a distinct corner — anything else is not a rectangle.
  if (corners.size !== 4) return null;

  return { width, depth, center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 } };
}

/** Rewrites a rectangle's corners to a new size, stretched from its centre. */
function resizeRectangle(points: Vec2[], width: number, depth: number, center: Vec2) {
  const hw = width / 2;
  const hd = depth / 2;
  for (const p of points) {
    const signX = p.x >= center.x ? 1 : -1;
    const signZ = p.z >= center.z ? 1 : -1;
    p.x = center.x + signX * hw;
    p.z = center.z + signZ * hd;
  }
}

/** Rewrites a two-point path's length, keeping the start point and heading. */
function resizeSegment(points: Vec2[], length: number) {
  const [a, b] = points;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const current = Math.hypot(dx, dz);
  const [ux, uz] = current > 1e-6 ? [dx / current, dz / current] : [1, 0];
  points[1] = { x: a.x + ux * length, z: a.z + uz * length };
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

function surfaceSections(
  host: InspectorHost,
  object: Extract<GardenObject, { type: 'surface' }>,
): HTMLElement[] {
  const { store } = host;
  const unit = store.doc.view.unit;
  const sections: HTMLElement[] = [];

  sections.push(
    persistentSection('surface-main', 'Vlak', [
      select({
        label: 'Materiaal',
        value: object.ground.kind,
        options: GROUND_OPTIONS,
        onChange: (value) =>
          store.patch(object.id, (o) => {
            if (o.type !== 'surface') return;
            o.ground.kind = value;
            // Give tiled and decked surfaces a sensible unit to start from.
            if ((value === 'tiles' || value === 'deck') && !o.ground.tile) {
              o.ground.tile =
                value === 'deck'
                  ? tileSpec({
                      name: 'Vlonderplank 200×14',
                      width: 2,
                      depth: 0.14,
                      thickness: 0.028,
                      color: '#8a6a45',
                      pattern: 'running',
                      texture: 'wood',
                      jointColor: '#3a2f24',
                    })
                  : tileSpec();
            }
            o.ground.color = undefined;
          }),
      }),
      object.ground.kind !== 'tiles'
        ? colorField({
            label: 'Kleur',
            value: object.ground.color ?? '#5f8542',
            onChange: (value, commit) =>
              host.live(
                object.id,
                (o) => {
                  if (o.type === 'surface') o.ground.color = value;
                },
                commit,
              ),
          })
        : null,
      lengthField({
        label: 'Verhoging (opgehoogd vlak)',
        value: object.raise,
        unit,
        min: 0,
        hint: 'Bijvoorbeeld een verhoogd plantvak',
        onChange: (value) =>
          store.patch(object.id, (o) => {
            if (o.type === 'surface') o.raise = value;
          }),
      }),
      object.ground.kind === 'grass'
        ? slider({
            label: 'Grasdichtheid',
            value: object.ground.scatter ?? 1,
            min: 0,
            max: 2,
            step: 0.1,
            format: (value) => `${Math.round(value * 100)}%`,
            onInput: (value, commit) =>
              host.live(
                object.id,
                (o) => {
                  if (o.type === 'surface') o.ground.scatter = value;
                },
                commit,
              ),
          })
        : null,
      numberField({
        label: 'Patroonrichting',
        value: Math.round((((object.ground.patternAngle ?? 0) * 180) / Math.PI) * 10) / 10,
        step: 15,
        suffix: '°',
        onChange: (value) =>
          store.patch(object.id, (o) => {
            if (o.type === 'surface') o.ground.patternAngle = (value * Math.PI) / 180;
          }),
      }),
      note(
        `Oppervlak ${formatArea(area(object.points))} · omtrek ${formatShort(perimeter(object.points, true))} · ${object.points.length} hoekpunten`,
      ),
    ]),
  );

  if (object.ground.kind === 'tiles' || object.ground.kind === 'deck') {
    const spec = object.ground.tile ?? tileSpec();
    sections.push(
      tileSection(host, spec, object.ground.kind === 'deck' ? 'Plank' : 'Tegel', (mutate, commit) =>
        host.live(
          object.id,
          (o) => {
            if (o.type !== 'surface') return;
            if (!o.ground.tile) o.ground.tile = tileSpec();
            mutate(o.ground.tile);
          },
          commit,
        ),
      ),
    );
    sections.push(
      takeOffSection([
        `Tegels nodig: ${layTiles(object.points, spec, object.ground.patternAngle ?? 0).length} stuks`,
        `Oppervlak: ${formatArea(area(object.points))}`,
      ]),
    );
  }

  /* --------------------------------------------------------- retaining wall */
  const edgeCount = object.points.length;
  sections.push(
    persistentSection('surface-edging', 'Randmuur (stapelblokken)', [
      toggle({
        label: 'Muur rondom dit vlak',
        value: object.edging.enabled,
        onChange: (value) =>
          store.patch(object.id, (o) => {
            if (o.type === 'surface') o.edging.enabled = value;
          }),
      }),
      object.edging.enabled
        ? numberField({
            label: 'Aantal lagen',
            value: object.edging.courses,
            min: 1,
            max: 20,
            onChange: (value) =>
              store.patch(object.id, (o) => {
                if (o.type === 'surface') o.edging.courses = Math.max(1, Math.round(value));
              }),
          })
        : null,
      object.edging.enabled
        ? note(
            `Muurhoogte ${formatShort(wallHeight(object.edging.block, object.edging.courses))} · ${layBlocks(object.points, object.edging.block, object.edging.courses, {
              closed: true,
              skipEdges: object.edging.openEdges,
            }).length} blokken`,
          )
        : null,
      object.edging.enabled
        ? el(
            'div',
            { class: 'edge-toggles' },
            [
              el('span', { class: 'field-label' }, ['Zijden zonder muur']),
              el(
                'div',
                { class: 'chip-row' },
                Array.from({ length: edgeCount }, (_, i) =>
                  el(
                    'button',
                    {
                      type: 'button',
                      class: `chip${object.edging.openEdges.includes(i) ? ' is-active' : ''}`,
                      on: {
                        click: () =>
                          store.patch(object.id, (o) => {
                            if (o.type !== 'surface') return;
                            const open = o.edging.openEdges;
                            const at = open.indexOf(i);
                            if (at >= 0) open.splice(at, 1);
                            else open.push(i);
                          }),
                      },
                    },
                    [String(i + 1)],
                  ),
                ),
              ),
            ],
          )
        : null,
    ]),
  );

  if (object.edging.enabled) {
    sections.push(
      blockSection(host, object.edging.block, 'Stapelblok', (mutate, commit) =>
        host.live(
          object.id,
          (o) => {
            if (o.type === 'surface') mutate(o.edging.block);
          },
          commit,
        ),
      ),
    );
  }

  return sections;
}

/* -------------------------------------------------------------------------- */
/* Structures                                                                 */
/* -------------------------------------------------------------------------- */

function structureSections(
  host: InspectorHost,
  object: Extract<GardenObject, { type: 'structure' }>,
): HTMLElement[] {
  const { store } = host;
  const unit = store.doc.view.unit;
  const patch = (mutate: (o: Extract<GardenObject, { type: 'structure' }>) => void) =>
    store.patch(object.id, (o) => {
      if (o.type === 'structure') mutate(o);
    });

  const sections: HTMLElement[] = [
    persistentSection('structure-dimensions', 'Afmetingen', [
      row(
        [
          lengthField({
            label: 'Breedte',
            value: object.width,
            unit,
            min: 0.2,
            onChange: (value) => patch((o) => void (o.width = value)),
          }),
          lengthField({
            label: 'Diepte',
            value: object.depth,
            unit,
            min: 0.1,
            onChange: (value) => patch((o) => void (o.depth = value)),
          }),
        ],
        'row-pair',
      ),
      lengthField({
        label: 'Muurhoogte',
        value: object.height,
        unit,
        min: 0.2,
        onChange: (value) => patch((o) => void (o.height = value)),
      }),
      select({
        label: 'Materiaal',
        value: object.material,
        options: [
          { value: 'brick', label: 'Baksteen' },
          { value: 'wood', label: 'Hout' },
          { value: 'render', label: 'Stucwerk' },
          { value: 'metal', label: 'Metaal' },
        ],
        onChange: (value) => patch((o) => void (o.material = value)),
      }),
      colorField({
        label: 'Kleur',
        value: object.color,
        onChange: (value, commit) =>
          host.live(
            object.id,
            (o) => {
              if (o.type === 'structure') o.color = value;
            },
            commit,
          ),
      }),
    ]),
  ];

  if (object.kind !== 'raised-planter') {
    sections.push(
      persistentSection('structure-roof', 'Dak', [
        select({
          label: 'Daktype',
          value: object.roof,
          options: [
            { value: 'mono-pitch', label: 'Lessenaarsdak (schuin)' },
            { value: 'gable', label: 'Zadeldak' },
            { value: 'flat', label: 'Plat dak' },
            { value: 'none', label: 'Geen dak' },
          ],
          onChange: (value) => patch((o) => void (o.roof = value)),
        }),
        object.roof !== 'none' && object.roof !== 'flat'
          ? lengthField({
              label: 'Hoogteverschil dak',
              value: object.roofRise,
              unit,
              min: 0,
              onChange: (value) => patch((o) => void (o.roofRise = value)),
            })
          : null,
        object.roof !== 'none'
          ? lengthField({
              label: 'Dakoverstek',
              value: object.roofOverhang,
              unit,
              min: 0,
              onChange: (value) => patch((o) => void (o.roofOverhang = value)),
            })
          : null,
        object.roof !== 'none'
          ? colorField({
              label: 'Dakkleur',
              value: object.roofColor,
              onChange: (value, commit) =>
                host.live(
                  object.id,
                  (o) => {
                    if (o.type === 'structure') o.roofColor = value;
                  },
                  commit,
                ),
            })
          : null,
        object.roof === 'mono-pitch'
          ? note(
              `Nokhoogte ${formatShort(object.height + object.roofRise)} · helling ${(
                (Math.atan2(object.roofRise, object.depth) * 180) /
                Math.PI
              ).toFixed(1)}°`,
            )
          : null,
      ]),
      persistentSection('structure-door-window', 'Deur en raam', [
        toggle({
          label: 'Deur',
          value: object.door,
          onChange: (value) => patch((o) => void (o.door = value)),
        }),
        object.door
          ? row(
              [
                lengthField({
                  label: 'Deurbreedte',
                  value: object.doorWidth,
                  unit,
                  min: 0.3,
                  onChange: (value) => patch((o) => void (o.doorWidth = value)),
                }),
                lengthField({
                  label: 'Deurhoogte',
                  value: object.doorHeight,
                  unit,
                  min: 0.5,
                  onChange: (value) => patch((o) => void (o.doorHeight = value)),
                }),
              ],
              'row-pair',
            )
          : null,
        object.door
          ? slider({
              label: 'Positie deur',
              value: object.doorOffset,
              min: 0.05,
              max: 0.95,
              step: 0.01,
              format: (value) => `${Math.round(value * 100)}%`,
              onInput: (value, commit) =>
                host.live(
                  object.id,
                  (o) => {
                    if (o.type === 'structure') o.doorOffset = value;
                  },
                  commit,
                ),
            })
          : null,
        toggle({
          label: 'Raam',
          value: object.window,
          onChange: (value) => patch((o) => void (o.window = value)),
        }),
        object.window
          ? row(
              [
                lengthField({
                  label: 'Raambreedte',
                  value: object.windowWidth,
                  unit,
                  min: 0.2,
                  onChange: (value) => patch((o) => void (o.windowWidth = value)),
                }),
                lengthField({
                  label: 'Raamhoogte',
                  value: object.windowHeight,
                  unit,
                  min: 0.2,
                  onChange: (value) => patch((o) => void (o.windowHeight = value)),
                }),
              ],
              'row-pair',
            )
          : null,
        object.window
          ? lengthField({
              label: 'Onderkant raam',
              value: object.windowSill,
              unit,
              min: 0,
              onChange: (value) => patch((o) => void (o.windowSill = value)),
            })
          : null,
        object.window
          ? slider({
              label: 'Positie raam',
              value: object.windowOffset,
              min: 0.05,
              max: 0.95,
              step: 0.01,
              format: (value) => `${Math.round(value * 100)}%`,
              onInput: (value, commit) =>
                host.live(
                  object.id,
                  (o) => {
                    if (o.type === 'structure') o.windowOffset = value;
                  },
                  commit,
                ),
            })
          : null,
      ]),
    );
  }

  if (object.material === 'brick') {
    sections.push(
      blockSection(host, object.block, 'Metselsteen', (mutate, commit) =>
        host.live(
          object.id,
          (o) => {
            if (o.type === 'structure') mutate(o.block);
          },
          commit,
        ),
      ),
    );
  }

  return sections;
}

/* -------------------------------------------------------------------------- */
/* Shared material editors                                                    */
/* -------------------------------------------------------------------------- */

type Mutator<T> = (mutate: (spec: T) => void, commit: boolean) => void;

export function blockSection(
  host: InspectorHost,
  spec: BlockSpec,
  title: string,
  apply: Mutator<BlockSpec>,
): HTMLElement {
  const unit = host.store.doc.view.unit;
  return persistentSection(
    `block:${spec.id}`,
    `${title} — ${spec.name}`,
    [
      textField({
        label: 'Naam',
        value: spec.name,
        onChange: (value) => apply((s) => void (s.name = value), true),
      }),
      row(
        [
          lengthField({
            label: 'Lengte',
            value: spec.length,
            unit,
            min: 0.02,
            onChange: (value) => apply((s) => void (s.length = value), true),
          }),
          lengthField({
            label: 'Hoogte',
            value: spec.height,
            unit,
            min: 0.02,
            onChange: (value) => apply((s) => void (s.height = value), true),
          }),
        ],
        'row-pair',
      ),
      row(
        [
          lengthField({
            label: 'Diepte',
            value: spec.depth,
            unit,
            min: 0.02,
            onChange: (value) => apply((s) => void (s.depth = value), true),
          }),
          lengthField({
            label: 'Voeg',
            value: spec.joint,
            unit,
            min: 0,
            hint: '0 voor droog stapelen',
            onChange: (value) => apply((s) => void (s.joint = value), true),
          }),
        ],
        'row-pair',
      ),
      row(
        [
          colorField({
            label: 'Kleur',
            value: spec.color,
            onChange: (value, commit) => apply((s) => void (s.color = value), commit),
          }),
          colorField({
            label: 'Voegkleur',
            value: spec.jointColor,
            onChange: (value, commit) => apply((s) => void (s.jointColor = value), commit),
          }),
        ],
        'row-pair',
      ),
      select({
        label: 'Structuur',
        value: spec.texture,
        options: [
          { value: 'split', label: 'Gebroken (stapelblok)' },
          { value: 'rough', label: 'Ruw' },
          { value: 'smooth', label: 'Glad' },
          { value: 'brick', label: 'Baksteen' },
        ],
        onChange: (value) => apply((s) => void (s.texture = value), true),
      }),
      slider({
        label: 'Verspringing per laag',
        value: spec.bondOffset,
        min: 0,
        max: 0.5,
        step: 0.05,
        format: (value) => `${Math.round(value * 100)}%`,
        onInput: (value, commit) => apply((s) => void (s.bondOffset = value), commit),
      }),
      row([
        button({
          label: 'Uit bibliotheek',
          icon: ICONS.layers,
          onClick: () => host.refresh(),
          title: 'Kies een opgeslagen sjabloon in het paneel Sjablonen',
        }),
        button({
          label: 'Opslaan als sjabloon',
          icon: ICONS.save,
          onClick: () => {
            host.store.update((doc) => {
              doc.templates.blocks.push({ ...spec, id: blockSpec().id });
            });
            host.refresh();
          },
        }),
      ]),
    ],
    { collapsed: true },
  );
}

export function tileSection(
  host: InspectorHost,
  spec: TileSpec,
  title: string,
  apply: Mutator<TileSpec>,
): HTMLElement {
  const unit = host.store.doc.view.unit;
  return persistentSection(
    `tile:${spec.id}`,
    `${title} — ${spec.name}`,
    [
      textField({
        label: 'Naam',
        value: spec.name,
        onChange: (value) => apply((s) => void (s.name = value), true),
      }),
      select({
        label: 'Vorm',
        value: spec.shape,
        options: [
          { value: 'rect', label: 'Rechthoekig' },
          { value: 'round', label: 'Rond' },
          { value: 'hex', label: 'Zeshoekig' },
        ],
        onChange: (value) => apply((s) => void (s.shape = value), true),
      }),
      row(
        [
          lengthField({
            label: spec.shape === 'round' ? 'Doorsnede' : 'Breedte',
            value: spec.width,
            unit,
            min: 0.02,
            onChange: (value) =>
              apply((s) => {
                s.width = value;
                if (s.shape === 'round') s.depth = value;
              }, true),
          }),
          lengthField({
            label: 'Diepte',
            value: spec.depth,
            unit,
            min: 0.02,
            disabled: spec.shape === 'round',
            onChange: (value) => apply((s) => void (s.depth = value), true),
          }),
        ],
        'row-pair',
      ),
      row(
        [
          lengthField({
            label: 'Dikte',
            value: spec.thickness,
            unit,
            min: 0.005,
            onChange: (value) => apply((s) => void (s.thickness = value), true),
          }),
          lengthField({
            label: 'Voeg',
            value: spec.gap,
            unit,
            min: 0,
            onChange: (value) => apply((s) => void (s.gap = value), true),
          }),
        ],
        'row-pair',
      ),
      row(
        [
          colorField({
            label: 'Kleur',
            value: spec.color,
            onChange: (value, commit) => apply((s) => void (s.color = value), commit),
          }),
          colorField({
            label: 'Voegkleur',
            value: spec.jointColor,
            onChange: (value, commit) => apply((s) => void (s.jointColor = value), commit),
          }),
        ],
        'row-pair',
      ),
      select({
        label: 'Legpatroon',
        value: spec.pattern,
        options: [
          { value: 'grid', label: 'Recht (blokverband)' },
          { value: 'running', label: 'Halfsteens' },
          { value: 'herringbone', label: 'Visgraat' },
          { value: 'basketweave', label: 'Mandweefsel' },
          { value: 'stack', label: 'Strak gestapeld' },
        ],
        onChange: (value) => apply((s) => void (s.pattern = value), true),
      }),
      select({
        label: 'Structuur',
        value: spec.texture,
        options: [
          { value: 'slate', label: 'Leisteen' },
          { value: 'concrete', label: 'Beton' },
          { value: 'clay', label: 'Gebakken klei' },
          { value: 'wood', label: 'Hout' },
          { value: 'smooth', label: 'Glad' },
        ],
        onChange: (value) => apply((s) => void (s.texture = value), true),
      }),
      button({
        label: 'Opslaan als sjabloon',
        icon: ICONS.save,
        onClick: () => {
          host.store.update((doc) => {
            doc.templates.tiles.push({ ...spec, id: tileSpec().id });
          });
          host.refresh();
        },
      }),
    ],
    { collapsed: true },
  );
}

function takeOffSection(lines: string[]): HTMLElement {
  return persistentSection(
    'takeoff',
    'Materiaal',
    lines.map((line) => note(line)),
  );
}
