import type { ColorKey } from './types';

export interface ColorSpec {
  label: string;
  /** Highlight background painted on the page. */
  bg: string;
  /** Solid swatch color for UI chips and image rings. */
  swatch: string;
}

/** Order matters: index + 1 is the keyboard shortcut (1 = fluorescent yellow). */
export const COLOR_KEYS: readonly ColorKey[] = ['yellow', 'teal', 'pink'];

export const COLORS: Record<ColorKey, ColorSpec> = {
  yellow: { label: 'Yellow', bg: 'rgba(255, 230, 0, 0.5)', swatch: '#ffe600' },
  teal: { label: 'Teal', bg: 'rgba(77, 208, 196, 0.45)', swatch: '#4dd0c4' },
  pink: { label: 'Pink', bg: 'rgba(246, 168, 192, 0.55)', swatch: '#f6a8c0' },
};

export const DEFAULT_COLOR: ColorKey = 'yellow';

export function isColorKey(value: unknown): value is ColorKey {
  return typeof value === 'string' && (COLOR_KEYS as readonly string[]).includes(value);
}

/** Shortcut digit (1-based) → color. */
export function colorForDigit(digit: number): ColorKey | undefined {
  return COLOR_KEYS[digit - 1];
}
