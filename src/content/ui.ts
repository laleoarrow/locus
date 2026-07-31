import { LOCUS_HOST_ID } from '@/domain/anchor/textIndex';
import { specFor, type PaletteEntry } from '@/domain/colors';
import type { ColorKey, ToolbarPlacement } from '@/domain/types';
import { resolvePlacement, type Box } from '@/domain/placement';
import { markdownToHtml } from '@/lib/markdown';

export interface ToolbarActions {
  onHighlight(color: ColorKey): void;
  onAddColor(hex: string): void;
  onDisableSite(): void;
}

export interface VersionToastInfo {
  count: number;
  title: string;
  url: string;
}

export interface NoteEditorOptions {
  rect: DOMRect;
  color: ColorKey;
  initial: string;
  onSave(text: string): void;
  onDelete(): void;
}

/** macOS-style liquid-glass surfaces; light/dark aware. */
const SHADOW_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }

.glass {
  position: fixed;
  z-index: 2147483647;
  color: #1d1d1f;
  background: rgba(252, 252, 253, 0.6);
  -webkit-backdrop-filter: blur(28px) saturate(1.9);
  backdrop-filter: blur(28px) saturate(1.9);
  border: 0.5px solid rgba(255, 255, 255, 0.7);
  box-shadow:
    inset 0 0.5px 0 rgba(255, 255, 255, 0.85),
    0 1px 2px rgba(0, 0, 0, 0.06),
    0 12px 32px rgba(0, 0, 0, 0.18);
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  .glass {
    color: #f5f5f7;
    background: rgba(44, 44, 48, 0.55);
    border-color: rgba(255, 255, 255, 0.14);
    box-shadow:
      inset 0 0.5px 0 rgba(255, 255, 255, 0.12),
      0 1px 2px rgba(0, 0, 0, 0.3),
      0 12px 32px rgba(0, 0, 0, 0.5);
  }
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 999px;
  animation: locus-in 0.14s ease-out;
}
@keyframes locus-in {
  from { opacity: 0; transform: translateY(4px) scale(0.96); }
  to { opacity: 1; transform: none; }
}

.swatch {
  position: relative;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  background: radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.95), var(--c) 62%);
  box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.14), 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.12s ease;
}
.swatch:hover { transform: scale(1.14); }
.swatch:active { transform: scale(1.02); }
.swatch[data-last="true"] {
  box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.14), 0 1px 3px rgba(0, 0, 0, 0.2),
    0 0 0 2px rgba(255, 255, 255, 0.95), 0 0 0 3.5px var(--c);
}
.swatch::after {
  content: attr(data-shortcut);
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  font-size: 9px;
  font-weight: 600;
  line-height: 13px;
  text-align: center;
  color: #3a3a3c;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 0.5px 2px rgba(0, 0, 0, 0.25);
}
.swatch[data-shortcut=""]::after { display: none; }

.add-wrap {
  position: relative;
  width: 24px;
  height: 24px;
  flex: none;
  transition: transform 0.12s ease;
}
.add-wrap:hover { transform: scale(1.12); }
.add-color {
  width: 100%;
  height: 100%;
  border: 1.5px dashed rgba(120, 120, 128, 0.55);
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font: 600 14px/1 inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  transition: border-color 0.12s ease;
}
.add-wrap:hover .add-color { border-color: #0a84ff; color: #0a84ff; }
/* The real native color input sits invisibly on top: the user's own click
   opens the picker, which programmatic clicks cannot always do. */
.add-wrap input[type='color'] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  padding: 0;
  border: none;
}

/* ⌘-hover the toolbar's right edge → this zone slides out. */
.site-off {
  flex: none;
  width: 0;
  height: 24px;
  padding: 0;
  margin-left: 0;
  border: none;
  border-radius: 50%;
  background: rgba(120, 120, 128, 0.16);
  color: inherit;
  font: 600 12px/1 inherit;
  cursor: pointer;
  opacity: 0;
  overflow: hidden;
  transition: width 0.18s ease, opacity 0.18s ease, margin-left 0.18s ease;
}
.toolbar.extended .site-off { width: 24px; opacity: 1; margin-left: 4px; }
.site-off:hover { background: rgba(255, 69, 58, 0.2); color: #ff453a; }

.version-toast {
  top: 16px;
  right: 16px;
  width: 300px;
  border-radius: 14px;
  padding: 12px;
  animation: locus-in 0.16s ease-out;
}
.version-toast .vt-text { margin: 0 0 10px; font-size: 12.5px; }
.version-toast .vt-title {
  display: block;
  font-weight: 600;
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.version-toast .vt-actions { display: flex; justify-content: flex-end; gap: 8px; }
.version-toast button {
  border: none;
  border-radius: 999px;
  padding: 5px 12px;
  font: 600 12px/1.3 inherit;
  font-family: inherit;
  cursor: pointer;
  color: inherit;
  background: rgba(120, 120, 128, 0.16);
}
.version-toast button.open { background: #0a84ff; color: #fff; }

.note-card {
  width: 300px;
  border-radius: 16px;
  padding: 12px;
  animation: locus-in 0.14s ease-out;
  /* Never taller than the viewport, so the actions stay reachable. */
  max-height: calc(100vh - 24px);
  display: flex;
  flex-direction: column;
}
.note-head {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
  font-weight: 600;
  font-size: 12.5px;
}
.note-head .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.95), var(--c) 62%);
  box-shadow: inset 0 -1px 2px rgba(0, 0, 0, 0.15);
}
.note-card textarea {
  width: 100%;
  min-height: 72px;
  resize: vertical;
  border: 0.5px solid rgba(120, 120, 128, 0.28);
  border-radius: 10px;
  padding: 8px;
  font: 12.5px/1.5 ui-monospace, "SF Mono", Menlo, monospace;
  color: inherit;
  background: rgba(255, 255, 255, 0.5);
  outline: none;
}
.note-card textarea:focus { border-color: rgba(10, 132, 255, 0.8); box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.18); }
@media (prefers-color-scheme: dark) {
  .note-card textarea { background: rgba(0, 0, 0, 0.25); }
}
.note-preview {
  margin-top: 8px;
  padding: 2px 4px;
  font-size: 12.5px;
  max-height: 140px;
  overflow-y: auto;
  /* Lets the preview shrink instead of pushing the actions off the card. */
  flex: 0 1 auto;
  min-height: 0;
}
.note-card textarea { flex: 0 0 auto; }
.note-actions { flex: 0 0 auto; }
.note-preview:empty { display: none; }
.note-preview h1, .note-preview h2, .note-preview h3 { margin: 4px 0; font-size: 13.5px; }
.note-preview p, .note-preview ul, .note-preview ol, .note-preview blockquote { margin: 4px 0; }
.note-preview ul, .note-preview ol { padding-left: 18px; }
.note-preview blockquote {
  border-left: 3px solid rgba(120, 120, 128, 0.4);
  padding-left: 8px;
  opacity: 0.85;
}
.note-preview code {
  font: 11.5px ui-monospace, "SF Mono", Menlo, monospace;
  background: rgba(120, 120, 128, 0.16);
  border-radius: 4px;
  padding: 1px 4px;
}
.note-preview pre { background: rgba(120, 120, 128, 0.16); border-radius: 8px; padding: 8px; overflow-x: auto; }
.note-preview pre code { background: none; padding: 0; }
.note-preview a { color: #0a84ff; }

.note-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.note-actions .spacer { flex: 1; }
.note-actions button {
  border: none;
  border-radius: 999px;
  padding: 5px 14px;
  font: 600 12px/1.3 inherit;
  font-family: inherit;
  cursor: pointer;
  color: inherit;
  background: rgba(120, 120, 128, 0.16);
  transition: filter 0.1s ease;
}
.note-actions button:hover { filter: brightness(1.06); }
.note-actions button.save { background: #0a84ff; color: #fff; }
.note-actions button.remove { background: none; color: #ff453a; padding-left: 0; }

.pulse {
  position: fixed;
  z-index: 2147483646;
  pointer-events: none;
  background: rgba(10, 132, 255, 0.32);
  border-radius: 3px;
  animation: locus-pulse 1.2s ease-out forwards;
}
@keyframes locus-pulse {
  0% { opacity: 0; } 20% { opacity: 1; } 100% { opacity: 0; }
}
.hidden { display: none !important; }
`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** All in-page UI, isolated in a shadow root on a host outside <body>. */
export class LocusUI {
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly toolbar: HTMLDivElement;
  private readonly noteCard: HTMLDivElement;
  private readonly colorInput: HTMLInputElement;
  private palette: PaletteEntry[] = [];
  private customColors: PaletteEntry[] = [];
  private lastAnchor: DOMRect | null = null;
  /** What the user asked for ('auto' included) — replayed on palette changes. */
  private lastPreference: ToolbarPlacement = 'below';
  /** The side actually chosen last time. */
  private lastPlacement: 'below' | 'above' = 'below';
  private lastColorShown: ColorKey = 'yellow';

  constructor(
    private readonly doc: Document,
    private readonly actions: ToolbarActions,
  ) {
    this.host = doc.createElement('div');
    this.host.id = LOCUS_HOST_ID;
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = SHADOW_CSS;
    this.shadow.appendChild(style);

    this.toolbar = doc.createElement('div');
    this.toolbar.className = 'glass toolbar hidden';
    this.toolbar.setAttribute('data-locus-toolbar', '');
    this.shadow.appendChild(this.toolbar);
    // ⌘/Ctrl + hovering the right edge slides out the per-site off switch;
    // it stays out (so the key can be released to click) until the pointer
    // leaves the toolbar.
    this.toolbar.addEventListener('mousemove', (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const rect = this.toolbar.getBoundingClientRect();
      if (rect.right - event.clientX <= 30) this.toolbar.classList.add('extended');
    });
    this.toolbar.addEventListener('mouseleave', () => this.toolbar.classList.remove('extended'));

    // Native color picker for the "+" orb: 'change' fires once the user
    // confirms ('input' would fire for every drag inside the picker).
    this.colorInput = doc.createElement('input');
    this.colorInput.type = 'color';
    this.colorInput.value = '#8e6fe8';
    this.colorInput.setAttribute('data-locus-color-input', '');
    this.colorInput.addEventListener('change', () => this.actions.onAddColor(this.colorInput.value));

    this.noteCard = doc.createElement('div');
    this.noteCard.className = 'glass note-card hidden';
    this.noteCard.setAttribute('data-locus-note', '');
    this.shadow.appendChild(this.noteCard);

    doc.documentElement.appendChild(this.host);
  }

  /**
   * Rebuild toolbar choices while retaining every color needed to render note
   * cards for annotations that are not offered in this page's toolbar.
   */
  setPalette(palette: PaletteEntry[], renderPalette: PaletteEntry[] = palette): void {
    this.palette = palette;
    this.customColors = renderPalette.slice(3);
    this.toolbar.textContent = '';
    palette.forEach((entry, i) => {
      const swatch = this.doc.createElement('button');
      swatch.className = 'swatch';
      swatch.dataset['color'] = entry.key;
      swatch.dataset['shortcut'] = i < 9 ? String(i + 1) : '';
      swatch.title = i < 9 ? `${entry.label} — press ${i + 1}` : entry.label;
      swatch.style.setProperty('--c', entry.swatch);
      swatch.addEventListener('click', () => this.actions.onHighlight(entry.key));
      this.toolbar.appendChild(swatch);
    });
    const addWrap = this.doc.createElement('span');
    addWrap.className = 'add-wrap';
    addWrap.title = 'Add a custom color to this page';
    const add = this.doc.createElement('span');
    add.className = 'add-color';
    add.textContent = '+';
    add.setAttribute('data-locus-add-color', '');
    addWrap.append(add, this.colorInput);
    this.toolbar.appendChild(addWrap);
    const siteOff = this.doc.createElement('button');
    siteOff.className = 'site-off';
    siteOff.textContent = '✕';
    siteOff.title = 'Disable Locus on this site';
    siteOff.setAttribute('data-locus-site-off', '');
    siteOff.addEventListener('click', () => {
      this.hideToolbar();
      this.actions.onDisableSite();
    });
    this.toolbar.appendChild(siteOff);
    // Keep the toolbar in place when the palette changes while it is open.
    if (this.isToolbarVisible() && this.lastAnchor) {
      this.showToolbar(this.lastAnchor, this.lastColorShown, this.lastPreference);
    }
  }

  containsEvent(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  isToolbarVisible(): boolean {
    return !this.toolbar.classList.contains('hidden');
  }

  /**
   * Show the toolbar next to `anchor`. `preference` may be 'auto', in which
   * case the side is chosen here — after the toolbar has been measured, since
   * the decision needs its real width and height.
   */
  showToolbar(
    anchor: DOMRect,
    lastColor: ColorKey,
    preference: ToolbarPlacement = 'below',
    obstacles: Box[] = [],
  ): void {
    this.lastAnchor = anchor;
    this.lastPreference = preference;
    this.lastColorShown = lastColor;
    for (const swatch of this.toolbar.querySelectorAll<HTMLButtonElement>('.swatch')) {
      swatch.dataset['last'] = swatch.dataset['color'] === lastColor ? 'true' : 'false';
    }
    this.toolbar.classList.remove('hidden');
    const view = this.doc.defaultView;
    const width = this.toolbar.offsetWidth;
    const height = this.toolbar.offsetHeight;
    const placement = resolvePlacement(preference, {
      selection: anchor,
      toolbarWidth: width,
      toolbarHeight: height,
      gap: 10,
      viewportWidth: view?.innerWidth ?? 0,
      viewportHeight: view?.innerHeight ?? 0,
      obstacles,
      margin: 8,
    });
    this.lastPlacement = placement;
    const maxLeft = (view?.innerWidth ?? 0) - width - 8;
    const maxTop = (view?.innerHeight ?? 0) - height - 8;
    const top = placement === 'below' ? anchor.bottom + 10 : anchor.top - height - 10;
    this.toolbar.dataset['placement'] = placement;
    this.toolbar.style.left = `${clamp(anchor.left + anchor.width / 2 - width / 2, 8, maxLeft)}px`;
    this.toolbar.style.top = `${clamp(top, 8, maxTop)}px`;
  }

  hideToolbar(): void {
    this.toolbar.classList.add('hidden');
    this.toolbar.classList.remove('extended');
  }

  /** "You annotated another version of this paper" prompt (DOI match). */
  showVersionToast(info: VersionToastInfo, onOpen: () => void): void {
    this.hideVersionToast();
    const toast = this.doc.createElement('div');
    toast.className = 'glass version-toast';
    toast.setAttribute('data-locus-version-toast', '');
    const text = this.doc.createElement('p');
    text.className = 'vt-text';
    const title = this.doc.createElement('span');
    title.className = 'vt-title';
    title.textContent = info.title;
    text.appendChild(title);
    text.appendChild(
      this.doc.createTextNode(
        `You annotated another version of this paper (${info.count} note${info.count === 1 ? '' : 's'}).`,
      ),
    );
    const actions = this.doc.createElement('div');
    actions.className = 'vt-actions';
    const dismiss = this.doc.createElement('button');
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => toast.remove());
    const open = this.doc.createElement('button');
    open.className = 'open';
    open.textContent = 'Open that version';
    open.setAttribute('data-locus-version-open', '');
    open.addEventListener('click', () => {
      toast.remove();
      onOpen();
    });
    actions.append(dismiss, open);
    toast.append(text, actions);
    this.shadow.appendChild(toast);
    setTimeout(() => toast.remove(), 20_000);
  }

  hideVersionToast(): void {
    this.shadow.querySelector('[data-locus-version-toast]')?.remove();
  }

  isNoteOpen(): boolean {
    return !this.noteCard.classList.contains('hidden');
  }

  /** Markdown note editor with live preview (open on highlight click). */
  openNoteEditor(options: NoteEditorOptions): void {
    const { doc } = this;
    this.noteCard.textContent = '';
    this.noteCard.style.setProperty('--c', specFor(options.color, this.customColors).swatch);

    const head = doc.createElement('div');
    head.className = 'note-head';
    const dot = doc.createElement('span');
    dot.className = 'dot';
    const title = doc.createElement('span');
    title.textContent = 'Note';
    head.append(dot, title);

    const textarea = doc.createElement('textarea');
    textarea.placeholder = 'Write a note… Markdown · Enter to save';
    textarea.title = 'Enter: save · Shift+Enter: newline · Delete (empty) or ⌘Delete: remove highlight';
    textarea.value = options.initial;
    const preview = doc.createElement('div');
    preview.className = 'note-preview';
    preview.setAttribute('data-locus-note-preview', '');
    const renderPreview = () => {
      preview.innerHTML = markdownToHtml(textarea.value.trim());
      // The card grows as the preview fills in; keep it inside the viewport.
      if (!this.noteCard.classList.contains('hidden')) this.positionNoteCard(options.rect);
    };
    renderPreview();
    textarea.addEventListener('input', renderPreview);
    textarea.addEventListener('keydown', (event) => {
      const removeHighlight = () => {
        this.closeNoteEditor();
        options.onDelete();
      };
      if (event.key === 'Escape') {
        this.closeNoteEditor();
      } else if (event.key === 'Enter' && !event.shiftKey) {
        // Enter confirms the note; Shift+Enter inserts a newline.
        event.preventDefault();
        save();
      } else if (
        (event.key === 'Backspace' || event.key === 'Delete') &&
        (event.metaKey || event.ctrlKey || textarea.value === '')
      ) {
        // Delete removes the highlight when the note is empty; ⌘/Ctrl+Delete
        // removes it regardless of note content.
        event.preventDefault();
        removeHighlight();
      }
      event.stopPropagation();
    });

    const actions = doc.createElement('div');
    actions.className = 'note-actions';
    const remove = doc.createElement('button');
    remove.className = 'remove';
    remove.textContent = 'Remove highlight';
    remove.setAttribute('data-locus-note-delete', '');
    remove.addEventListener('click', () => {
      this.closeNoteEditor();
      options.onDelete();
    });
    const spacer = doc.createElement('div');
    spacer.className = 'spacer';
    const cancel = doc.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.closeNoteEditor());
    const saveBtn = doc.createElement('button');
    saveBtn.className = 'save';
    saveBtn.textContent = 'Save';
    saveBtn.setAttribute('data-locus-note-save', '');
    const save = () => {
      this.closeNoteEditor();
      options.onSave(textarea.value.trim());
    };
    saveBtn.addEventListener('click', save);
    actions.append(remove, spacer, cancel, saveBtn);

    this.noteCard.append(head, textarea, preview, actions);
    this.noteCard.classList.remove('hidden');
    this.positionNoteCard(options.rect);
    textarea.focus();
  }

  /**
   * Keep the note card fully on screen, measuring its real size (it grows with
   * the Markdown preview) and flipping above the selection when there is not
   * enough room below.
   */
  private positionNoteCard(rect: DOMRect): void {
    const view = this.doc.defaultView;
    const viewWidth = view?.innerWidth ?? 0;
    const viewHeight = view?.innerHeight ?? 0;
    const cardWidth = this.noteCard.offsetWidth;
    const cardHeight = this.noteCard.offsetHeight;
    this.noteCard.style.left = `${clamp(rect.left, 8, Math.max(8, viewWidth - cardWidth - 8))}px`;
    const below = rect.bottom + 10;
    const wanted = below + cardHeight + 8 > viewHeight ? rect.top - cardHeight - 10 : below;
    this.noteCard.style.top = `${clamp(wanted, 8, Math.max(8, viewHeight - cardHeight - 8))}px`;
  }

  closeNoteEditor(): void {
    this.noteCard.classList.add('hidden');
    this.noteCard.textContent = '';
  }

  /** Flash overlay boxes over the given viewport rects (reveal pulse). */
  pulse(rects: DOMRect[]): void {
    for (const rect of rects) {
      if (rect.width === 0 || rect.height === 0) continue;
      const box = this.doc.createElement('div');
      box.className = 'pulse';
      box.style.left = `${rect.left - 2}px`;
      box.style.top = `${rect.top - 2}px`;
      box.style.width = `${rect.width + 4}px`;
      box.style.height = `${rect.height + 4}px`;
      box.addEventListener('animationend', () => box.remove());
      this.shadow.appendChild(box);
      setTimeout(() => box.remove(), 1500);
    }
  }
}
