/** The "add something" palette, and the saved-template browser. */

import {
  FURNITURE_PRESETS,
  PLANT_PRESETS,
  makeFurniture,
  makeLight,
  makePerson,
  makePlant,
  makeStructure,
  makeTile,
  tileSpec,
} from '../core/factory';
import type { Store } from '../core/store';
import type {
  BlockSpec,
  FurnitureObject,
  GardenObject,
  LightObject,
  PlantSpecies,
  StructureObject,
  TileSpec,
  Vec2,
} from '../core/types';
import { formatShort } from '../core/units';
import { ICONS, button, el, note, row, section } from './dom';
import type { DrawKind } from '../render/editing';

export interface LibraryHost {
  store: Store;
  /** Starts a click-to-place gesture. */
  place: (label: string, make: (point: Vec2) => GardenObject) => void;
  /** Starts a click-to-draw gesture. */
  draw: (kind: DrawKind) => void;
  refresh: () => void;
}

export function renderLibrary(host: LibraryHost): HTMLElement {
  const root = el('div', { class: 'library' });

  root.append(
    section('Tekenen', [
      note('Klik punten in de tuin, dubbelklik of Enter om af te ronden.'),
      el('div', { class: 'tile-grid' }, [
        paletteButton('Vlak / bestrating', ICONS.square, () => host.draw('surface')),
        paletteButton('Muur', ICONS.wall, () => host.draw('wall')),
        paletteButton('Schutting', ICONS.fence, () => host.draw('fence')),
        paletteButton('Pad', ICONS.path, () => host.draw('path')),
        paletteButton('Lichtslinger', ICONS.bulb, () => host.draw('string-light')),
      ]),
    ]),
  );

  /* ------------------------------------------------------------- planting */
  const groups = new Map<string, PlantSpecies[]>();
  for (const [species, preset] of Object.entries(PLANT_PRESETS)) {
    const list = groups.get(preset.group) ?? [];
    list.push(species as PlantSpecies);
    groups.set(preset.group, list);
  }
  root.append(
    section(
      'Beplanting',
      [...groups].map(([group, species]) =>
        el('div', { class: 'group' }, [
          el('h4', {}, [group]),
          el(
            'div',
            { class: 'tile-grid' },
            species.map((key) =>
              paletteButton(PLANT_PRESETS[key].label, ICONS.tree, () =>
                host.place(PLANT_PRESETS[key].label, (point) =>
                  makePlant(key, { position: point }),
                ),
              ),
            ),
          ),
        ]),
      ),
    ),
  );

  /* ------------------------------------------------------------ furniture */
  root.append(
    section('Meubels', [
      el(
        'div',
        { class: 'tile-grid' },
        (Object.keys(FURNITURE_PRESETS) as FurnitureObject['kind'][]).map((kind) =>
          paletteButton(FURNITURE_PRESETS[kind].label, ICONS.chair, () =>
            host.place(FURNITURE_PRESETS[kind].label, (point) =>
              makeFurniture(kind, { position: point }),
            ),
          ),
        ),
      ),
    ]),
  );

  /* ----------------------------------------------------------- structures */
  const structures: { kind: StructureObject['kind']; label: string }[] = [
    { kind: 'shed', label: 'Schuur' },
    { kind: 'house-wall', label: 'Huismuur' },
    { kind: 'pergola', label: 'Pergola' },
    { kind: 'raised-planter', label: 'Plantenbak' },
  ];
  root.append(
    section('Bouwwerken', [
      el(
        'div',
        { class: 'tile-grid' },
        structures.map((entry) =>
          paletteButton(entry.label, ICONS.home, () =>
            host.place(entry.label, (point) => makeStructure(entry.kind, { position: point })),
          ),
        ),
      ),
    ]),
  );

  /* --------------------------------------------------------------- lights */
  const lights: { kind: LightObject['kind']; label: string }[] = [
    { kind: 'post', label: 'Tuinlamp' },
    { kind: 'spot', label: 'Grondspot' },
    { kind: 'wall', label: 'Wandlamp' },
    { kind: 'lantern', label: 'Lantaarn' },
  ];
  root.append(
    section('Verlichting', [
      el(
        'div',
        { class: 'tile-grid' },
        lights.map((entry) =>
          paletteButton(entry.label, ICONS.bulb, () =>
            host.place(entry.label, (point) => makeLight(entry.kind, { position: point })),
          ),
        ),
      ),
      note('Lichtslingers teken je met het gereedschap bovenaan.'),
    ]),
  );

  /* ---------------------------------------------------------------- other */
  root.append(
    section('Overig', [
      el('div', { class: 'tile-grid' }, [
        paletteButton('Losse tegel', ICONS.square, () =>
          host.place('een tegel', (point) => makeTile({ position: point })),
        ),
        paletteButton('Referentiepersoon', ICONS.person, () =>
          host.place('een persoon', (point) =>
            makePerson({ position: point, height: host.store.doc.view.personHeight }),
          ),
        ),
      ]),
    ]),
  );

  return root;
}

/** Saved block and tile templates, ready to apply to the selection. */
export function renderTemplates(host: LibraryHost): HTMLElement {
  const { store } = host;
  const root = el('div', { class: 'library' });

  root.append(
    section('Stapelblokken & stenen', [
      note('Klik om toe te passen op de selectie.'),
      el(
        'div',
        { class: 'template-list' },
        store.doc.templates.blocks.map((spec) => blockCard(host, spec)),
      ),
    ]),
    section('Tegels & planken', [
      note('Klik om toe te passen op de selectie.'),
      el(
        'div',
        { class: 'template-list' },
        store.doc.templates.tiles.map((spec) => tileCard(host, spec)),
      ),
      button({
        label: 'Nieuw tegelsjabloon',
        icon: ICONS.plus,
        onClick: () => {
          store.update((doc) => {
            doc.templates.tiles.push(tileSpec({ name: `Tegel ${doc.templates.tiles.length + 1}` }));
          });
          host.refresh();
        },
      }),
    ]),
  );

  return root;
}

function blockCard(host: LibraryHost, spec: BlockSpec): HTMLElement {
  return el(
    'div',
    {
      class: 'template-card',
      on: { click: () => applyBlock(host, spec) },
      attrs: { role: 'button', tabindex: '0' },
    },
    [
      el('span', { class: 'swatch', attrs: { style: `background:${spec.color}` } }),
      el('div', { class: 'template-meta' }, [
        el('strong', {}, [spec.name]),
        el('span', {}, [
          `${formatShort(spec.length)} × ${formatShort(spec.height)} × ${formatShort(spec.depth)}`,
        ]),
      ]),
      button({
        label: '',
        icon: ICONS.trash,
        title: 'Verwijder sjabloon',
        onClick: () => {
          host.store.update((doc) => {
            doc.templates.blocks = doc.templates.blocks.filter((entry) => entry.id !== spec.id);
          });
          host.refresh();
        },
      }),
    ],
  );
}

function tileCard(host: LibraryHost, spec: TileSpec): HTMLElement {
  return el(
    'div',
    {
      class: 'template-card',
      on: { click: () => applyTile(host, spec) },
      attrs: { role: 'button', tabindex: '0' },
    },
    [
      el('span', { class: 'swatch', attrs: { style: `background:${spec.color}` } }),
      el('div', { class: 'template-meta' }, [
        el('strong', {}, [spec.name]),
        el('span', {}, [
          `${formatShort(spec.width)} × ${formatShort(spec.depth)} · ${PATTERN_LABELS[spec.pattern]}`,
        ]),
      ]),
      button({
        label: '',
        icon: ICONS.trash,
        title: 'Verwijder sjabloon',
        onClick: () => {
          host.store.update((doc) => {
            doc.templates.tiles = doc.templates.tiles.filter((entry) => entry.id !== spec.id);
          });
          host.refresh();
        },
      }),
    ],
  );
}

const PATTERN_LABELS: Record<TileSpec['pattern'], string> = {
  grid: 'blokverband',
  running: 'halfsteens',
  herringbone: 'visgraat',
  basketweave: 'mandweefsel',
  stack: 'gestapeld',
};

/** Applies a block template to whatever in the selection can take one. */
function applyBlock(host: LibraryHost, spec: BlockSpec) {
  const { store } = host;
  if (store.selection.length === 0) return;
  store.update((doc) => {
    for (const id of store.selection) {
      const object = doc.objects.find((o) => o.id === id);
      if (!object) continue;
      const copy = { ...spec, id: `${spec.id}-${object.id}` };
      if (object.type === 'wall') object.block = copy;
      else if (object.type === 'surface') object.edging.block = copy;
      else if (object.type === 'structure') object.block = copy;
    }
  });
  host.refresh();
}

function applyTile(host: LibraryHost, spec: TileSpec) {
  const { store } = host;
  if (store.selection.length === 0) return;
  store.update((doc) => {
    for (const id of store.selection) {
      const object = doc.objects.find((o) => o.id === id);
      if (!object) continue;
      const copy = { ...spec, id: `${spec.id}-${object.id}` };
      if (object.type === 'path') object.tile = copy;
      else if (object.type === 'tile') object.tile = copy;
      else if (object.type === 'surface') {
        object.ground.tile = copy;
        if (object.ground.kind !== 'deck') object.ground.kind = 'tiles';
      }
    }
  });
  host.refresh();
}

function paletteButton(label: string, iconMarkup: string, onClick: () => void): HTMLElement {
  return el(
    'button',
    { type: 'button', class: 'palette-item', title: label, on: { click: onClick } },
    [el('span', { class: 'palette-icon', innerHTML: iconMarkup }), el('span', {}, [label])],
  );
}

export { row };
