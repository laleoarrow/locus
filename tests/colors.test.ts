import { describe, expect, it } from 'vitest';
import {
  buildPalette,
  buildPaletteForKeys,
  colorForDigit,
  customColorFromHex,
  resolvePageColorEvents,
  specFor,
} from '@/domain/colors';

const purple = customColorFromHex('#8e44ad');

describe('palette (U14)', () => {
  it('builds custom colors from hex picker values', () => {
    expect(purple).toEqual({
      key: 'c8e44ad',
      label: '#8e44ad',
      swatch: '#8e44ad',
      bg: 'rgba(142, 68, 173, 0.45)',
    });
    expect(customColorFromHex('not-a-color')).toBeNull();
  });

  it('orders builtins first, then custom colors (shortcut digits)', () => {
    const palette = buildPalette(purple ? [purple] : []);
    expect(palette.map((c) => c.key)).toEqual(['yellow', 'teal', 'pink', 'c8e44ad']);
    expect(colorForDigit(1, palette)).toBe('yellow');
    expect(colorForDigit(4, palette)).toBe('c8e44ad');
    expect(colorForDigit(5, palette)).toBeUndefined();
    expect(colorForDigit(0, palette)).toBeUndefined();
  });

  it('recovers canonical custom colors from their key and rejects invalid keys', () => {
    expect(specFor('c8e44ad', []).swatch).toBe('#8e44ad');
    expect(specFor('c8e44ad', purple ? [purple] : []).swatch).toBe('#8e44ad');
    expect(specFor('not-a-color', []).swatch).toBe('#ffe600');
  });

  it('builds a deduplicated page palette without leaking catalog-only colors', () => {
    const blue = customColorFromHex('#336699');
    const palette = buildPaletteForKeys(
      ['c8e44ad', 'c8e44ad', 'not-a-color'],
      [purple, blue].filter((color) => color !== null),
    );
    expect(palette.map((entry) => entry.key)).toEqual([
      'yellow',
      'teal',
      'pink',
      'c8e44ad',
    ]);
  });

  it('resolves equal-timestamp page events independently of merge order', () => {
    const events = [
      { key: 'c111111', enabled: true, addedAt: 20, updatedAt: 100 },
      { key: 'c111111', enabled: true, addedAt: 10, updatedAt: 100 },
      { key: 'c222222', enabled: true, addedAt: 10, updatedAt: 100 },
      { key: 'é', enabled: true, addedAt: 10, updatedAt: 100 },
      { key: 'e\u0301', enabled: true, addedAt: 10, updatedAt: 100 },
      { key: 'c333333', enabled: true, addedAt: 30, updatedAt: 100 },
      { key: 'c333333', enabled: false, addedAt: 30, updatedAt: 100 },
    ];
    const forward = resolvePageColorEvents(events);
    const reverse = resolvePageColorEvents([...events].reverse());
    expect(forward).toEqual(reverse);
    expect(forward.map((event) => [event.key, event.addedAt])).toEqual([
      ['c111111', 10],
      ['c222222', 10],
      ['e\u0301', 10],
      ['é', 10],
    ]);
  });
});
