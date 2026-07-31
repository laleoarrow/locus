import type { BuiltinColorKey, ColorKey, CustomColor, PageColorEvent } from './types';

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
/** Automatic choices: three builtins plus at most two legacy page colors. */
export const DEFAULT_TOOLBAR_COLOR_LIMIT = 5;

/**
 * Resolve append-only page-color events deterministically on every device.
 * A removal wins an exact timestamp tie; otherwise the original (earliest)
 * added position wins so shortcut ordering cannot depend on backup union order.
 */
export function resolvePageColorEvents(events: PageColorEvent[]): PageColorEvent[] {
  const latest = new Map<ColorKey, PageColorEvent>();
  for (const event of events) {
    const previous = latest.get(event.key);
    const replacesPrevious =
      !previous ||
      event.updatedAt > previous.updatedAt ||
      (event.updatedAt === previous.updatedAt &&
        (previous.enabled !== event.enabled
          ? !event.enabled
          : event.addedAt < previous.addedAt));
    if (replacesPrevious) latest.set(event.key, event);
  }
  return [...latest.values()]
    .filter((event) => event.enabled)
    .sort((a, b) =>
      a.addedAt - b.addedAt ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
}

/** Builtins first (fixed shortcuts 1–3), then user colors in added order. */
export function buildPalette(customColors: CustomColor[]): PaletteEntry[] {
  return [
    ...BUILTIN_COLOR_KEYS.map((key) => ({ key: key as ColorKey, ...COLORS[key] })),
    ...customColors.map(({ key, label, swatch, bg }) => ({ key, label, swatch, bg })),
  ];
}

/** Recover a picker-created color from its canonical `c<rrggbb>` key. */
export function customColorFromKey(key: ColorKey): CustomColor | null {
  const match = /^c([0-9a-f]{6})$/i.exec(key);
  return match ? customColorFromHex(`#${match[1]}`) : null;
}

/**
 * Builtins plus only the requested custom keys. Catalog-only colors never
 * leak into an unrelated page; canonical picker keys remain self-describing.
 */
export function buildPaletteForKeys(
  keys: ColorKey[],
  catalog: CustomColor[],
): PaletteEntry[] {
  const byKey = new Map(catalog.map((color) => [color.key, color]));
  const seen = new Set<string>();
  const custom: CustomColor[] = [];
  for (const key of keys) {
    if ((BUILTIN_COLOR_KEYS as readonly string[]).includes(key) || seen.has(key)) continue;
    const color = byKey.get(key) ?? customColorFromKey(key);
    if (!color) continue;
    seen.add(key);
    custom.push(color);
  }
  return buildPalette(custom);
}

/** Spec for any color key; invalid unknown keys fall back to yellow. */
export function specFor(key: ColorKey, customColors: CustomColor[]): ColorSpec {
  const entry = buildPalette(customColors).find((c) => c.key === key);
  return entry ?? customColorFromKey(key) ?? COLORS[DEFAULT_COLOR];
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
