import type { ColorKey } from './types';

export interface ColorSpec {
  label: string;
  /** Highlight background painted on the page. */
  bg: string;
  /** Solid swatch color for UI chips. */
  swatch: string;
}

export const COLOR_KEYS: readonly ColorKey[] = ['yellow', 'green', 'blue', 'pink', 'orange'];

export const COLORS: Record<ColorKey, ColorSpec> = {
  yellow: { label: 'Yellow', bg: 'rgba(255, 213, 79, 0.45)', swatch: '#f5c518' },
  green: { label: 'Green', bg: 'rgba(129, 199, 132, 0.45)', swatch: '#4caf50' },
  blue: { label: 'Blue', bg: 'rgba(100, 181, 246, 0.45)', swatch: '#2196f3' },
  pink: { label: 'Pink', bg: 'rgba(244, 143, 177, 0.45)', swatch: '#ec407a' },
  orange: { label: 'Orange', bg: 'rgba(255, 171, 64, 0.45)', swatch: '#fb8c00' },
};

export const DEFAULT_COLOR: ColorKey = 'yellow';

export function isColorKey(value: unknown): value is ColorKey {
  return typeof value === 'string' && (COLOR_KEYS as readonly string[]).includes(value);
}
