import type { BuiltinColorKey, ColorKey, CustomColor } from './types';

export interface ColorSpec {
  label: string;
  /** Highlight background painted on the page. */
  bg: string;
  /** Solid swatch color for UI chips and image rings. */
  swatch: string;
}

export interface PaletteEntry extends ColorSpec {
  key: ColorKey;
}

/** Order matters: index + 1 is the keyboard shortcut (1 = fluorescent yellow). */
export const BUILTIN_COLOR_KEYS: readonly BuiltinColorKey[] = ['yellow', 'teal', 'pink'];

export const COLORS: Record<BuiltinColorKey, ColorSpec> = {
  yellow: { label: 'Yellow', bg: 'rgba(255, 230, 0, 0.5)', swatch: '#ffe600' },
  teal: { label: 'Teal', bg: 'rgba(77, 208, 196, 0.45)', swatch: '#4dd0c4' },
  pink: { label: 'Pink', bg: 'rgba(246, 168, 192, 0.55)', swatch: '#f6a8c0' },
};

export const DEFAULT_COLOR: BuiltinColorKey = 'yellow';

/** Builtins first (fixed shortcuts 1–3), then user colors in added order. */
export function buildPalette(customColors: CustomColor[]): PaletteEntry[] {
  return [
    ...BUILTIN_COLOR_KEYS.map((key) => ({ key: key as ColorKey, ...COLORS[key] })),
    ...customColors.map(({ key, label, swatch, bg }) => ({ key, label, swatch, bg })),
  ];
}

/** Spec for any color key; unknown (e.g. removed custom) keys fall back to yellow. */
export function specFor(key: ColorKey, customColors: CustomColor[]): ColorSpec {
  const entry = buildPalette(customColors).find((c) => c.key === key);
  return entry ?? COLORS[DEFAULT_COLOR];
}

/** Shortcut digit (1-based, palette order) → color key. */
export function colorForDigit(digit: number, palette: PaletteEntry[]): ColorKey | undefined {
  return digit >= 1 && digit <= 9 ? palette[digit - 1]?.key : undefined;
}

/** Build a CustomColor from a `#rrggbb` picker value. */
export function customColorFromHex(hex: string): CustomColor | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = match[1]?.toLowerCase() ?? '';
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return {
    key: `c${value}`,
    label: `#${value}`,
    swatch: `#${value}`,
    bg: `rgba(${r}, ${g}, ${b}, 0.45)`,
  };
}
