/** Sun, site orientation and view-quality settings. */

import type { Store } from '../core/store';
import { formatClock, formatDayOfYear } from '../core/units';
import { sunTimes } from '../render/sky';
import { lengthField, numberField, select, slider, toggle } from './controls';
import { ICONS, button, el, note, row, section } from './dom';

export interface EnvironmentHost {
  store: Store;
  /** Recomputes lighting after an environment change. */
  onSunChanged: () => void;
  /** Rebuilds the scene after a change that affects geometry. */
  onSceneChanged: () => void;
  refresh: () => void;
}

export function renderEnvironment(host: EnvironmentHost): HTMLElement {
  const { store } = host;
  const environment = store.doc.environment;
  const site = store.doc.site;
  const view = store.doc.view;
  const unit = view.unit;

  const times = sunTimes(environment.dayOfYear, site.latitude);

  const root = el('div', { class: 'library' });

  root.append(
    section('Zon en tijd', [
      slider({
        label: 'Tijd',
        value: environment.timeMinutes,
        min: 0,
        max: 1439,
        step: 5,
        format: (value) => formatClock(value),
        onInput: (value) => {
          environment.timeMinutes = value;
          host.onSunChanged();
        },
      }),
      slider({
        label: 'Datum',
        value: environment.dayOfYear,
        min: 1,
        max: 365,
        step: 1,
        format: (value) => formatDayOfYear(value),
        onInput: (value) => {
          environment.dayOfYear = Math.round(value);
          host.onSunChanged();
        },
      }),
      row([
        button({
          label: environment.playing ? 'Pauzeer' : 'Speel dag af',
          icon: environment.playing ? ICONS.pause : ICONS.play,
          variant: 'solid',
          onClick: () => {
            environment.playing = !environment.playing;
            host.refresh();
          },
        }),
        button({
          label: 'Nu',
          title: 'Zet op de huidige kloktijd',
          onClick: () => {
            const now = new Date();
            environment.timeMinutes = now.getHours() * 60 + now.getMinutes();
            environment.dayOfYear = dayOfYear(now);
            host.onSunChanged();
            host.refresh();
          },
        }),
      ]),
      environment.playing
        ? slider({
            label: 'Snelheid',
            value: environment.speed,
            min: 10,
            max: 900,
            step: 10,
            format: (value) => `${Math.round(value)} min/s`,
            onInput: (value) => void (environment.speed = value),
          })
        : null,
      times
        ? note(`Zonsopkomst ${formatClock(times.sunrise)} · zonsondergang ${formatClock(times.sunset)}`)
        : note('Poolnacht of pooldag op deze breedtegraad.'),
      slider({
        label: 'Bewolking',
        value: environment.cloudiness,
        min: 0,
        max: 1,
        step: 0.05,
        format: (value) => `${Math.round(value * 100)}%`,
        onInput: (value) => {
          environment.cloudiness = value;
          host.onSunChanged();
        },
      }),
      toggle({
        label: 'Schaduwen',
        value: environment.showShadows,
        onChange: (value) => {
          environment.showShadows = value;
          host.onSunChanged();
          host.refresh();
        },
      }),
    ]),
  );

  root.append(
    section('Locatie en oriëntatie', [
      numberField({
        label: 'Noorden ten opzichte van de tuin',
        value: Math.round(site.northOffset),
        min: 0,
        max: 359,
        step: 5,
        suffix: '°',
        hint: '0° = noorden ligt aan de bovenkant van de plattegrond',
        onChange: (value) => {
          store.update((doc) => void (doc.site.northOffset = ((value % 360) + 360) % 360));
          host.onSunChanged();
        },
      }),
      row(
        [
          numberField({
            label: 'Breedtegraad',
            value: site.latitude,
            min: -66,
            max: 66,
            step: 0.5,
            suffix: '°N',
            onChange: (value) => {
              store.update((doc) => void (doc.site.latitude = value));
              host.onSunChanged();
            },
          }),
          numberField({
            label: 'Lengtegraad',
            value: site.longitude,
            min: -180,
            max: 180,
            step: 0.5,
            suffix: '°E',
            onChange: (value) => store.update((doc) => void (doc.site.longitude = value)),
          }),
        ],
        'row-pair',
      ),
    ]),
  );

  root.append(
    section('Perceel', [
      row(
        [
          lengthField({
            label: 'Breedte',
            value: site.width,
            unit,
            min: 1,
            onChange: (value) => {
              store.update((doc) => void (doc.site.width = value));
              host.onSceneChanged();
            },
          }),
          lengthField({
            label: 'Diepte',
            value: site.depth,
            unit,
            min: 1,
            onChange: (value) => {
              store.update((doc) => void (doc.site.depth = value));
              host.onSceneChanged();
            },
          }),
        ],
        'row-pair',
      ),
      note('Het perceel is het gestippelde kader; de tuin ligt gecentreerd om het midden.'),
    ]),
  );

  root.append(
    section('Weergave', [
      select({
        label: 'Eenheid',
        value: view.unit,
        options: [
          { value: 'cm', label: 'Centimeters' },
          { value: 'm', label: 'Meters' },
        ],
        onChange: (value) => {
          store.update((doc) => void (doc.view.unit = value));
          host.refresh();
        },
      }),
      select({
        label: 'Rastermaat / magneet',
        value: String(view.snap),
        options: [
          { value: '0', label: 'Uit' },
          { value: '0.01', label: '1 cm' },
          { value: '0.05', label: '5 cm' },
          { value: '0.1', label: '10 cm' },
          { value: '0.25', label: '25 cm' },
          { value: '0.5', label: '50 cm' },
          { value: '1', label: '1 m' },
        ],
        onChange: (value) => store.update((doc) => void (doc.view.snap = Number(value))),
      }),
      select({
        label: 'Detailniveau',
        value: view.quality,
        options: [
          { value: 'low', label: 'Laag (sneller)' },
          { value: 'medium', label: 'Gemiddeld' },
          { value: 'high', label: 'Hoog' },
        ],
        onChange: (value) => {
          store.update((doc) => void (doc.view.quality = value));
          host.onSceneChanged();
        },
      }),
      lengthField({
        label: 'Ooghoogte in wandelmodus',
        value: view.personHeight,
        unit,
        min: 0.8,
        max: 2.3,
        onChange: (value) => store.update((doc) => void (doc.view.personHeight = value)),
      }),
      toggle({
        label: 'Raster en zonnebaan tonen',
        value: view.showGrid,
        onChange: (value) => {
          store.update((doc) => void (doc.view.showGrid = value));
          host.onSceneChanged();
        },
      }),
      toggle({
        label: 'Maatvoering tonen',
        value: view.showDimensions,
        onChange: (value) => {
          store.update((doc) => void (doc.view.showDimensions = value));
          host.onSceneChanged();
        },
      }),
      toggle({
        label: 'Grassprieten tonen',
        value: view.showGrass,
        onChange: (value) => {
          store.update((doc) => void (doc.view.showGrass = value));
          host.onSceneChanged();
        },
      }),
    ]),
  );

  return root;
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const current = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((current - start) / 86400000);
}
