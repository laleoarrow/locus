import { describe, expect, it } from 'vitest';
import {
  buildPalette,
  colorForDigit,
  customColorFromHex,
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

  it('falls back to yellow for unknown (removed) color keys', () => {
    expect(specFor('c8e44ad', []).swatch).toBe('#ffe600');
    expect(specFor('c8e44ad', purple ? [purple] : []).swatch).toBe('#8e44ad');
  });
});
