/** Flat list of everything in the garden, for selecting and toggling. */

import { TYPE_LABELS } from '../core/factory';
import type { Store } from '../core/store';
import type { ObjectType } from '../core/types';
import { ICONS, el } from './dom';

const TYPE_ICON: Record<ObjectType, string> = {
  surface: ICONS.square,
  wall: ICONS.wall,
  fence: ICONS.fence,
  path: ICONS.path,
  tile: ICONS.square,
  plant: ICONS.tree,
  structure: ICONS.home,
  furniture: ICONS.chair,
  light: ICONS.bulb,
  person: ICONS.person,
  measure: ICONS.ruler,
};

export function renderOutliner(store: Store, refresh: () => void): HTMLElement {
  const list = el('div', { class: 'outliner' });

  if (store.doc.objects.length === 0) {
    list.append(el('p', { class: 'note' }, ['Nog niets in de tuin.']));
    return list;
  }

  for (const object of store.doc.objects) {
    const selected = store.selection.includes(object.id);
    list.append(
      el(
        'div',
        {
          class: `outliner-row${selected ? ' is-selected' : ''}${object.hidden ? ' is-hidden' : ''}`,
          on: {
            click: (event) => {
              const mouse = event as MouseEvent;
              if (mouse.shiftKey) store.toggleSelect(object.id);
              else store.select([object.id]);
            },
          },
        },
        [
          el('span', { class: 'outliner-icon', innerHTML: TYPE_ICON[object.type] }),
          el('span', { class: 'outliner-name' }, [object.name]),
          el('span', { class: 'outliner-type' }, [TYPE_LABELS[object.type]]),
          el('button', {
            class: `icon-btn${object.hidden ? '' : ' is-on'}`,
            type: 'button',
            title: object.hidden ? 'Toon' : 'Verberg',
            innerHTML: ICONS.eye,
            on: {
              click: (event) => {
                event.stopPropagation();
                store.patch(object.id, (target) => void (target.hidden = !target.hidden));
                refresh();
              },
            },
          }),
          el('button', {
            class: `icon-btn${object.locked ? ' is-on' : ''}`,
            type: 'button',
            title: object.locked ? 'Ontgrendel' : 'Vergrendel',
            innerHTML: ICONS.lock,
            on: {
              click: (event) => {
                event.stopPropagation();
                store.patch(object.id, (target) => void (target.locked = !target.locked));
                refresh();
              },
            },
          }),
        ],
      ),
    );
  }

  return list;
}
