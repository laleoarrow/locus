import { defineContentScript } from 'wxt/utils/define-content-script';
import { HighlightRenderer, imageGeometry } from '@/content/highlights';
import { LocusUI } from '@/content/ui';
import { FloatingObstacles } from '@/content/obstacles';
import { mutationAnchorWork } from '@/content/mutations';
import { captureAnchor } from '@/domain/anchor/capture';
import { buildImageIndex, captureImageAnchor, resolveImageAnchor, type ImageIndex } from '@/domain/anchor/image';
import { resolveAnchor } from '@/domain/anchor/resolve';
import { buildTextIndex, type TextIndex } from '@/domain/anchor/textIndex';
import { extractDoi } from '@/domain/doi';
import {
  buildPalette,
  buildPaletteForKeys,
  colorForDigit,
  customColorFromHex,
  DEFAULT_COLOR,
  type PaletteEntry,
} from '@/domain/colors';
import { effectiveColorUpdatedAt } from '@/domain/types';
import type { AnnotationEditAction } from '@/domain/editing';
import type {
  AnchorPayload,
  AnchorState,
  AnnotationWithAnchor,
  ColorKey,
  Prefs,
} from '@/domain/types';
import { requestBg, type AnchorStateReply, type TabMessage } from '@/messaging/protocol';

/** Follow late or animated rivals while the selection toolbar is visible. */
const PLACEMENT_RECHECK_MS = 200;
const MUTATION_DEBOUNCE_MS = 300;
const DETACHED_RETRY_MS = 2_000;
/** Separates an intentional image-selection drag from ordinary click jitter. */
const IMAGE_DRAG_THRESHOLD_PX = 8;

interface Entry {
  item: AnnotationWithAnchor;
  state: AnchorState;
  anchorKey: string;
}

type PendingTarget =
  | { type: 'text'; range: Range }
  | { type: 'image'; image: HTMLImageElement };

type UndoAction = { action: 'create' | 'delete'; annotationIds: string[] };

interface ImageDragGesture {
  image: HTMLImageElement;
  startX: number;
  startY: number;
  moved: boolean;
}

function isEditableKeyEvent(event: KeyboardEvent): boolean {
  if (event.isComposing) return true;
  return event.composedPath().some((target) => {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target.matches('input, textarea, select')) return true;
    const role = target.getAttribute('role');
    return role === 'textbox' || role === 'searchbox' || role === 'combobox';
  });
}

export class LocusContent {
  private readonly doc = document;
  private readonly renderer = new HighlightRenderer(document);
  private readonly obstacles = new FloatingObstacles(document);
  private readonly ui: LocusUI;
  private entries = new Map<string, Entry>();
  private lastColor: ColorKey = DEFAULT_COLOR;
  private urlKey = '';
  private pending: PendingTarget | null = null;
  private prefs: Prefs = {
    placement: 'below',
    customColors: [],
    disabledSites: [],
    detectDoi: true,
    checkUpdates: true,
  };
  private pageColors: ColorKey[] = [];
  private palette: PaletteEntry[] = buildPalette([]);
  /** Locus is on everywhere by default; false while this origin is switched off. */
  private active = true;
  private readonly origin = location.origin;
  /** Per-tab undo stack for Cmd/Ctrl+Z (creates and note-editor deletes). */
  private readonly undoStack: UndoAction[] = [];
  private placementRecheck: ReturnType<typeof setTimeout> | undefined;
  private imageDrag: ImageDragGesture | null = null;
  private suppressImageClick = false;
  private suppressImageClickTimer: ReturnType<typeof setTimeout> | undefined;
  private reportedAnchorStates: string | undefined;
  private refreshTask: Promise<void> | undefined;
  private refreshAgain = false;

  constructor() {
    this.ui = new LocusUI(this.doc, {
      onHighlight: (color) => void this.createFromPending(color),
      onAddColor: (hex) => void this.addColor(hex),
      onDisableSite: () => void this.disableSite(),
    });
  }

  private syncPalettes(): void {
    this.palette = buildPaletteForKeys(this.pageColors, this.prefs.customColors);
    const renderKeys = [
      ...this.pageColors,
      ...[...this.entries.values()].map((entry) => entry.item.annotation.color),
    ];
    const renderPalette = buildPaletteForKeys(renderKeys, this.prefs.customColors);
    this.renderer.setPalette(renderPalette);
    for (const [id, entry] of this.entries) {
      this.renderer.recolor(id, this.renderer.effectiveColor(entry.item.annotation.color));
    }
    this.ui.setPalette(this.palette, renderPalette);
    this.refreshToolbar();
  }

  private applyPrefs(prefs: Prefs): void {
    this.prefs = prefs;
    this.syncPalettes();
    const disabled = prefs.disabledSites.includes(this.origin);
    if (disabled && this.active) this.deactivate();
    else if (!disabled && !this.active) this.activate();
  }

  private deactivate(): void {
    this.active = false;
    this.reportedAnchorStates = undefined;
    this.pending = null;
    this.imageDrag = null;
    this.clearSuppressedImageClick();
    this.renderer.clearAll();
    this.hideToolbar();
    this.ui.closeNoteEditor(true);
    this.ui.hideVersionToast();
    const html = this.doc.documentElement;
    html.setAttribute('data-locus-disabled', '1');
    html.removeAttribute('data-locus-anchored');
    html.removeAttribute('data-locus-detached');
  }

  private activate(): void {
    this.active = true;
    this.doc.documentElement.removeAttribute('data-locus-disabled');
    this.anchorAll();
  }

  private async disableSite(): Promise<void> {
    const result = await requestBg({
      type: 'prefs:toggle-site',
      origin: this.origin,
      disabled: true,
    });
    if (result) this.applyPrefs(result.prefs);
  }

  private async addColor(hex: string): Promise<void> {
    const color = customColorFromHex(hex);
    if (!color) return;
    const result = await requestBg({ type: 'page-colors:add', url: location.href, color });
    if (result) {
      this.pageColors = result.colors;
      this.syncPalettes();
    }
  }

  /** Toolbar default: last-used color if it still exists, else yellow. */
  private effectiveLastColor(): ColorKey {
    return this.palette.some((entry) => entry.key === this.lastColor)
      ? this.lastColor
      : DEFAULT_COLOR;
  }

  async start(): Promise<void> {
    const doi = extractDoi(this.doc, location.href);
    const bootstrap = await requestBg({
      type: 'source:bootstrap',
      url: location.href,
      title: this.doc.title,
      ...(doi ? { doi } : {}),
    });
    if (!bootstrap) return;
    this.lastColor = bootstrap.lastColor;
    this.urlKey = bootstrap.source.urlKey;
    this.pageColors = bootstrap.pageColors;
    this.setItems(bootstrap.items);
    this.applyPrefs(bootstrap.prefs);
    if (this.active) {
      this.anchorAll();
      const alt = bootstrap.altVersion;
      if (alt) {
        this.ui.showVersionToast(alt, () => {
          location.href = alt.url;
        });
      }
    }
    this.wirePointer();
    this.wireKeyboard();
    this.wireMessages();
    this.watchMutations();
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener('resize', () => {
      this.refreshToolbar();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.renderer.repositionRings(), 150);
    });
    let scrollFrame = 0;
    this.doc.addEventListener('scroll', () => {
      this.refreshToolbar();
      if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        if (this.active) this.renderer.repositionRings();
      });
    }, true);
  }

  private setItems(items: AnnotationWithAnchor[]): Set<string> {
    const previous = this.entries;
    const changed = new Set<string>();
    this.entries = new Map(items.map((item) => {
      const id = item.annotation.id;
      const before = previous.get(id);
      const anchorKey = JSON.stringify(item.anchor);
      if (!before || before.anchorKey !== anchorKey) changed.add(id);
      return [id, { item, anchorKey, state: before?.state ?? 'detached' } satisfies Entry];
    }));
    for (const id of previous.keys()) {
      if (!this.entries.has(id)) this.renderer.clear(id);
    }
    this.syncPalettes();
    return changed;
  }

  /** Resolve only the requested records; indexes live for this batch, not the page lifetime. */
  private anchorAll(ids: Iterable<string> = this.entries.keys()): void {
    const targets = [...ids];
    let index: TextIndex | undefined;
    const textIndex = () => index ??= buildTextIndex(this.doc.body);
    const imageCount = targets.filter((id) => this.entries.get(id)?.item.anchor?.kind === 'image').length;
    const images = imageCount > 1 ? buildImageIndex(this.doc.body) : undefined;
    for (const id of targets) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      try {
        this.anchorOne(id, entry, textIndex, images);
      } catch {
        // One damaged legacy anchor must not prevent the other notes loading.
        this.renderer.clear(id);
        entry.state = 'detached';
      }
    }
    if (imageCount > 0) this.renderer.repositionRings();
    const anchored = [...this.entries.values()].filter((entry) => entry.state === 'anchored').length;
    const detached = this.entries.size - anchored;
    // Mirror state onto <html> attributes: observable by tests and tools
    // without page-world coupling; not part of the article content.
    this.doc.documentElement.setAttribute('data-locus-anchored', String(anchored));
    this.doc.documentElement.setAttribute('data-locus-detached', String(detached));
    const states = [...this.entries].map(([id, entry]) => ({
      annotationId: id, detached: entry.state === 'detached',
    })).sort((first, second) => first.annotationId.localeCompare(second.annotationId));
    const snapshot = JSON.stringify(states);
    if (snapshot === this.reportedAnchorStates) return;
    this.reportedAnchorStates = snapshot;
    chrome.runtime
      .sendMessage({ type: 'anchor-state:changed', urlKey: this.urlKey })
      .catch(() => undefined);
    // Persist what this page could and could not resolve, so the library can
    // show detached annotations without a content script running everywhere.
    // The background only writes rows whose state actually changed.
    void requestBg({
      type: 'anchor-state:report',
      states,
    }).then((result) => {
      if (!result?.ok && this.reportedAnchorStates === snapshot) this.reportedAnchorStates = undefined;
    }, () => {
      if (this.reportedAnchorStates === snapshot) this.reportedAnchorStates = undefined;
    });
  }

  private anchorOne(id: string, entry: Entry, textIndex: () => TextIndex, images?: ImageIndex): boolean {
    const { anchor } = entry.item;
    const color = entry.item.annotation.color;
    const renderColor = this.renderer.effectiveColor(color);
    if (anchor.kind === 'image') {
      const image = resolveImageAnchor(anchor, this.doc.body, images);
      if (image) {
        this.renderer.setImage(id, renderColor, image, true);
        entry.state = 'anchored';
        return true;
      }
    } else {
      const resolved = resolveAnchor(anchor, textIndex(), this.doc.body);
      if (resolved) {
        this.renderer.set(id, renderColor, resolved.range);
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

  private refresh(): Promise<void> {
    this.refreshAgain = true;
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = Promise.resolve().then(async () => {
      try {
        do {
          this.refreshAgain = false;
          try {
            const result = await requestBg({ type: 'annotations:list', url: location.href });
            if (!result) continue;
            const changed = this.setItems(result.items);
            if (this.active) this.anchorAll(changed);
          } catch (error) {
            // A failed earlier read must not consume a newer notification.
            // Only drain work already requested; do not retry on our own.
            if (!this.refreshAgain) throw error;
          }
        } while (this.refreshAgain);
      } finally {
        // Clear before resolving: a later notification starts a fresh read.
        this.refreshTask = undefined;
      }
    });
    return this.refreshTask;
  }

  private captureFromPending(): AnchorPayload | null {
    if (!this.pending) return null;
    if (this.pending.type === 'image') return captureImageAnchor(this.pending.image, this.doc.body);
    return captureAnchor(this.pending.range, buildTextIndex(this.doc.body), this.doc.body);
  }

  private async createFromPending(color: ColorKey): Promise<void> {
    const anchor = this.captureFromPending();
    this.hideToolbar();
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
    this.undoStack.push({ action: 'create', annotationIds: [created.item.annotation.id] });
    await this.refresh();
  }

  private async deleteAnnotations(annotationIds: string[]): Promise<void> {
    const ids = [...new Set(annotationIds)];
    if (ids.length === 0) return;
    const response = await requestBg({ type: 'annotations:delete', ids });
    if (!response?.ok) return;
    this.undoStack.push({ action: 'delete', annotationIds: ids });
    await this.refresh();
  }

  private async performUndo(): Promise<boolean> {
    const last = this.undoStack.pop();
    if (!last) return false;
    try {
      const response = last.action === 'create'
        ? await requestBg({ type: 'annotations:delete', ids: last.annotationIds })
        : await requestBg({ type: 'annotations:undelete', ids: last.annotationIds });
      if (!response?.ok) {
        this.undoStack.push(last);
        return false;
      }
      await this.refresh();
      return true;
    } catch {
      this.undoStack.push(last);
      return false;
    }
  }

  private openNoteFor(id: string, at: DOMRect): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.hideToolbar();
    const annotation = entry.item.annotation;
    const expected = {
      id, updatedAt: annotation.updatedAt, deletedAt: annotation.deletedAt,
      colorUpdatedAt: effectiveColorUpdatedAt(annotation),
    };
    const edit = async (action: AnnotationEditAction) => {
      const result = await requestBg({ type: 'annotations:edit', expected: [expected], action });
      if (!result || result.error) throw new Error(result?.error ?? 'Could not save the note. Try again.');
      if (action.type === 'delete') this.undoStack.push({ action: 'delete', annotationIds: [id] });
      // Persistence already succeeded; a refresh failure must not invite a
      // duplicate save against the now-outdated snapshot.
      void this.refresh().catch(() => undefined);
    };
    this.ui.openNoteEditor({
      rect: at,
      color: annotation.color,
      initial: annotation.comment,
      onSave: (text) => edit({ type: 'comment', mode: 'replace', comment: text }),
      onDelete: () => edit({ type: 'delete' }),
    });
  }

  private wirePointer(): void {
    this.doc.addEventListener(
      'mousedown',
      (event) => {
        // A new physical gesture can never belong to the previous drag's
        // synthetic click. Clear any token that outlived its event turn.
        this.clearSuppressedImageClick();
        this.imageDrag =
          this.active &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.target instanceof HTMLImageElement &&
          !this.ui.containsEvent(event)
            ? {
                image: event.target,
                startX: event.clientX,
                startY: event.clientY,
                moved: false,
              }
            : null;
      },
      true,
    );
    this.doc.addEventListener(
      'mousemove',
      (event) => {
        const gesture = this.imageDrag;
        if (!gesture || (event.buttons & 1) === 0) return;
        if (
          Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >=
          IMAGE_DRAG_THRESHOLD_PX
        ) {
          gesture.moved = true;
          // Once the threshold is crossed, this gesture belongs to Locus rather
          // than the browser's native image/link drag operation.
          event.preventDefault();
        }
      },
      true,
    );
    this.doc.addEventListener(
      'dragstart',
      (event) => {
        const gesture = this.imageDrag;
        if (!gesture || event.target !== gesture.image) return;
        // Chromium starts native image/link dragging before our deliberate
        // 8 px selection threshold. Cancel native DnD so mousemove continues,
        // but do not turn ordinary click jitter into a Locus gesture.
        event.preventDefault();
      },
      true,
    );
    this.doc.addEventListener(
      'mouseup',
      (event) => {
        const gesture = this.imageDrag;
        this.imageDrag = null;
        if (!this.active || this.ui.containsEvent(event)) return;
        if (
          gesture?.moved &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.suppressFollowingImageClick();
          this.presentImageSelection(gesture.image);
          return;
        }
        // Even an already-ringed image keeps its ordinary click. Image notes
        // reopen through the explicit drag gesture or the side panel.
        if (gesture) return;
        setTimeout(() => this.handlePointerUp(event), 0);
      },
      true,
    );
    this.doc.addEventListener(
      'click',
      (event) => {
        if (!this.suppressImageClick) return;
        this.clearSuppressedImageClick();
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
    this.doc.addEventListener('mousedown', (event) => {
      if (this.active && !this.ui.containsEvent(event)) {
        this.hideToolbar();
        this.ui.closeNoteEditor();
      }
    });
    this.doc.addEventListener('keyup', (event) => {
      if (!this.active) return;
      if (event.key.startsWith('Arrow') || event.key === 'Shift') {
        if (!this.ui.containsEvent(event)) setTimeout(() => this.showToolbarForSelection(), 0);
      }
    });
  }

  private clearSuppressedImageClick(): void {
    clearTimeout(this.suppressImageClickTimer);
    this.suppressImageClickTimer = undefined;
    this.suppressImageClick = false;
  }

  /** Suppress only the synthetic click immediately following a completed drag. */
  private suppressFollowingImageClick(): void {
    this.clearSuppressedImageClick();
    this.suppressImageClick = true;
    this.suppressImageClickTimer = setTimeout(() => this.clearSuppressedImageClick(), 0);
  }

  private presentImageSelection(image: HTMLImageElement): void {
    if (!this.ui.closeNoteEditor()) return;
    const rect = image.getBoundingClientRect();
    const existing = [...this.entries].find(
      ([id, entry]) =>
        entry.item.annotation.kind === 'image' && this.renderer.getImage(id) === image,
    );
    if (existing) {
      this.openNoteFor(existing[0], rect);
      return;
    }
    this.doc.getSelection()?.removeAllRanges();
    this.pending = { type: 'image', image };
    this.presentToolbar(rect);
  }

  private handlePointerUp(event: MouseEvent): void {
    if (this.showToolbarForSelection()) return;

    // Collapsed click: an existing text highlight opens its note. Images are
    // deliberately excluded here so their links and lightboxes stay native.
    const hitId = this.renderer.annotationAtPoint(event.clientX, event.clientY);
    if (hitId) {
      if (this.entries.get(hitId)?.item.annotation.kind === 'image') return;
      const range = this.renderer.getRange(hitId);
      this.openNoteFor(hitId, range?.getBoundingClientRect() ?? new DOMRect(event.clientX, event.clientY, 0, 0));
    }
  }

  private stopPlacementTracking(): void {
    clearTimeout(this.placementRecheck);
    this.placementRecheck = undefined;
    this.obstacles.stop();
  }

  private hideToolbar(): void {
    this.stopPlacementTracking();
    this.ui.hideToolbar();
  }

  /** Re-measure the target because scrolling and page layout can move it. */
  private refreshToolbar(): void {
    if (!this.active || !this.ui.isToolbarVisible() || !this.pending) {
      this.stopPlacementTracking();
      return;
    }
    const target = this.pending.type === 'text' ? this.pending.range : this.pending.image;
    const connected = target instanceof Range
      ? target.commonAncestorContainer.isConnected && !target.collapsed
      : target.isConnected;
    if (!connected || (this.pending.type === 'image' && !imageGeometry(this.pending.image, this.doc))) {
      this.hideToolbar();
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight ||
      rect.right <= 0 || rect.left >= window.innerWidth) {
      this.hideToolbar();
      return;
    }
    this.presentToolbar(rect);
  }

  /** Keep checking cached floating elements until the toolbar is dismissed. */
  private presentToolbar(rect: DOMRect): void {
    if (this.prefs.placement === 'auto') this.obstacles.start();
    else this.obstacles.stop();
    const anchorNode = this.pending?.type === 'text' ? this.pending.range.commonAncestorContainer : this.pending?.image;
    this.ui.showToolbar(rect, this.effectiveLastColor(), this.prefs.placement, this.obstacles.collect(anchorNode));
    clearTimeout(this.placementRecheck);
    if (this.prefs.placement !== 'auto') return;
    this.placementRecheck = setTimeout(() => this.refreshToolbar(), PLACEMENT_RECHECK_MS);
  }

  private showToolbarForSelection(): boolean {
    const selection = this.doc.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      if (this.pending?.type === 'text') {
        this.hideToolbar();
        this.pending = null;
      }
      return false;
    }
    const range = selection.getRangeAt(0);
    if (!this.doc.body.contains(range.commonAncestorContainer)) return false;
    if (range.toString().trim().length === 0) {
      const common = range.commonAncestorContainer;
      const root = common.nodeType === 1 ? (common as Element) : common.parentElement;
      if (!root) return false;
      const images = [
        ...(root.matches('img') ? [root as HTMLImageElement] : []),
        ...root.querySelectorAll<HTMLImageElement>('img'),
      ].filter((image) => range.intersectsNode(image));
      const image = images[0];
      if (!image || images.length !== 1) return false;
      this.presentImageSelection(image);
      return true;
    }
    if (!this.ui.closeNoteEditor()) return true;
    this.pending = { type: 'text', range: range.cloneRange() };
    const rect = range.getBoundingClientRect();
    this.presentToolbar(rect);
    return true;
  }

  private wireKeyboard(): void {
    this.doc.addEventListener(
      'keydown',
      (event) => {
        if (!this.active || this.ui.containsEvent(event) || isEditableKeyEvent(event)) return;

        if (
          !event.repeat &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.shiftKey &&
          (event.key === 'Delete' || event.key === 'Backspace')
        ) {
          const selection = this.doc.getSelection();
          const ids = new Set<string>();
          if (selection && !selection.isCollapsed) {
            for (let i = 0; i < selection.rangeCount; i++) {
              const range = selection.getRangeAt(i);
              if (!this.doc.body.contains(range.commonAncestorContainer)) continue;
              for (const id of this.renderer.annotationIdsIntersecting(range)) ids.add(id);
            }
          }
          if (ids.size > 0) {
            event.preventDefault();
            event.stopPropagation();
            this.hideToolbar();
            this.pending = null;
            selection?.removeAllRanges();
            void this.deleteAnnotations([...ids]);
            return;
          }
        }

        // Digits pick a palette color for the pending selection or image.
        if (!event.metaKey && !event.ctrlKey && !event.altKey && this.ui.isToolbarVisible()) {
          const color = colorForDigit(Number(event.key), this.palette);
          if (color) {
            event.preventDefault();
            event.stopPropagation();
            void this.createFromPending(color);
            return;
          }
        }

        // Cmd+Z (mac) / Ctrl+Z (win): undo the last Locus action in this tab.
        if (
          !event.altKey &&
          (event.metaKey || event.ctrlKey) &&
          !event.shiftKey &&
          event.key.toLowerCase() === 'z' &&
          this.undoStack.length > 0
        ) {
          event.preventDefault();
          event.stopPropagation();
          void this.performUndo();
        }
      },
      { capture: true },
    );
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
            if (this.active && message.urlKey === this.urlKey) void this.refresh();
            return false;
          case 'annotation:reveal':
            if (this.active) this.reveal(message.id);
            return false;
          case 'anchor-state:query':
            sendResponse({ url: location.href, states: this.active ? this.states() : {} });
            return false;
          case 'prefs:changed':
            this.applyPrefs(message.prefs);
            return false;
          case 'page-colors:changed':
            if (message.urlKey !== this.urlKey) return false;
            this.pageColors = message.colors;
            this.syncPalettes();
            return false;
          default:
            return false;
        }
      },
    );
  }

  private watchMutations(): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let lastDetachedRetry = -Infinity;
    let mutations: MutationRecord[] = [];
    let imageLoaded = false;
    const retryDetached = () => {
      retryTimer = undefined;
      if (!this.active || ![...this.entries.values()].some((entry) => entry.state === 'detached')) return;
      lastDetachedRetry = performance.now();
      this.anchorAll();
    };
    const schedule = (records: MutationRecord[] = [], loaded = false) => {
      if (!this.active || this.entries.size === 0 || this.renderer.isSelfMutation()) return;
      mutations.push(...records);
      imageLoaded ||= loaded;
      // A bounded coalescing window still runs on continuously updating pages.
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (this.active && this.entries.size > 0) {
          const work = mutationAnchorWork(mutations, [...this.entries].map(([id, entry]) => ({
            anchor: entry.item.anchor, detached: entry.state === 'detached',
            range: entry.item.anchor.kind === 'image' ? null : this.renderer.getRange(id),
            image: this.renderer.getImage(id),
          })), this.doc.body, imageLoaded);
          if (work === 'reanchor') this.anchorAll();
          else if (work === 'retry' && !retryTimer) {
            const delay = Math.max(0, lastDetachedRetry + DETACHED_RETRY_MS - performance.now());
            if (delay === 0) retryDetached();
            else retryTimer = setTimeout(retryDetached, delay);
          }
          this.renderer.repositionRings();
          this.refreshToolbar();
        }
        mutations = [];
        imageLoaded = false;
      }, MUTATION_DEBOUNCE_MS);
    };
    const observer = new MutationObserver((records) => schedule(records));
    observer.observe(this.doc.body, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['src', 'srcset', 'sizes', 'alt', 'media', 'type', 'class', 'style', 'hidden'],
    });
    // Lazy image loads can change currentSrc without changing an attribute.
    this.doc.addEventListener('load', (event) => {
      if (event.target instanceof HTMLImageElement) schedule([], true);
    }, true);
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
