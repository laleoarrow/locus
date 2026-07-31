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
