import type { ToolbarPlacement } from './types';

/** Minimal rectangle shape (a DOMRect satisfies this). */
export interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface PlacementInput {
  /** Bounding box of the selection (or image) the toolbar points at. */
  selection: Box;
  toolbarWidth: number;
  toolbarHeight: number;
  /** Distance between the selection and the toolbar. */
  gap: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Boxes of other floating UI already on screen. */
  obstacles: Box[];
  /** Keep-out margin from the viewport edges. */
  margin: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/** Where the toolbar would land on a given side, after edge clamping. */
export function toolbarBox(input: PlacementInput, side: 'below' | 'above'): Box {
  const { selection, toolbarWidth, toolbarHeight, gap, viewportWidth, viewportHeight, margin } = input;
  const centered = selection.left + (selection.right - selection.left) / 2 - toolbarWidth / 2;
  const left = clamp(centered, margin, Math.max(margin, viewportWidth - toolbarWidth - margin));
  const wanted = side === 'below' ? selection.bottom + gap : selection.top - gap - toolbarHeight;
  const top = clamp(wanted, margin, Math.max(margin, viewportHeight - toolbarHeight - margin));
  return { top, left, right: left + toolbarWidth, bottom: top + toolbarHeight };
}

/** True when the side has room without clamping (i.e. it is not squashed). */
function fits(input: PlacementInput, side: 'below' | 'above'): boolean {
  const { selection, toolbarHeight, gap, viewportHeight, margin } = input;
  return side === 'below'
    ? selection.bottom + gap + toolbarHeight <= viewportHeight - margin
    : selection.top - gap - toolbarHeight >= margin;
}

function collisionArea(input: PlacementInput, side: 'below' | 'above'): number {
  const box = toolbarBox(input, side);
  return input.obstacles.reduce((total, obstacle) => total + overlapArea(box, obstacle), 0);
}

/**
 * Choose which side of the selection the toolbar goes on.
 *
 * Collision is measured as rectangle overlap rather than by hit-testing sample
 * points: rival toolbars are routinely wrapped in a `pointer-events: none`
 * layer, which `elementsFromPoint` skips entirely, and a single probe column
 * misses anything that only overlaps part of our width.
 *
 * Preference order: a side that fits and is clear → the clear side even if
 * squashed → the side with less overlap → whichever has more room.
 */
export function choosePlacement(input: PlacementInput): 'below' | 'above' {
  const belowFits = fits(input, 'below');
  const aboveFits = fits(input, 'above');
  const belowHit = collisionArea(input, 'below');
  const aboveHit = collisionArea(input, 'above');

  if (belowFits && belowHit === 0) return 'below';
  if (aboveFits && aboveHit === 0) return 'above';
  if (belowHit === 0 && aboveHit > 0) return 'below';
  if (aboveHit === 0 && belowHit > 0) return 'above';
  if (belowHit !== aboveHit) return belowHit < aboveHit ? 'below' : 'above';
  if (belowFits !== aboveFits) return belowFits ? 'below' : 'above';
  const roomBelow = input.viewportHeight - input.selection.bottom;
  return roomBelow >= input.selection.top ? 'below' : 'above';
}

/** Resolve the user's preference, consulting geometry only for 'auto'. */
export function resolvePlacement(
  preference: ToolbarPlacement,
  input: PlacementInput,
): 'below' | 'above' {
  return preference === 'auto' ? choosePlacement(input) : preference;
}

/** Prefer the usual centred positions, then search nearby obstacle edges. */
export function resolveToolbarPosition(
  preference: ToolbarPlacement,
  input: PlacementInput,
): { placement: 'below' | 'above'; box: Box } {
  const placement = resolvePlacement(preference, input);
  const preferred = toolbarBox(input, placement);
  if (preference !== 'auto') return { placement, box: preferred };

  const { selection, toolbarWidth: width, toolbarHeight: height, margin, gap } = input;
  const expand = (box: Box): Box => ({
    left: box.left - gap, right: box.right + gap,
    top: box.top - gap, bottom: box.bottom + gap,
  });
  const selected = expand(selection);
  const obstacles = input.obstacles.map(expand);
  const collision = (box: Box): number => obstacles.reduce((sum, obstacle) => sum + overlapArea(box, obstacle), 0);
  const opposite = toolbarBox(input, placement === 'below' ? 'above' : 'below');
  for (const box of [preferred, opposite]) {
    if (overlapArea(box, selected) === 0 && collision(box) === 0) {
      return { placement: box === preferred ? placement : placement === 'below' ? 'above' : 'below', box };
    }
  }

  const maxLeft = Math.max(margin, input.viewportWidth - width - margin);
  const maxTop = Math.max(margin, input.viewportHeight - height - margin);
  // Dodging a rival must not detach the toolbar from the selected text. Bound
  // the shortest rectangle-to-rectangle gap, including diagonal escapes.
  const reach = Math.max(96, 2 * height + gap);
  const minLeft = Math.max(margin, selection.left - width - reach);
  const nearMaxLeft = Math.min(maxLeft, selection.right + reach);
  if (minLeft > nearMaxLeft) return { placement, box: preferred };
  const xs = new Set([clamp(preferred.left, minLeft, nearMaxLeft), minLeft, nearMaxLeft]);
  for (const box of [selected, ...obstacles]) {
    xs.add(clamp(box.left - width, minLeft, nearMaxLeft));
    xs.add(clamp(box.right, minLeft, nearMaxLeft));
  }
  const verticalBounds = (left: number): [number, number] => {
    const dx = Math.max(selection.left - left - width, left - selection.right, 0);
    const dy = Math.sqrt(Math.max(0, reach * reach - dx * dx));
    return [Math.max(margin, selection.top - height - dy), Math.min(maxTop, selection.bottom + dy)];
  };
  const preferredDistance = (left: number, top: number): number =>
    (left - preferred.left) ** 2 + (top - preferred.top) ** 2;
  const anchorDistance = (left: number, top: number): number => Math.min(
    preferredDistance(left, top), (left - opposite.left) ** 2 + (top - opposite.top) ** 2,
  );

  // At each horizontal edge, merge the blocked vertical intervals and choose
  // the nearest free gap. This avoids testing every X/Y/obstacle combination
  // on pages with many floating elements (quadratic-logarithmic, not cubic).
  let clear: Box | undefined;
  let clearDistance = Infinity;
  let clearPreferredDistance = Infinity;
  for (const left of xs) {
    const [minTop, nearMaxTop] = verticalBounds(left);
    if (minTop > nearMaxTop) continue;
    const intervals = [selected, ...obstacles]
      .filter((box) => box.left < left + width && box.right > left)
      .map((box) => [box.top - height, box.bottom] as const)
      .sort((a, b) => a[0] - b[0]);
    const offerGap = (start: number, end: number): void => {
      if (start > end || start > nearMaxTop || end < minTop) return;
      for (const anchor of [preferred, opposite]) {
        const top = clamp(anchor.top, Math.max(minTop, start), Math.min(nearMaxTop, end));
        const distance = anchorDistance(left, top);
        const preferenceDistance = preferredDistance(left, top);
        if (distance < clearDistance || (distance === clearDistance && preferenceDistance < clearPreferredDistance)) {
          clear = { left, top, right: left + width, bottom: top + height };
          clearDistance = distance;
          clearPreferredDistance = preferenceDistance;
        }
      }
    };
    let cursor = margin;
    for (const [start, end] of intervals) {
      offerGap(cursor, start);
      cursor = Math.max(cursor, end);
    }
    offerGap(cursor, maxTop);
  }

  // If nearby space is obstructed, keep text uncovered when possible, then
  // minimise overlap locally instead of escaping to a distant viewport edge.
  let best = preferred;
  let bestSelected = overlapArea(best, selected);
  let bestCollision = collision(best);
  let bestDistance = 0;
  let bestPreferredDistance = 0;
  if (clear) best = clear;
  else {
    for (const left of xs) {
      const [minTop, nearMaxTop] = verticalBounds(left);
      if (minTop > nearMaxTop) continue;
      for (const wanted of [preferred.top, opposite.top, minTop, nearMaxTop]) {
        const top = clamp(wanted, minTop, nearMaxTop);
        const box = { left, top, right: left + width, bottom: top + height };
        const selectedHit = overlapArea(box, selected);
        const hit = collision(box);
        const distance = anchorDistance(left, top);
        const preferenceDistance = preferredDistance(left, top);
        if (selectedHit < bestSelected || (selectedHit === bestSelected &&
          (hit < bestCollision || (hit === bestCollision && (distance < bestDistance ||
            (distance === bestDistance && preferenceDistance < bestPreferredDistance)))))) {
          best = box;
          bestSelected = selectedHit;
          bestCollision = hit;
          bestDistance = distance;
          bestPreferredDistance = preferenceDistance;
        }
      }
    }
  }
  return {
    placement: best.top + height / 2 < (selection.top + selection.bottom) / 2 ? 'above' : 'below',
    box: best,
  };
}
