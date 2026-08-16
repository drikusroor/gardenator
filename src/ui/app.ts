/**
 * Application shell: layout, toolbar, panels, keyboard shortcuts, project I/O.
 */

import { DEFAULT_PLAN_OPTIONS, buildPlanSvg, takeOff } from '../core/plan';
import {
  blockSpec,
  makeFence,
  makeLight,
  makePath,
  makeSurface,
  makeWall,
  tileSpec,
} from '../core/factory';
import { sampleGarden } from '../core/sample';
import { Store, emptyDoc } from '../core/store';
import {
  downloadBlob,
  downloadJson,
  downloadText,
  lastProjectId,
  listProjects,
  loadProject,
  loadPrefs,
  pickJsonFile,
  saveProject,
  savePrefs,
  slug,
  type Prefs,
} from '../core/storage';
import type { GardenObject, Vec2 } from '../core/types';
import { formatClock } from '../core/units';
import { Editor, type DrawKind, type GizmoMode } from '../render/editing';
import { Viewer } from '../render/viewer';
import { ICONS, button, clear, el, row } from './dom';
import { renderEnvironment } from './environment';
import { renderInspector } from './inspector';
import { renderLibrary, renderTemplates } from './library';
import { renderOutliner } from './outliner';

type LeftTab = 'add' | 'templates' | 'environment';

const AUTOSAVE_DELAY = 1200;

export class App {
  private store: Store;
  private viewer!: Viewer;
  private editor!: Editor;
  private prefs: Prefs;

  private leftTab: LeftTab = 'add';
  private statusText = '';
  private autosaveTimer: number | null = null;

  private nodes!: {
    toolbar: HTMLElement;
    left: HTMLElement;
    leftTabs: HTMLElement;
    inspector: HTMLElement;
    outliner: HTMLElement;
    status: HTMLElement;
    viewport: HTMLElement;
    clock: HTMLElement;
  };

  constructor(private mount: HTMLElement) {
    this.store = new Store(emptyDoc());
    this.prefs = loadPrefs();
    this.buildLayout();
    this.viewer = new Viewer(this.nodes.viewport, this.store);
    this.editor = new Editor(this.viewer, this.store, {
      onStatus: (message) => this.setStatus(message),
      onToolFinished: () => this.renderToolbar(),
    });
    this.registerDrawFactories();

    this.store.subscribe((event) => {
      if (event.kind === 'doc') {
        this.viewer.syncFromDocument();
        this.editor.refresh();
        if (!event.live) {
          this.renderPanels();
          this.scheduleAutosave();
        }
      } else if (event.kind === 'selection') {
        this.viewer.refreshOutline();
        this.editor.refresh();
        this.renderPanels();
      }
    });

    this.bindKeyboard();
    void this.restore();
  }

  /* --------------------------------------------------------------- layout */

  private buildLayout() {
    const viewport = el('div', { class: 'viewport' });
    const toolbar = el('div', { class: 'toolbar' });
    const leftTabs = el('div', { class: 'tabs' });
    const left = el('div', { class: 'panel-body' });
    const inspector = el('div', { class: 'panel-body' });
    const outliner = el('div', { class: 'panel-body outliner-body' });
    const status = el('span', { class: 'status-text' });
    const clock = el('span', { class: 'status-clock' });

    this.nodes = { toolbar, left, leftTabs, inspector, outliner, status, viewport, clock };

    this.mount.append(
      el('div', { class: 'app' }, [
        el('header', { class: 'app-header' }, [
          el('div', { class: 'brand' }, [
            el('span', { class: 'brand-mark', innerHTML: ICONS.tree }),
            el('span', { class: 'brand-name' }, ['Gardenator']),
          ]),
          toolbar,
        ]),
        el('div', { class: 'app-body' }, [
          el('aside', { class: 'panel panel-left' }, [leftTabs, left]),
          el('main', { class: 'stage' }, [
            viewport,
            el('footer', { class: 'status-bar' }, [status, clock]),
          ]),
          el('aside', { class: 'panel panel-right' }, [
            el('div', { class: 'panel-title' }, ['Eigenschappen']),
            inspector,
            el('div', { class: 'panel-title' }, ['Objecten']),
            outliner,
          ]),
        ]),
      ]),
    );
  }

  /* -------------------------------------------------------------- toolbar */

  private renderToolbar() {
    const toolbar = this.nodes.toolbar;
    clear(toolbar);
    const view = this.store.doc.view;
    const tool = this.editor.tool;

    const group = (children: HTMLElement[]) => el('div', { class: 'tool-group' }, children);

    toolbar.append(
      group([
        button({
          label: '',
          icon: ICONS.cursor,
          title: 'Selecteren (Esc)',
          active: tool.kind === 'select',
          onClick: () => this.setTool({ kind: 'select' }),
        }),
        button({
          label: '',
          icon: ICONS.move,
          title: 'Verplaatsen (G)',
          active: this.editor.gizmoMode === 'translate',
          onClick: () => this.setGizmo('translate'),
        }),
        button({
          label: '',
          icon: ICONS.rotate,
          title: 'Draaien (R)',
          active: this.editor.gizmoMode === 'rotate',
          onClick: () => this.setGizmo('rotate'),
        }),
        button({
          label: '',
          icon: ICONS.scale,
          title: 'Schalen (T)',
          active: this.editor.gizmoMode === 'scale',
          onClick: () => this.setGizmo('scale'),
        }),
        button({
          label: '',
          icon: ICONS.ruler,
          title: 'Meten (M)',
          active: tool.kind === 'measure',
          onClick: () => this.setTool({ kind: 'measure' }),
        }),
      ]),

      group([
        button({
          label: '',
          icon: ICONS.undo,
          title: 'Ongedaan maken (Ctrl+Z)',
          onClick: () => this.store.undo(),
        }),
        button({
          label: '',
          icon: ICONS.redo,
          title: 'Opnieuw (Ctrl+Shift+Z)',
          onClick: () => this.store.redo(),
        }),
      ]),

      group([
        button({
          label: 'Baan',
          icon: ICONS.camera,
          title: 'Draaien om een punt — sleep met links, verschuif met rechts',
          active: view.cameraMode === 'orbit',
          onClick: () => this.setCameraMode('orbit'),
        }),
        button({
          label: 'Vliegen',
          icon: ICONS.fly,
          title: 'Vrij vliegen — WASD, rechtermuisknop om rond te kijken',
          active: view.cameraMode === 'fly',
          onClick: () => this.setCameraMode('fly'),
        }),
        button({
          label: 'Lopen',
          icon: ICONS.walk,
          title: 'Op ooghoogte lopen — WASD, sleep om rond te kijken',
          active: view.cameraMode === 'walk',
          onClick: () => this.setCameraMode('walk'),
        }),
      ]),

      group([
        button({
          label: '',
          icon: ICONS.grid,
          title: 'Bovenaanzicht',
          onClick: () => this.preset('top'),
        }),
        button({
          label: '',
          icon: ICONS.layers,
          title: 'Isometrisch aanzicht',
          onClick: () => this.preset('iso'),
        }),
        button({
          label: '',
          icon: ICONS.home,
          title: 'Vanaf het huis',
          onClick: () => this.preset('house'),
        }),
        button({
          label: '',
          icon: ICONS.eye,
          title: 'Zoom naar selectie (F)',
          onClick: () => this.viewer.frameSelection(),
        }),
      ]),

      group([
        button({
          label: 'Plattegrond',
          icon: ICONS.plan,
          title: 'Maatvoeringstekening maken',
          onClick: () => this.openPlan(),
        }),
        button({
          label: 'Foto',
          icon: ICONS.camera,
          title: 'Afbeelding van het huidige aanzicht opslaan',
          onClick: () => void this.exportImage(),
        }),
      ]),

      group([
        button({ label: 'Nieuw', onClick: () => this.newProject() }),
        button({ label: 'Voorbeeld', title: 'Laad de voorbeeldtuin', onClick: () => this.loadSample() }),
        button({ label: 'Openen', icon: ICONS.open, onClick: () => void this.openProject() }),
        button({
          label: 'Opslaan',
          icon: ICONS.save,
          variant: 'solid',
          onClick: () => void this.save(true),
        }),
        button({ label: 'JSON', title: 'Exporteer als bestand', onClick: () => downloadJson(this.store.doc) }),
        button({ label: 'Importeer', onClick: () => void this.importProject() }),
      ]),
    );
  }

  /* --------------------------------------------------------------- panels */

  private renderPanels() {
    this.renderToolbar();
    this.renderLeft();

    clear(this.nodes.inspector);
    this.nodes.inspector.append(
      renderInspector({
        store: this.store,
        refresh: () => this.renderPanels(),
        live: (id, mutate, commit) => {
          this.store.updateLive((doc) => {
            const object = doc.objects.find((o) => o.id === id);
            if (object) mutate(object);
          });
          if (commit) this.store.commit();
        },
      }),
    );

    clear(this.nodes.outliner);
    this.nodes.outliner.append(renderOutliner(this.store, () => this.renderPanels()));

    this.nodes.clock.textContent = `${formatClock(this.store.doc.environment.timeMinutes)} · ${
      this.store.doc.objects.length
    } objecten`;
  }

  private renderLeft() {
    clear(this.nodes.leftTabs);
    const tabs: { id: LeftTab; label: string }[] = [
      { id: 'add', label: 'Toevoegen' },
      { id: 'templates', label: 'Sjablonen' },
      { id: 'environment', label: 'Omgeving' },
    ];
    for (const tab of tabs) {
      this.nodes.leftTabs.append(
        el(
          'button',
          {
            type: 'button',
            class: `tab${this.leftTab === tab.id ? ' is-active' : ''}`,
            on: {
              click: () => {
                this.leftTab = tab.id;
                this.renderLeft();
              },
            },
          },
          [tab.label],
        ),
      );
    }

    clear(this.nodes.left);
    const libraryHost = {
      store: this.store,
      place: (label: string, make: (point: Vec2) => GardenObject) =>
        this.setTool({ kind: 'place', label, make }),
      draw: (kind: DrawKind) => this.setTool({ kind: 'draw', draw: kind }),
      refresh: () => this.renderPanels(),
    };

    if (this.leftTab === 'add') {
      this.nodes.left.append(renderLibrary(libraryHost));
    } else if (this.leftTab === 'templates') {
      this.nodes.left.append(renderTemplates(libraryHost));
    } else {
      this.nodes.left.append(
        renderEnvironment({
          store: this.store,
          onSunChanged: () => {
            this.viewer.updateSun();
            this.nodes.clock.textContent = `${formatClock(
              this.store.doc.environment.timeMinutes,
            )} · ${this.store.doc.objects.length} objecten`;
          },
          onSceneChanged: () => {
            this.viewer.rebuildAll();
            this.viewer.updateSun();
          },
          refresh: () => this.renderPanels(),
        }),
      );
    }
  }

  /* ---------------------------------------------------------------- tools */

  private setTool(tool: Parameters<Editor['setTool']>[0]) {
    this.editor.setTool(tool);
    this.renderToolbar();
  }

  private setGizmo(mode: GizmoMode) {
    this.editor.setTool({ kind: 'select' });
    this.editor.setGizmoMode(mode);
    this.renderToolbar();
  }

  private setCameraMode(mode: 'orbit' | 'fly' | 'walk') {
    this.store.update((doc) => void (doc.view.cameraMode = mode));
    this.viewer.setCameraMode(mode);
    this.setStatus(
      mode === 'orbit'
        ? 'Sleep met links om te draaien, met rechts om te verschuiven, scroll om te zoomen.'
        : mode === 'fly'
          ? 'WASD om te vliegen, Q/E omlaag en omhoog. Klik in beeld om rond te kijken, Esc om te stoppen.'
          : 'WASD om te lopen. Klik in beeld om rond te kijken, Esc om te stoppen. Ooghoogte staat in het paneel Omgeving.',
    );
  }

  private preset(kind: 'top' | 'iso' | 'house') {
    this.store.update((doc) => void (doc.view.cameraMode = 'orbit'));
    this.viewer.rig.setPreset(kind, this.store.doc.site.width, this.store.doc.site.depth);
    this.renderToolbar();
  }

  /**
   * Objects drawn in the viewport inherit the presets the palette implies,
   * so a wall comes out as stapelblokken and a path as paving, not as an
   * empty shell the user has to configure before it looks like anything.
   */
  private registerDrawFactories() {
    this.editor.drawDefaults = {
      surface: (origin, points) =>
        makeSurface({
          name: 'Nieuw vlak',
          position: origin,
          points,
          ground: { kind: 'grass', scatter: 1 },
        }),
      wall: (origin, points) =>
        makeWall({
          name: 'Nieuwe muur',
          position: origin,
          path: points,
          block: blockSpec(),
          courses: 3,
        }),
      fence: (origin, points) =>
        makeFence({ name: 'Nieuwe schutting', position: origin, path: points }),
      path: (origin, points) =>
        makePath({
          name: 'Nieuw pad',
          position: origin,
          path: points,
          curved: points.length > 2,
          tile: tileSpec({ name: 'Padtegel 40×40', width: 0.4, depth: 0.4, color: '#7e7c76' }),
        }),
      'string-light': (origin, points) =>
        makeLight('string', { name: 'Lichtslinger', position: origin, path: points }),
    };
  }

  /* ------------------------------------------------------------- keyboard */

  private bindKeyboard() {
    window.addEventListener('keydown', (event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.store.redo();
        else this.store.undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        this.store.redo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        this.store.duplicate(this.store.selection);
        return;
      }
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void this.save(true);
        return;
      }

      switch (event.key) {
        case 'Escape':
          if (this.editor.drafting) this.editor.cancelDraft();
          this.setTool({ kind: 'select' });
          this.store.select([]);
          break;
        case 'Enter':
          if (this.editor.drafting) this.editor.finishDraft();
          break;
        case 'Delete':
        case 'Backspace':
          // Hovering a vertex handle deletes that corner; otherwise the whole
          // selection goes.
          if (this.editor.deleteHoveredVertex()) {
            event.preventDefault();
          } else if (this.store.selection.length) {
            event.preventDefault();
            this.store.remove(this.store.selection);
          }
          break;
        case 'g':
        case 'G':
          this.setGizmo('translate');
          break;
        case 'r':
        case 'R':
          this.setGizmo('rotate');
          break;
        case 't':
        case 'T':
          this.setGizmo('scale');
          break;
        case 'm':
        case 'M':
          this.setTool({ kind: 'measure' });
          break;
        case 'f':
        case 'F':
          this.viewer.frameSelection();
          break;
        case '1':
          this.setCameraMode('orbit');
          this.renderToolbar();
          break;
        case '2':
          this.setCameraMode('fly');
          this.renderToolbar();
          break;
        case '3':
          this.setCameraMode('walk');
          this.renderToolbar();
          break;
      }
    });
  }

  /* ------------------------------------------------------------ persistence */

  private scheduleAutosave() {
    if (!this.prefs.autosave) return;
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => void this.save(false), AUTOSAVE_DELAY);
  }

  private async save(explicit: boolean) {
    try {
      await saveProject(this.store.doc);
      if (explicit) this.setStatus(`Opgeslagen: ${this.store.doc.name}`);
    } catch (error) {
      this.setStatus(`Opslaan mislukt: ${(error as Error).message}`);
    }
  }

  private async restore() {
    const id = lastProjectId();
    if (id) {
      const doc = await loadProject(id);
      if (doc) {
        this.store.replace(doc);
        this.afterLoad();
        return;
      }
    }
    this.store.replace(sampleGarden());
    this.afterLoad();
    this.setStatus('Voorbeeldtuin geladen — pas hem aan of begin opnieuw met Nieuw.');
  }

  private afterLoad() {
    this.viewer.rebuildAll();
    this.viewer.updateSun();
    this.viewer.setCameraMode(this.store.doc.view.cameraMode);
    this.viewer.rig.setPreset('iso', this.store.doc.site.width, this.store.doc.site.depth);
    this.renderPanels();
  }

  private newProject() {
    const doc = emptyDoc('Nieuwe tuin');
    this.store.replace(doc);
    this.afterLoad();
    this.setStatus('Lege tuin. Teken een vlak om te beginnen.');
  }

  private loadSample() {
    this.store.replace(sampleGarden());
    this.afterLoad();
  }

  private async openProject() {
    const projects = await listProjects();
    if (projects.length === 0) {
      this.setStatus('Nog geen opgeslagen tuinen.');
      return;
    }
    this.showModal(
      'Tuin openen',
      el(
        'div',
        { class: 'project-list' },
        projects.map((project) =>
          el(
            'button',
            {
              type: 'button',
              class: 'project-row',
              on: {
                click: async () => {
                  const doc = await loadProject(project.id);
                  if (doc) {
                    this.store.replace(doc);
                    this.afterLoad();
                  }
                  this.closeModal();
                },
              },
            },
            [
              el('strong', {}, [project.name]),
              el('span', {}, [
                `${project.objectCount} objecten · ${new Date(project.updatedAt).toLocaleString('nl-NL')}`,
              ]),
            ],
          ),
        ),
      ),
    );
  }

  private async importProject() {
    const doc = await pickJsonFile();
    if (!doc || !Array.isArray(doc.objects)) {
      this.setStatus('Dat bestand kon niet worden gelezen.');
      return;
    }
    this.store.replace(doc);
    this.afterLoad();
    this.setStatus(`Geïmporteerd: ${doc.name}`);
  }

  /* --------------------------------------------------------------- export */

  private openPlan() {
    const svg = buildPlanSvg(this.store.doc, DEFAULT_PLAN_OPTIONS);
    const preview = el('div', { class: 'plan-preview', innerHTML: svg });
    const lines = takeOff(this.store.doc);

    // The drawing already carries its own legend and take-off, so the modal
    // only adds what the drawing cannot: the export actions.
    this.showModal(
      'Plattegrond met maatvoering',
      el('div', { class: 'plan-modal' }, [
        preview,
        el('div', { class: 'plan-actions' }, [
          el('span', { class: 'note' }, [
            `${lines.length} regels materiaalstaat · schaal 1:${Math.round(1000 / DEFAULT_PLAN_OPTIONS.scale)} · maten in meters`,
          ]),
          row([
            button({
              label: 'SVG opslaan',
              variant: 'solid',
              icon: ICONS.save,
              onClick: () => downloadText(svg, `${slug(this.store.doc.name)}-plattegrond.svg`),
            }),
            button({
              label: 'PNG opslaan',
              icon: ICONS.camera,
              onClick: () => void this.planToPng(svg),
            }),
          ]),
        ]),
      ]),
    );
  }

  /** Rasterises the plan SVG through an offscreen canvas. */
  private async planToPng(svg: string) {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('SVG kon niet worden geladen'));
        image.src = url;
      });
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = image.width * scale;
      canvas.height = image.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (png) downloadBlob(png, `${slug(this.store.doc.name)}-plattegrond.png`);
    } catch (error) {
      this.setStatus(`Export mislukt: ${(error as Error).message}`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private async exportImage() {
    const blob = await this.viewer.snapshot(2400, 1500);
    if (blob) downloadBlob(blob, `${slug(this.store.doc.name)}-aanzicht.png`);
  }

  /* ---------------------------------------------------------------- chrome */

  private setStatus(message: string) {
    this.statusText = message;
    this.nodes.status.textContent = message;
  }

  private modal: HTMLElement | null = null;

  private showModal(title: string, content: HTMLElement) {
    this.closeModal();
    const overlay = el(
      'div',
      {
        class: 'modal-overlay',
        on: {
          click: (event) => {
            if (event.target === overlay) this.closeModal();
          },
        },
      },
      [
        el('div', { class: 'modal' }, [
          el('header', { class: 'modal-head' }, [
            el('h3', {}, [title]),
            button({ label: 'Sluiten', onClick: () => this.closeModal() }),
          ]),
          el('div', { class: 'modal-body' }, [content]),
        ]),
      ],
    );
    document.body.append(overlay);
    this.modal = overlay;
  }

  private closeModal() {
    this.modal?.remove();
    this.modal = null;
  }

  /** Persists panel preferences on unload. */
  savePreferences() {
    savePrefs(this.prefs);
  }

  get status(): string {
    return this.statusText;
  }
}
