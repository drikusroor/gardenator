/**
 * Metric length formatting and parsing.
 *
 * The document stores metres; people designing a garden think in centimetres
 * for anything small and metres for anything big, so the formatter switches
 * automatically unless a unit is forced.
 */

export type Unit = 'm' | 'cm';

/**
 * Compact form for dimension labels and read-outs.
 *
 * Defaults to picking the unit by magnitude, because that is how people say a
 * measurement out loud: "45 cm" for a paving slab, "12,4 m" for a boundary.
 * The document's unit preference governs what you *type* into a field, not how
 * a 30 m fence is reported back to you.
 */
export function formatShort(metres: number, unit: Unit | 'auto' = 'auto'): string {
  const u = unit === 'auto' ? (Math.abs(metres) < 1 ? 'cm' : 'm') : unit;
  return u === 'cm' ? `${trim(metres * 100, 0)}cm` : `${trim(metres, 2)}m`;
}

/** Formats an area as m² with two decimals. */
export function formatArea(squareMetres: number): string {
  return `${trim(squareMetres, 2)} m²`;
}

/**
 * Parses a user-typed length into metres.
 *
 * Accepts "2.4", "2,4" (Dutch decimal comma), "240cm", "2.4 m", "2m40".
 * `defaultUnit` decides how a bare number is read.
 */
export function parseLength(input: string, defaultUnit: Unit): number | null {
  const raw = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!raw) return null;

  // "2m40" — metres and centimetres written together, as on a tape measure.
  const compound = raw.match(/^(-?\d+)m(\d+)$/);
  if (compound) {
    const sign = compound[1].startsWith('-') ? -1 : 1;
    return sign * (Math.abs(Number(compound[1])) + Number(compound[2]) / 100);
  }

  const match = raw.match(/^(-?[\d.,]+)(mm|cm|dm|m)?$/);
  if (!match) return null;

  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value)) return null;

  switch (match[2] ?? defaultUnit) {
    case 'mm':
      return value / 1000;
    case 'cm':
      return value / 100;
    case 'dm':
      return value / 10;
    default:
      return value;
  }
}

/** Value shown inside a numeric input for the current unit. */
export function toUnitValue(metres: number, unit: Unit): number {
  return unit === 'cm' ? round(metres * 100, 1) : round(metres, 3);
}

/** Inverse of `toUnitValue`. */
export function fromUnitValue(value: number, unit: Unit): number {
  return unit === 'cm' ? value / 100 : value;
}

/** Sensible input step for the current unit. */
export function unitStep(unit: Unit): number {
  return unit === 'cm' ? 1 : 0.01;
}

/** Minutes from midnight as "14:35". */
export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Day of year (1..365) as "21 June", using a non-leap reference year. */
export function formatDayOfYear(day: number): string {
  const date = new Date(Date.UTC(2001, 0, 1));
  date.setUTCDate(clamp(Math.round(day), 1, 365));
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function trim(value: number, decimals: number): string {
  // Number -> string never keeps trailing zeros, so rounding is all that is
  // needed to turn 2.4000000000000004 into "2.4".
  return String(round(value, decimals));
}
