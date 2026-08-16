/** Minimal DOM helpers — enough structure to build panels without a framework. */

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & {
    class?: string;
    dataset?: Record<string, string>;
    on?: Partial<Record<keyof HTMLElementEventMap, EventListener>>;
    attrs?: Record<string, string>;
  } = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, dataset, on, attrs, ...rest } = props;
  if (className) node.className = className;
  if (dataset) for (const [key, value] of Object.entries(dataset)) node.dataset[key] = value;
  if (attrs) for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (on) {
    for (const [event, handler] of Object.entries(on)) {
      node.addEventListener(event, handler as EventListener);
    }
  }
  Object.assign(node, rest);
  append(node, children);
  return node;
}

export function append(parent: HTMLElement, children: Child[]) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: HTMLElement) {
  node.replaceChildren();
}

export interface ButtonOptions {
  label: string;
  title?: string;
  icon?: string;
  active?: boolean;
  variant?: 'ghost' | 'solid' | 'danger';
  onClick: () => void;
}

export function button(options: ButtonOptions): HTMLButtonElement {
  const node = el(
    'button',
    {
      class: `btn btn-${options.variant ?? 'ghost'}${options.active ? ' is-active' : ''}`,
      type: 'button',
      title: options.title ?? options.label,
      on: { click: options.onClick },
    },
    [
      options.icon ? el('span', { class: 'btn-icon', innerHTML: options.icon }) : null,
      options.label ? el('span', { class: 'btn-label' }, [options.label]) : null,
    ],
  );
  return node;
}

/** A collapsible panel section. Collapsed state is caller-owned. */
export function section(
  title: string,
  children: Child[],
  options: { collapsed?: boolean; onToggle?: (collapsed: boolean) => void; actions?: Child[] } = {},
): HTMLElement {
  const body = el('div', { class: 'section-body' }, children);
  const root = el('section', { class: `panel-section${options.collapsed ? ' is-collapsed' : ''}` }, [
    el('header', { class: 'section-head' }, [
      el(
        'button',
        {
          class: 'section-toggle',
          type: 'button',
          on: {
            click: () => {
              const collapsed = root.classList.toggle('is-collapsed');
              options.onToggle?.(collapsed);
            },
          },
        },
        [el('span', { class: 'chevron' }), title],
      ),
      options.actions ? el('div', { class: 'section-actions' }, options.actions) : null,
    ]),
    body,
  ]);
  return root;
}

export function row(children: Child[], className = ''): HTMLElement {
  return el('div', { class: `row ${className}`.trim() }, children);
}

export function note(text: string): HTMLElement {
  return el('p', { class: 'note' }, [text]);
}

export function icon(path: string): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

export const ICONS = {
  cursor: icon('<path d="M4 3l7 17 2.5-6.5L20 11z"/>'),
  square: icon('<rect x="4" y="4" width="16" height="16" rx="2"/>'),
  wall: icon('<path d="M3 8h18M3 12h18M3 16h18M8 8V4m8 4V4M6 16v4m12-4v4"/>'),
  fence: icon('<path d="M5 20V8l2-3 2 3v12M15 20V8l2-3 2 3v12M3 11h18M3 15h18"/>'),
  path: icon('<path d="M8 21c0-6 8-6 8-12a4 4 0 0 0-8 0"/>'),
  ruler: icon('<path d="M3 12l9-9 9 9-9 9zM9 9l1.5 1.5M12 6l1.5 1.5M6 12l1.5 1.5"/>'),
  move: icon('<path d="M12 3v18M3 12h18M12 3l-3 3m3-3l3 3M12 21l-3-3m3 3l3-3M3 12l3-3m-3 3l3 3M21 12l-3-3m3 3l-3 3"/>'),
  rotate: icon('<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>'),
  scale: icon('<path d="M4 20L20 4M14 4h6v6M10 20H4v-6"/>'),
  sun: icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>'),
  eye: icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
  lock: icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  trash: icon('<path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  copy: icon('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  undo: icon('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>'),
  redo: icon('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h4"/>'),
  plan: icon('<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h7V3M14 21v-8h7"/>'),
  camera: icon('<path d="M3 8h3l2-3h8l2 3h3v11H3z"/><circle cx="12" cy="13" r="3.5"/>'),
  walk: icon('<circle cx="13" cy="4" r="2"/><path d="M11 21l2-6-3-3 1-5 3 3 3 1M10 12l-3 3-1 6"/>'),
  fly: icon('<path d="M3 12l18-8-6 8 6 8z"/>'),
  save: icon('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>'),
  open: icon('<path d="M3 7h6l2 2h10v10H3z"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  play: icon('<path d="M7 4l13 8-13 8z"/>'),
  pause: icon('<path d="M8 4v16M16 4v16"/>'),
  layers: icon('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  tree: icon('<path d="M12 21v-5M8 16h8l-4-5-3 5M12 11L9 6h6z"/>'),
  chair: icon('<path d="M6 20v-4m12 4v-4M5 16h14l-1-5H6zM7 11V5h10v6"/>'),
  bulb: icon('<path d="M9 18h6M10 21h4M8 10a4 4 0 1 1 8 0c0 2-1.5 3-2 5H10c-.5-2-2-3-2-5z"/>'),
  home: icon('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  person: icon('<circle cx="12" cy="6" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3"/>'),
  grid: icon('<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'),
};
