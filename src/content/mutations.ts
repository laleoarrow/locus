import { buildImageIndex, resolveImageAnchor, type ImageIndex } from '@/domain/anchor/image';
import type { AnchorPayload } from '@/domain/types';

export interface MutationAnchor {
  anchor: AnchorPayload;
  detached: boolean;
  range: Range | null;
  image: HTMLImageElement | null;
}

function hasImage(node: Node): boolean {
  return node instanceof Element && (node.matches('img, picture, source') ||
    node.querySelector('img, picture, source') !== null);
}

/** Check live targets before paying for a full-page text index and restoration. */
export function mutationAnchorWork(
  records: MutationRecord[], targets: MutationAnchor[], root: Element, imageLoaded = false,
): 'reanchor' | 'retry' | null {
  const textChanged = records.some((record) => record.type !== 'attributes');
  const imagesChanged = imageLoaded || records.some((record) => record.type === 'attributes'
    ? ['src', 'srcset', 'sizes', 'alt', 'media', 'type'].includes(record.attributeName ?? '')
    : record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(hasImage));

  const shareImageIndex = imagesChanged && targets.reduce((count, target) => count + Number(target.anchor.kind === 'image'), 0) > 1;
  let imageIndex: ImageIndex | undefined;
  for (const target of targets) {
    if (target.anchor.kind === 'image') {
      if (imagesChanged) {
        if (shareImageIndex) imageIndex ??= buildImageIndex(root);
        const resolved = resolveImageAnchor(target.anchor, root, imageIndex);
        if (resolved !== target.image || (!resolved && !target.detached)) return 'reanchor';
      }
    } else if (textChanged && !target.detached) {
      const range = target.range;
      // Live ranges track harmless insertions before an excerpt automatically.
      // Capture and resolve use exact text, without whitespace normalization.
      if (!range || range.collapsed || !root.contains(range.startContainer) ||
        !root.contains(range.endContainer) || range.toString() !== target.anchor.exact) return 'reanchor';
    }
  }

  if (!textChanged) return null;
  const detachedQuotes = targets.flatMap(({ anchor, detached }) =>
    detached && anchor.kind !== 'image' && typeof anchor.exact === 'string' && anchor.exact.length > 0
      ? [anchor.exact] : []);
  if (detachedQuotes.length === 0) return null;
  for (const record of records) {
    // A change below the root can join an excerpt across adjacent inline nodes.
    // For root-level insertions, inspect the new subtree, not the entire page.
    const nodes = record.type === 'characterData' ? [record.target.parentNode ?? record.target]
      : record.type === 'childList' ? record.target === root ? [...record.addedNodes] : [record.target] : [];
    for (const node of nodes) {
      if (!root.contains(node)) continue;
      const text = node.textContent ?? '';
      if (detachedQuotes.some((quote) => text.includes(quote))) return 'retry';
    }
  }
  return null;
}
