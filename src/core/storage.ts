/**
 * Client-side persistence.
 *
 * Projects and template libraries live in IndexedDB (they can grow past the
 * ~5 MB localStorage ceiling once a garden has a few hundred objects).
 * Small UI preferences that must be readable synchronously at boot live in
 * localStorage.
 */

import type { BlockSpec, GardenDoc, TileSpec } from './types';

const DB_NAME = 'gardenator';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const TEMPLATES = 'templates';
const PREFS_KEY = 'gardenator.prefs';
const LAST_DOC_KEY = 'gardenator.lastProject';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  objectCount: number;
}

export interface SavedTemplate {
  id: string;
  kind: 'block' | 'tile';
  name: string;
  spec: BlockSpec | TileSpec;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) {
        db.createObjectStore(PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(TEMPLATES)) {
        db.createObjectStore(TEMPLATES, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

/* --------------------------------------------------------------- projects */

export async function saveProject(doc: GardenDoc): Promise<void> {
  await tx(PROJECTS, 'readwrite', (store) => store.put(structuredClone(doc)));
  localStorage.setItem(LAST_DOC_KEY, doc.id);
}

export async function loadProject(id: string): Promise<GardenDoc | null> {
  const result = await tx<GardenDoc | undefined>(PROJECTS, 'readonly', (store) => store.get(id));
  return result ?? null;
}

export async function deleteProject(id: string): Promise<void> {
  await tx(PROJECTS, 'readwrite', (store) => store.delete(id));
  if (localStorage.getItem(LAST_DOC_KEY) === id) localStorage.removeItem(LAST_DOC_KEY);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await tx<GardenDoc[]>(PROJECTS, 'readonly', (store) => store.getAll());
  return all
    .map((doc) => ({
      id: doc.id,
      name: doc.name,
      updatedAt: doc.updatedAt,
      objectCount: doc.objects.length,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function lastProjectId(): string | null {
  return localStorage.getItem(LAST_DOC_KEY);
}

/* -------------------------------------------------------------- templates */

export async function saveTemplate(template: SavedTemplate): Promise<void> {
  await tx(TEMPLATES, 'readwrite', (store) => store.put(structuredClone(template)));
}

export async function listTemplates(): Promise<SavedTemplate[]> {
  const all = await tx<SavedTemplate[]>(TEMPLATES, 'readonly', (store) => store.getAll());
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteTemplate(id: string): Promise<void> {
  await tx(TEMPLATES, 'readwrite', (store) => store.delete(id));
}

/* ------------------------------------------------------------ preferences */

export interface Prefs {
  panelsCollapsed: Record<string, boolean>;
  autosave: boolean;
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<Prefs>;
      return {
        panelsCollapsed: stored.panelsCollapsed ?? {},
        autosave: stored.autosave ?? true,
      };
    }
  } catch {
    // Corrupt or blocked storage is not worth failing the whole app over.
  }
  return { panelsCollapsed: {}, autosave: true };
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private-browsing quota errors: preferences simply do not persist.
  }
}

/* ------------------------------------------------------- file import/export */

export function downloadJson(doc: GardenDoc): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${slug(doc.name)}.gardenator.json`);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoke on the next tick so the click has definitely been handled.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, mime = 'image/svg+xml'): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function pickJsonFile(): Promise<GardenDoc | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(JSON.parse(await file.text()) as GardenDoc);
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'tuin'
  );
}
