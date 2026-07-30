import { defineContentScript } from 'wxt/utils/define-content-script';
import { HighlightRenderer } from '@/content/highlights';
import { LocusUI } from '@/content/ui';
import { captureAnchor } from '@/domain/anchor/capture';
import { captureImageAnchor, resolveImageAnchor } from '@/domain/anchor/image';
import { resolveAnchor } from '@/domain/anchor/resolve';
import { buildTextIndex, type TextIndex } from '@/domain/anchor/textIndex';
import { colorForDigit, DEFAULT_COLOR } from '@/domain/colors';
import type { AnchorPayload, AnchorState, AnnotationWithAnchor, ColorKey } from '@/domain/types';
import { requestBg, type AnchorStateReply, type TabMessage } from '@/messaging/protocol';

/** How long after load we keep retrying detached anchors on DOM mutations. */
const MUTATION_WATCH_MS = 15_000;
const MUTATION_DEBOUNCE_MS = 300;

interface Entry {
  item: AnnotationWithAnchor;
  state: AnchorState;
}

type PendingTarget =
  | { type: 'text'; range: Range }
  | { type: 'image'; image: HTMLImageElement };

type UndoAction = { action: 'create' | 'delete'; annotationId: string };

class LocusContent {
  private readonly doc = document;
  private readonly renderer = new HighlightRenderer(document);
  private readonly ui: LocusUI;
  private entries = new Map<string, Entry>();
  private index: TextIndex = buildTextIndex(document.body);
  private lastColor: ColorKey = DEFAULT_COLOR;
  private urlKey = '';
  private pending: PendingTarget | null = null;
  /** Per-tab undo stack for Cmd/Ctrl+Z (creates and note-editor deletes). */
  private readonly undoStack: UndoAction[] = [];

  constructor() {
    this.ui = new LocusUI(this.doc, {
      onHighlight: (color) => void this.createFromPending(color),
    });
  }

  async start(): Promise<void> {
    const bootstrap = await requestBg({
      type: 'source:bootstrap',
      url: location.href,
      title: this.doc.title,
    });
    if (!bootstrap) return;
    this.lastColor = bootstrap.lastColor;
    this.urlKey = bootstrap.source.urlKey;
    this.setItems(bootstrap.items);
    this.anchorAll();
    this.wirePointer();
    this.wireKeyboard();
    this.wireMessages();
    this.watchMutations();
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.renderer.repositionRings(), 150);
    });
  }

  private setItems(items: AnnotationWithAnchor[]): void {
    const previous = this.entries;
    this.entries = new Map(
      items.map((item) => [
        item.annotation.id,
        { item, state: previous.get(item.annotation.id)?.state ?? 'detached' } satisfies Entry,
      ]),
    );
  }

  /** Re-anchor and re-render everything against a fresh text index. */
  private anchorAll(): void {
    this.index = buildTextIndex(this.doc.body);
    let anchored = 0;
    let detached = 0;
    for (const [id, entry] of this.entries) {
      if (this.anchorOne(id, entry)) anchored++;
      else detached++;
    }
    // Mirror state onto <html> attributes: observable by tests and tools
    // without page-world coupling; not part of the article content.
    this.doc.documentElement.setAttribute('data-locus-anchored', String(anchored));
    this.doc.documentElement.setAttribute('data-locus-detached', String(detached));
    chrome.runtime
      .sendMessage({ type: 'anchor-state:changed', urlKey: this.urlKey })
      .catch(() => undefined);
  }

  private anchorOne(id: string, entry: Entry): boolean {
    const { anchor } = entry.item;
    const color = entry.item.annotation.color;
    if (anchor.kind === 'image') {
      const image = resolveImageAnchor(anchor, this.doc.body);
      if (image) {
        this.renderer.setImage(id, color, image);
        entry.state = 'anchored';
        return true;
      }
    } else {
      const resolved = resolveAnchor(anchor, this.index, this.doc.body);
      if (resolved) {
        this.renderer.set(id, color, resolved.range);
        entry.state = 'anchored';
        return true;
      }
    }
    this.renderer.clear(id);
    entry.state = 'detached';
    return false;
  }

  private states(): Record<string, AnchorState> {
    return Object.fromEntries([...this.entries].map(([id, e]) => [id, e.state]));
  }

  private async refresh(): Promise<void> {
    const result = await requestBg({ type: 'annotations:list', url: location.href });
    if (!result) return;
    const keep = new Set(result.items.map((i) => i.annotation.id));
    for (const id of this.entries.keys()) {
      if (!keep.has(id)) this.renderer.clear(id);
    }
    this.setItems(result.items);
    this.anchorAll();
  }

  private captureFromPending(): AnchorPayload | null {
    if (!this.pending) return null;
    if (this.pending.type === 'image') return captureImageAnchor(this.pending.image, this.doc.body);
    this.index = buildTextIndex(this.doc.body);
    return captureAnchor(this.pending.range, this.index, this.doc.body);
  }

  private async createFromPending(color: ColorKey): Promise<void> {
    const anchor = this.captureFromPending();
    this.ui.hideToolbar();
    this.doc.getSelection()?.removeAllRanges();
    this.pending = null;
    if (!anchor) return;
    const created = await requestBg({
      type: 'annotation:create',
      url: location.href,
      title: this.doc.title,
      color,
      comment: '',
      anchor,
    });
    if (!created) return;
    this.lastColor = color;
    this.undoStack.push({ action: 'create', annotationId: created.item.annotation.id });
    await this.refresh();
  }

  private async performUndo(): Promise<boolean> {
    const last = this.undoStack.pop();
    if (!last) return false;
    if (last.action === 'create') {
      await requestBg({ type: 'annotation:delete', id: last.annotationId });
    } else {
      await requestBg({ type: 'annotation:undelete', id: last.annotationId });
    }
    await this.refresh();
    return true;
  }

  private openNoteFor(id: string, at: DOMRect): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.ui.hideToolbar();
    this.ui.openNoteEditor({
      rect: at,
      color: entry.item.annotation.color,
      initial: entry.item.annotation.comment,
      onSave: (text) => {
        void requestBg({ type: 'annotation:set-comment', id, comment: text }).then(() =>
          this.refresh(),
        );
      },
      onDelete: () => {
        this.undoStack.push({ action: 'delete', annotationId: id });
        void requestBg({ type: 'annotation:delete', id }).then(() => this.refresh());
      },
    });
  }

  private wirePointer(): void {
    this.doc.addEventListener('mouseup', (event) => {
      if (this.ui.containsEvent(event)) return;
      setTimeout(() => this.handlePointerUp(event), 0);
    });
    this.doc.addEventListener('mousedown', (event) => {
      if (!this.ui.containsEvent(event)) {
        this.ui.hideToolbar();
        this.ui.closeNoteEditor();
      }
    });
    this.doc.addEventListener('keyup', (event) => {
      if (event.key.startsWith('Arrow') || event.key === 'Shift') {
        if (!this.ui.containsEvent(event)) setTimeout(() => this.showToolbarForSelection(), 0);
      }
    });
  }

  private handlePointerUp(event: MouseEvent): void {
    if (this.showToolbarForSelection()) return;

    // Collapsed click: an existing highlight opens its note; a plain image
    // (not wrapped in a link) offers the ring toolbar.
    const hitId = this.renderer.annotationAtPoint(event.clientX, event.clientY);
    if (hitId) {
      const range = this.renderer.getRange(hitId);
      this.openNoteFor(hitId, range?.getBoundingClientRect() ?? new DOMRect(event.clientX, event.clientY, 0, 0));
      return;
    }
    const target = event.target;
    if (target instanceof HTMLImageElement && !target.closest('a')) {
      this.pending = { type: 'image', image: target };
      this.ui.showToolbar(target.getBoundingClientRect(), this.lastColor);
    }
  }

  private showToolbarForSelection(): boolean {
    const selection = this.doc.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      if (this.pending?.type === 'text') {
        this.ui.hideToolbar();
        this.pending = null;
      }
      return false;
    }
    const range = selection.getRangeAt(0);
    if (!this.doc.body.contains(range.commonAncestorContainer)) return false;
    if (range.toString().trim().length === 0) return false;
    this.pending = { type: 'text', range: range.cloneRange() };
    this.ui.showToolbar(range.getBoundingClientRect(), this.lastColor);
    return true;
  }

  private wireKeyboard(): void {
    this.doc.addEventListener('keydown', (event) => {
      if (this.ui.containsEvent(event)) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      ) {
        return;
      }
      // 1/2/3 pick a color for the pending selection or image.
      if (!event.metaKey && !event.ctrlKey && !event.altKey && this.ui.isToolbarVisible()) {
        const color = colorForDigit(Number(event.key));
        if (color) {
          event.preventDefault();
          event.stopPropagation();
          void this.createFromPending(color);
          return;
        }
      }
      // Cmd+Z (mac) / Ctrl+Z (win): undo the last Locus action in this tab.
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        if (this.undoStack.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          void this.performUndo();
        }
      }
    });
  }

  private reveal(id: string): void {
    const range = this.renderer.getRange(id);
    if (!range) return;
    const rect = range.getBoundingClientRect();
    const view = this.doc.defaultView;
    if (!view) return;
    const targetY = view.scrollY + rect.top - view.innerHeight / 2;
    view.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
    setTimeout(() => {
      const fresh = this.renderer.getRange(id);
      if (fresh) this.ui.pulse([...fresh.getClientRects()]);
    }, 450);
  }

  private wireMessages(): void {
    chrome.runtime.onMessage.addListener(
      (message: TabMessage, _sender, sendResponse: (reply?: AnchorStateReply) => void) => {
        switch (message.type) {
          case 'annotations:changed':
            if (message.urlKey === this.urlKey) void this.refresh();
            return false;
          case 'annotation:reveal':
            this.reveal(message.id);
            return false;
          case 'anchor-state:query':
            sendResponse({ url: location.href, states: this.states() });
            return false;
          default:
            return false;
        }
      },
    );
  }

  private watchMutations(): void {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (this.renderer.isSelfMutation()) return;
      if (Date.now() - startedAt > MUTATION_WATCH_MS) {
        observer.disconnect();
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => this.anchorAll(), MUTATION_DEBOUNCE_MS);
    });
    observer.observe(this.doc.body, { childList: true, subtree: true, characterData: true });
    setTimeout(() => observer.disconnect(), MUTATION_WATCH_MS + 1000);
  }
}

export default defineContentScript({
  registration: 'runtime',
  main() {
    if (window.top !== window) return; // top frame only in this milestone
    if (document.documentElement.hasAttribute('data-locus-ready')) return;
    document.documentElement.setAttribute('data-locus-ready', '1');
    void new LocusContent().start();
  },
});
