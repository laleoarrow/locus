import { defineContentScript } from 'wxt/utils/define-content-script';
import { HighlightRenderer } from '@/content/highlights';
import { LocusUI } from '@/content/ui';
import { captureAnchor } from '@/domain/anchor/capture';
import { resolveAnchor } from '@/domain/anchor/resolve';
import { buildTextIndex, type TextIndex } from '@/domain/anchor/textIndex';
import { DEFAULT_COLOR } from '@/domain/colors';
import type { AnchorState, AnnotationWithAnchor, ColorKey } from '@/domain/types';
import { requestBg, type AnchorStateReply, type TabMessage } from '@/messaging/protocol';

/** How long after load we keep retrying detached anchors on DOM mutations. */
const MUTATION_WATCH_MS = 15_000;
const MUTATION_DEBOUNCE_MS = 300;

interface Entry {
  item: AnnotationWithAnchor;
  state: AnchorState;
}

class LocusContent {
  private readonly doc = document;
  private readonly renderer = new HighlightRenderer(document);
  private readonly ui: LocusUI;
  private entries = new Map<string, Entry>();
  private index: TextIndex = buildTextIndex(document.body);
  private lastColor: ColorKey = DEFAULT_COLOR;
  private urlKey = '';
  private pendingRange: Range | null = null;

  constructor() {
    this.ui = new LocusUI(this.doc, {
      onHighlight: (color) => void this.createFromSelection(color, false),
      onHighlightWithComment: (color) => void this.createFromSelection(color, true),
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
    this.wireSelection();
    this.wireMessages();
    this.watchMutations();
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
      const resolved = resolveAnchor(entry.item.anchor, this.index, this.doc.body);
      if (resolved) {
        this.renderer.set(id, entry.item.annotation.color, resolved.range);
        entry.state = 'anchored';
        anchored++;
      } else {
        this.renderer.clear(id);
        entry.state = 'detached';
        detached++;
      }
    }
    // Mirror state onto <html> attributes: observable by tests and tools
    // without page-world coupling; not part of the article content.
    this.doc.documentElement.setAttribute('data-locus-anchored', String(anchored));
    this.doc.documentElement.setAttribute('data-locus-detached', String(detached));
    chrome.runtime
      .sendMessage({ type: 'anchor-state:changed', urlKey: this.urlKey })
      .catch(() => undefined);
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

  private async createFromSelection(color: ColorKey, withComment: boolean): Promise<void> {
    const range = this.pendingRange;
    if (!range) return;
    const rect = range.getBoundingClientRect();
    this.index = buildTextIndex(this.doc.body);
    const anchor = captureAnchor(range, this.index, this.doc.body);
    this.ui.hideToolbar();
    this.doc.getSelection()?.removeAllRanges();
    this.pendingRange = null;
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
    await this.refresh();
    if (withComment) {
      this.ui.openCommentBox(rect, (text) => {
        if (text) void requestBg({ type: 'annotation:set-comment', id: created.item.annotation.id, comment: text });
      });
    }
  }

  private wireSelection(): void {
    const maybeShow = (event: Event) => {
      if (this.ui.containsEvent(event)) return;
      setTimeout(() => {
        const selection = this.doc.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          this.ui.hideToolbar();
          this.pendingRange = null;
          return;
        }
        const range = selection.getRangeAt(0);
        if (!this.doc.body.contains(range.commonAncestorContainer)) return;
        if (range.toString().trim().length === 0) return;
        this.pendingRange = range.cloneRange();
        this.ui.showToolbar(range.getBoundingClientRect(), this.lastColor);
      }, 0);
    };
    this.doc.addEventListener('mouseup', maybeShow);
    this.doc.addEventListener('keyup', (event) => {
      if (event.key.startsWith('Arrow') || event.key === 'Shift') maybeShow(event);
    });
    this.doc.addEventListener('mousedown', (event) => {
      if (!this.ui.containsEvent(event)) this.ui.hideToolbar();
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
