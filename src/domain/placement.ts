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
  const xs = new Set([preferred.left, margin, maxLeft]);
  for (const box of [selected, ...obstacles]) {
    xs.add(clamp(box.left - width, margin, maxLeft));
    xs.add(clamp(box.right, margin, maxLeft));
  }

  // At each horizontal edge, merge the blocked vertical intervals and choose
  // the nearest free gap. This avoids testing every X/Y/obstacle combination
  // on pages with many floating elements (quadratic-logarithmic, not cubic).
  let clear: Box | undefined;
  let clearDistance = Infinity;
  for (const left of xs) {
    const intervals = [selected, ...obstacles]
      .filter((box) => box.left < left + width && box.right > left)
      .map((box) => [box.top - height, box.bottom] as const)
      .sort((a, b) => a[0] - b[0]);
    const offerGap = (start: number, end: number): void => {
      if (start > end || start > maxTop || end < margin) return;
      const top = clamp(preferred.top, Math.max(margin, start), Math.min(maxTop, end));
      const distance = (left - preferred.left) ** 2 + (top - preferred.top) ** 2;
      if (distance < clearDistance) {
        clear = { left, top, right: left + width, bottom: top + height };
        clearDistance = distance;
      }
    };
    let cursor = margin;
    for (const [start, end] of intervals) {
      offerGap(cursor, start);
      cursor = Math.max(cursor, end);
    }
    offerGap(cursor, maxTop);
  }

  // If the viewport has no clear space, keep text uncovered when possible,
  // then minimise overlap among the usual rows and viewport edges.
  let best = preferred;
  let bestSelected = overlapArea(best, selected);
  let bestCollision = collision(best);
  let bestDistance = 0;
  if (clear) best = clear;
  else {
    for (const left of xs) {
      for (const top of [preferred.top, opposite.top, margin, maxTop]) {
        const box = { left, top, right: left + width, bottom: top + height };
        const selectedHit = overlapArea(box, selected);
        const hit = collision(box);
        const distance = (left - preferred.left) ** 2 + (top - preferred.top) ** 2;
        if (selectedHit < bestSelected || (selectedHit === bestSelected &&
          (hit < bestCollision || (hit === bestCollision && distance < bestDistance)))) {
          best = box;
          bestSelected = selectedHit;
          bestCollision = hit;
          bestDistance = distance;
        }
      }
    }
  }
  return {
    placement: best.top + height / 2 < (selection.top + selection.bottom) / 2 ? 'above' : 'below',
    box: best,
  };
}
