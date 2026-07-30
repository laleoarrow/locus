/**
 * Text index: an ordered walk of the visible text nodes under a root,
 * concatenated into a single "page text" string. All anchoring math
 * (character positions, prefixes/suffixes, quote search) runs against it.
 */

export interface TextSegment {
  node: Text;
  /** Inclusive start offset of this node's text in the page text. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

export interface TextIndex {
  segments: TextSegment[];
  text: string;
}

/** Elements whose text never counts as page text. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

/** id of the Locus shadow host; its subtree is never indexed. */
export const LOCUS_HOST_ID = 'locus-host';

function isIndexable(node: Text): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP_TAGS.has(el.tagName) || el.id === LOCUS_HOST_ID) return false;
  }
  return true;
}

export function buildTextIndex(root: Node): TextIndex {
  const doc = root.ownerDocument;
  if (!doc) throw new Error('root must belong to a document');
  const segments: TextSegment[] = [];
  let text = '';
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    if (textNode.data.length === 0 || !isIndexable(textNode)) continue;
    const start = text.length;
    text += textNode.data;
    segments.push({ node: textNode, start, end: text.length });
  }
  return { segments, text };
}

/** Map a range boundary (container, offset) to a page-text offset. */
function boundaryToOffset(index: TextIndex, container: Node, offset: number): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const segment = index.segments.find((s) => s.node === container);
    if (!segment) return null;
    return segment.start + Math.min(offset, segment.end - segment.start);
  }
  // Element boundary: the position just before childNodes[offset] (or the end
  // of the container). Resolve to the first indexed text node at or after it.
  const ref = container.childNodes[offset] ?? null;
  for (const segment of index.segments) {
    if (ref) {
      if (segment.node === ref) return segment.start;
      const pos = ref.compareDocumentPosition(segment.node);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING || pos & Node.DOCUMENT_POSITION_CONTAINED_BY) {
        return segment.start;
      }
    } else {
      const pos = container.compareDocumentPosition(segment.node);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING && !(pos & Node.DOCUMENT_POSITION_CONTAINED_BY)) {
        return segment.start;
      }
    }
  }
  return index.text.length;
}

export function rangeToOffsets(index: TextIndex, range: Range): { start: number; end: number } | null {
  const start = boundaryToOffset(index, range.startContainer, range.startOffset);
  const end = boundaryToOffset(index, range.endContainer, range.endOffset);
  if (start === null || end === null || start >= end) return null;
  return { start, end };
}

function locate(index: TextIndex, offset: number, isEnd: boolean): { node: Text; offset: number } | null {
  for (const segment of index.segments) {
    const inSegment = isEnd
      ? offset > segment.start && offset <= segment.end
      : offset >= segment.start && offset < segment.end;
    if (inSegment) return { node: segment.node, offset: offset - segment.start };
  }
  return null;
}

/** Build a Range whose text-node boundaries cover [start, end) of the page text. */
export function offsetsToRange(index: TextIndex, start: number, end: number): Range | null {
  if (start < 0 || start >= end || end > index.text.length) return null;
  const startPoint = locate(index, start, false);
  const endPoint = locate(index, end, true);
  if (!startPoint || !endPoint) return null;
  const doc = startPoint.node.ownerDocument;
  if (!doc) return null;
  const range = doc.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}
