/**
 * Document store: holds the scene, the selection, and the undo history.
 *
 * Undo is snapshot based. A garden document is a few hundred kilobytes at
 * most, so cloning it per edit is cheaper than the bookkeeping that
 * command-diffing would need — and it can never drift out of sync.
 */

import { defaultBlocks, defaultTiles, uid } from './factory';
import type { GardenDoc, GardenObject } from './types';

export type ChangeKind = 'doc' | 'selection' | 'transient';

export interface ChangeEvent {
  kind: ChangeKind;
  /** True while a drag is in flight; listeners can skip expensive work. */
  live: boolean;
}

type Listener = (event: ChangeEvent) => void;

const HISTORY_LIMIT = 80;

export function emptyDoc(name = 'Mijn tuin'): GardenDoc {
  return {
    id: uid('doc'),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    site: {
      width: 12,
      depth: 18,
      northOffset: 0,
      latitude: 52.09,
      longitude: 5.12,
      groundColor: '#6f7a52',
    },
    environment: {
      dayOfYear: 172,
      timeMinutes: 14 * 60,
      playing: false,
      speed: 120,
      cloudiness: 0.15,
      showShadows: true,
    },
    view: {
      cameraMode: 'orbit',
      personHeight: 1.85,
      showGrid: true,
      snap: 0.05,
      showDimensions: true,
      showGrass: true,
      unit: 'cm',
      quality: 'high',
      renderEngine: 'raster',
    },
    templates: { blocks: defaultBlocks(), tiles: defaultTiles() },
    objects: [],
  };
}

export class Store {
  doc: GardenDoc;
  selection: string[] = [];

  private listeners = new Set<Listener>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** Snapshot taken when a drag began, committed when it ends. */
  private pending: string | null = null;

  constructor(doc: GardenDoc = emptyDoc()) {
    this.doc = doc;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(kind: ChangeKind, live = false) {
    const event: ChangeEvent = { kind, live };
    for (const listener of this.listeners) listener(event);
  }

  /* ---------------------------------------------------------------- edits */

  /** Applies a mutation and records one undo step. */
  update(mutate: (doc: GardenDoc) => void): void {
    this.undoStack.push(serialize(this.doc));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    mutate(this.doc);
    this.doc.updatedAt = Date.now();
    this.emit('doc');
  }

  /**
   * Applies a mutation without touching history — for the frames of a drag.
   * The first call in a gesture stashes the pre-drag state; `commit()` turns
   * that into a single undo step, so a drag undoes in one go.
   */
  updateLive(mutate: (doc: GardenDoc) => void): void {
    if (this.pending === null) this.pending = serialize(this.doc);
    mutate(this.doc);
    this.doc.updatedAt = Date.now();
    this.emit('doc', true);
  }

  /** Ends a live gesture, pushing exactly one undo entry if anything changed. */
  commit(): void {
    if (this.pending === null) return;
    const before = this.pending;
    this.pending = null;
    if (before === serialize(this.doc)) return;
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit('doc');
  }

  /** Replaces the whole document, e.g. on load or import. Clears history. */
  replace(doc: GardenDoc): void {
    this.doc = doc;
    this.selection = [];
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
    this.emit('doc');
    this.emit('selection');
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.redoStack.push(serialize(this.doc));
    this.doc = deserialize(snapshot);
    this.pruneSelection();
    this.emit('doc');
    this.emit('selection');
  }

  redo(): void {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return;
    this.undoStack.push(serialize(this.doc));
    this.doc = deserialize(snapshot);
    this.pruneSelection();
    this.emit('doc');
    this.emit('selection');
  }

  /* ------------------------------------------------------------- objects */

  get objects(): GardenObject[] {
    return this.doc.objects;
  }

  find(id: string): GardenObject | undefined {
    return this.doc.objects.find((o) => o.id === id);
  }

  add(object: GardenObject, select = true): GardenObject {
    this.update((doc) => {
      doc.objects.push(object);
    });
    if (select) this.select([object.id]);
    return object;
  }

  remove(ids: string[]): void {
    const removable = new Set(
      ids.filter((id) => {
        const object = this.find(id);
        return object && !object.locked;
      }),
    );
    if (removable.size === 0) return;
    this.update((doc) => {
      doc.objects = doc.objects.filter((o) => !removable.has(o.id));
    });
    this.select(this.selection.filter((id) => !removable.has(id)));
  }

  /** Mutates one object and records an undo step. */
  patch(id: string, mutate: (object: GardenObject) => void): void {
    this.update((doc) => {
      const object = doc.objects.find((o) => o.id === id);
      if (object) mutate(object);
    });
  }

  duplicate(ids: string[]): GardenObject[] {
    const copies: GardenObject[] = [];
    this.update((doc) => {
      for (const id of ids) {
        const original = doc.objects.find((o) => o.id === id);
        if (!original) continue;
        const copy = deepClone(original);
        copy.id = uid();
        copy.name = `${original.name} kopie`;
        // Nudge so the copy is visible instead of exactly hiding the original.
        copy.position = { x: original.position.x + 0.3, z: original.position.z + 0.3 };
        doc.objects.push(copy);
        copies.push(copy);
      }
    });
    if (copies.length) this.select(copies.map((c) => c.id));
    return copies;
  }

  /* ----------------------------------------------------------- selection */

  select(ids: string[]): void {
    const next = ids.filter((id, i) => ids.indexOf(id) === i && this.find(id));
    if (same(next, this.selection)) return;
    this.selection = next;
    this.emit('selection');
  }

  toggleSelect(id: string): void {
    this.select(
      this.selection.includes(id)
        ? this.selection.filter((s) => s !== id)
        : [...this.selection, id],
    );
  }

  get selected(): GardenObject[] {
    return this.selection
      .map((id) => this.find(id))
      .filter((o): o is GardenObject => o !== undefined);
  }

  get primary(): GardenObject | null {
    return this.selected[0] ?? null;
  }

  private pruneSelection() {
    const ids = new Set(this.doc.objects.map((o) => o.id));
    this.selection = this.selection.filter((id) => ids.has(id));
  }
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function serialize(doc: GardenDoc): string {
  return JSON.stringify(doc);
}

export function deserialize(json: string): GardenDoc {
  return JSON.parse(json) as GardenDoc;
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
