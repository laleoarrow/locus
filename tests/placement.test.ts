import { describe, expect, it } from 'vitest';
import { choosePlacement, resolvePlacement, resolveToolbarPosition, toolbarBox, type Box, type PlacementInput } from '@/domain/placement';

const base: PlacementInput = {
  selection: { top: 300, left: 200, right: 400, bottom: 320 },
  toolbarWidth: 160,
  toolbarHeight: 40,
  gap: 10,
  viewportWidth: 1000,
  viewportHeight: 800,
  obstacles: [],
  margin: 8,
};

/** A rival toolbar sitting immediately below the selection. */
const rivalBelow = { top: 326, left: 200, right: 440, bottom: 366 };
const rivalAbove = { top: 240, left: 200, right: 440, bottom: 290 };

describe('toolbarBox (U25)', () => {
  it('centres on the selection and clamps to the viewport', () => {
    expect(toolbarBox(base, 'below')).toEqual({ top: 330, left: 220, right: 380, bottom: 370 });
    const nearLeftEdge = { ...base, selection: { top: 300, left: 0, right: 20, bottom: 320 } };
    expect(toolbarBox(nearLeftEdge, 'below').left).toBe(8);
    const nearRightEdge = { ...base, selection: { top: 300, left: 980, right: 1000, bottom: 320 } };
    expect(toolbarBox(nearRightEdge, 'below').right).toBe(992);
  });

  it('places above by subtracting its own height', () => {
    expect(toolbarBox(base, 'above')).toMatchObject({ top: 250, bottom: 290 });
  });
});

describe('choosePlacement (U26)', () => {
  it('prefers below when nothing is in the way', () => {
    expect(choosePlacement(base)).toBe('below');
  });

  it('flips above when another toolbar occupies the space below', () => {
    expect(choosePlacement({ ...base, obstacles: [rivalBelow] })).toBe('above');
  });

  it('flips below when the obstacle is above', () => {
    expect(choosePlacement({ ...base, obstacles: [rivalAbove] })).toBe('below');
  });

  it('picks the less-obstructed side when both collide', () => {
    // A wide rival below, a rival above that barely clips the corner.
    const clipsAbove = { top: 250, left: 370, right: 390, bottom: 260 };
    expect(choosePlacement({ ...base, obstacles: [rivalBelow, clipsAbove] })).toBe('above');
  });

  it('ignores obstacles that do not overlap horizontally', () => {
    const farRight = { top: 326, left: 700, right: 900, bottom: 366 };
    expect(choosePlacement({ ...base, obstacles: [farRight] })).toBe('below');
  });

  it('goes above when the selection is at the bottom of the viewport', () => {
    const atBottom = { ...base, selection: { top: 760, left: 200, right: 400, bottom: 790 } };
    expect(choosePlacement(atBottom)).toBe('above');
  });

  it('goes below when the selection is at the very top', () => {
    const atTop = { ...base, selection: { top: 0, left: 200, right: 400, bottom: 20 } };
    expect(choosePlacement(atTop)).toBe('below');
  });

  it('falls back to the roomier side when both are blocked and squashed', () => {
    const tight = {
      ...base,
      selection: { top: 380, left: 200, right: 400, bottom: 400 },
      viewportHeight: 420,
      obstacles: [
        { top: 0, left: 0, right: 1000, bottom: 420 - 0.001 },
      ],
    };
    expect(['below', 'above']).toContain(choosePlacement(tight));
  });
});

describe('resolvePlacement (U26)', () => {
  it('honours an explicit preference without consulting geometry', () => {
    const blocked = { ...base, obstacles: [rivalBelow] };
    expect(resolvePlacement('below', blocked)).toBe('below');
    expect(resolvePlacement('above', blocked)).toBe('above');
    expect(resolvePlacement('auto', blocked)).toBe('above');
  });
});

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

describe('resolveToolbarPosition', () => {
  it('moves sideways when rivals occupy both centred positions', () => {
    const input = { ...base, obstacles: [rivalBelow, rivalAbove] };
    const { box } = resolveToolbarPosition('auto', input);
    expect(overlaps(box, input.selection)).toBe(false);
    for (const obstacle of input.obstacles) expect(overlaps(box, obstacle)).toBe(false);
    expect(box.left).toBeGreaterThanOrEqual(input.margin);
    expect(box.right).toBeLessThanOrEqual(input.viewportWidth - input.margin);
  });

  it('moves beyond full-width rival bars when there is no horizontal escape', () => {
    const obstacles = [
      { top: 326, left: 0, right: 1000, bottom: 390 },
      { top: 230, left: 0, right: 1000, bottom: 294 },
    ];
    const { box } = resolveToolbarPosition('auto', { ...base, obstacles });
    for (const obstacle of [...obstacles, base.selection]) expect(overlaps(box, obstacle)).toBe(false);
    expect(box.bottom <= 230 - base.gap || box.top >= 390 + base.gap).toBe(true);
  });

  it('keeps a gap even when a rival only nearly touches the toolbar', () => {
    const obstacle = { top: 373, bottom: 413, left: 200, right: 440 };
    const { box } = resolveToolbarPosition('auto', { ...base, obstacles: [obstacle] });
    expect(box.bottom).toBeLessThanOrEqual(obstacle.top - base.gap);
  });

  it('avoids the selected text when both vertical positions are clamped onto it', () => {
    const input = {
      ...base,
      viewportHeight: 100,
      selection: { top: 20, left: 200, right: 400, bottom: 80 },
    };
    const { box } = resolveToolbarPosition('auto', input);
    expect(overlaps(box, input.selection)).toBe(false);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.bottom).toBeLessThanOrEqual(92);
  });

  it('keeps an explicit side even when a rival occupies it', () => {
    const input = { ...base, obstacles: [rivalBelow, rivalAbove] };
    expect(resolveToolbarPosition('below', input)).toEqual({ placement: 'below', box: toolbarBox(input, 'below') });
    expect(resolveToolbarPosition('above', input)).toEqual({ placement: 'above', box: toolbarBox(input, 'above') });
  });

  it('stays inside the viewport when every candidate is obstructed', () => {
    const input = { ...base, obstacles: [{ top: 0, left: 0, right: 1000, bottom: 800 }] };
    const { box } = resolveToolbarPosition('auto', input);
    expect(overlaps(box, input.selection)).toBe(false);
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.right).toBeLessThanOrEqual(992);
    expect(box.bottom).toBeLessThanOrEqual(792);
  });
});
