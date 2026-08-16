/**
 * Form controls.
 *
 * The length field is the important one: it always speaks metres to the
 * document and centimetres (or metres) to the user, and it accepts the ways
 * people actually type a measurement — "240", "2,4 m", "2m40".
 */

import { fromUnitValue, parseLength, toUnitValue, unitStep, type Unit } from '../core/units';
import { el } from './dom';

export interface FieldOptions {
  label: string;
  hint?: string;
  disabled?: boolean;
}

function field(options: FieldOptions, control: HTMLElement): HTMLElement {
  return el('label', { class: `field${options.disabled ? ' is-disabled' : ''}` }, [
    el('span', { class: 'field-label' }, [options.label]),
    control,
    options.hint ? el('span', { class: 'field-hint' }, [options.hint]) : null,
  ]);
}

export interface LengthFieldOptions extends FieldOptions {
  /** Current value in metres. */
  value: number;
  unit: Unit;
  /** Bounds in metres. */
  min?: number;
  max?: number;
  /** Called with the new value in metres. */
  onChange: (metres: number) => void;
}

export function lengthField(options: LengthFieldOptions): HTMLElement {
  const input = el('input', {
    class: 'input input-number',
    type: 'text',
    inputMode: 'decimal',
    value: String(toUnitValue(options.value, options.unit)),
    disabled: Boolean(options.disabled),
  });

  const commit = () => {
    const parsed = parseLength(input.value, options.unit);
    if (parsed === null) {
      input.value = String(toUnitValue(options.value, options.unit));
      return;
    }
    let metres = parsed;
    if (options.min !== undefined) metres = Math.max(options.min, metres);
    if (options.max !== undefined) metres = Math.min(options.max, metres);
    input.value = String(toUnitValue(metres, options.unit));
    options.onChange(metres);
  };

  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      commit();
      input.blur();
      return;
    }
    // Arrow keys nudge by one step, or ten with shift — the usual CAD feel.
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const parsed = parseLength(input.value, options.unit) ?? options.value;
    const step = unitStep(options.unit) * (event.shiftKey ? 10 : 1);
    const next = parsed + (event.key === 'ArrowUp' ? 1 : -1) * fromUnitValue(step, options.unit);
    input.value = String(toUnitValue(next, options.unit));
    commit();
  });

  return field(
    options,
    el('span', { class: 'input-wrap' }, [input, el('span', { class: 'input-suffix' }, [options.unit])]),
  );
}

export interface NumberFieldOptions extends FieldOptions {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}

export function numberField(options: NumberFieldOptions): HTMLElement {
  const input = el('input', {
    class: 'input input-number',
    type: 'number',
    value: String(options.value),
    disabled: Boolean(options.disabled),
  });
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  input.step = String(options.step ?? 1);

  const commit = () => {
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      input.value = String(options.value);
      return;
    }
    options.onChange(value);
  };
  input.addEventListener('change', commit);

  return field(
    options,
    el('span', { class: 'input-wrap' }, [
      input,
      options.suffix ? el('span', { class: 'input-suffix' }, [options.suffix]) : null,
    ]),
  );
}

export interface SliderOptions extends FieldOptions {
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  /**
   * Fires continuously while dragging. `commit` is false during the drag and
   * true when the user lets go, so the caller can keep the 3D view live but
   * still record a single undo step.
   */
  onInput: (value: number, commit: boolean) => void;
}

export function slider(options: SliderOptions): HTMLElement {
  const readout = el('span', { class: 'slider-value' }, [
    options.format ? options.format(options.value) : String(options.value),
  ]);
  const input = el('input', {
    class: 'input input-range',
    type: 'range',
    value: String(options.value),
    min: String(options.min),
    max: String(options.max),
    step: String(options.step),
    disabled: Boolean(options.disabled),
  });
  input.addEventListener('input', () => {
    const value = Number(input.value);
    readout.textContent = options.format ? options.format(value) : String(value);
    options.onInput(value, false);
  });
  input.addEventListener('change', () => options.onInput(Number(input.value), true));

  return el('label', { class: 'field field-slider' }, [
    el('span', { class: 'field-label' }, [options.label, readout]),
    input,
  ]);
}

export interface SelectOptions<T extends string> extends FieldOptions {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function select<T extends string>(config: SelectOptions<T>): HTMLElement {
  const node = el(
    'select',
    { class: 'input input-select', disabled: Boolean(config.disabled) },
    config.options.map((option) =>
      el('option', { value: option.value, selected: option.value === config.value }, [option.label]),
    ),
  );
  node.addEventListener('change', () => config.onChange(node.value as T));
  return field(config, node);
}

export interface ColorFieldOptions extends FieldOptions {
  value: string;
  /** `commit` is false while the picker is being dragged, true on release. */
  onChange: (value: string, commit: boolean) => void;
}

export function colorField(options: ColorFieldOptions): HTMLElement {
  const input = el('input', {
    class: 'input input-color',
    type: 'color',
    value: normalizeHex(options.value),
    disabled: Boolean(options.disabled),
  });
  // `input` fires continuously while dragging the picker, which is what makes
  // colour changes feel live in the 3D view.
  input.addEventListener('input', () => options.onChange(input.value, false));
  input.addEventListener('change', () => options.onChange(input.value, true));
  return field(options, input);
}

export interface ToggleOptions extends FieldOptions {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function toggle(options: ToggleOptions): HTMLElement {
  const input = el('input', {
    type: 'checkbox',
    checked: options.value,
    class: 'input-checkbox',
    disabled: Boolean(options.disabled),
  });
  input.addEventListener('change', () => options.onChange(input.checked));
  return el('label', { class: 'field field-toggle' }, [
    input,
    el('span', { class: 'field-toggle-text' }, [
      el('span', { class: 'field-label' }, [options.label]),
      options.hint ? el('span', { class: 'field-hint' }, [options.hint]) : null,
    ]),
  ]);
}

export interface TextFieldOptions extends FieldOptions {
  value: string;
  onChange: (value: string) => void;
}

export function textField(options: TextFieldOptions): HTMLElement {
  const input = el('input', {
    class: 'input',
    type: 'text',
    value: options.value,
    disabled: Boolean(options.disabled),
  });
  input.addEventListener('change', () => options.onChange(input.value));
  return field(options, input);
}

function normalizeHex(value: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return '#888888';
}
