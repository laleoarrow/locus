/** Measure selected glyphs without including selected elements' padding or height. */
export function selectionTextRect(range: Range): DOMRect | null {
  if (range.collapsed) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const measure = (textRange: Range): void => {
    if (!textRange.toString().trim()) return;
    for (const rect of textRange.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
    }
  };

  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) measure(range);
  else {
    const doc = root.ownerDocument!;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const afterSubtree = (node: Node): Node | null => {
      while (node !== root) {
        if (node.nextSibling) return node.nextSibling;
        node = node.parentNode!;
      }
      return null;
    };
    const firstTextFrom = (node: Node | null): Node | null => {
      if (!node) return null;
      walker.currentNode = node;
      return node.nodeType === Node.TEXT_NODE ? node : walker.nextNode();
    };
    const boundaryNode = (container: Node, offset: number): Node | null =>
      container.nodeType === Node.TEXT_NODE ? container
        : container.childNodes[offset] ?? afterSubtree(container);
    // Find the first unselected text once, rather than comparing every node
    // with the range (costly when a selection spans many sibling elements).
    const end = range.endContainer.nodeType === Node.TEXT_NODE && range.endOffset > 0
      ? afterSubtree(range.endContainer) : boundaryNode(range.endContainer, range.endOffset);
    const stop = firstTextFrom(end);
    let node = firstTextFrom(boundaryNode(range.startContainer, range.startOffset));
    const textRange = doc.createRange();
    for (; node && node !== stop; node = walker.nextNode()) {
      textRange.selectNodeContents(node);
      if (node === range.startContainer) textRange.setStart(node, range.startOffset);
      if (node === range.endContainer) textRange.setEnd(node, range.endOffset);
      measure(textRange);
    }
  }
  return left === Infinity ? null : new DOMRect(left, top, right - left, bottom - top);
}
