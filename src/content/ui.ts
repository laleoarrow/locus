import { LOCUS_HOST_ID } from '@/domain/anchor/textIndex';
import { specFor, type PaletteEntry } from '@/domain/colors';
import type { ColorKey } from '@/domain/types';
import { markdownToHtml } from '@/lib/markdown';

export interface ToolbarActions {
  onHighlight(color: ColorKey): void;
  onAddColor(hex: string): void;
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

.add-color {
  position: relative;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1.5px dashed rgba(120, 120, 128, 0.55);
  border-radius: 50%;
  cursor: pointer;
  background: transparent;
  color: inherit;
  font: 600 14px/1 inherit;
  transition: transform 0.12s ease, border-color 0.12s ease;
}
.add-color:hover { transform: scale(1.12); border-color: #0a84ff; color: #0a84ff; }

.note-card {
  width: 300px;
  border-radius: 16px;
  padding: 12px;
  animation: locus-in 0.14s ease-out;
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
}
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

    // Hidden native color picker backing the "+" orb.
    this.colorInput = doc.createElement('input');
    this.colorInput.type = 'color';
    this.colorInput.value = '#8e6fe8';
    this.colorInput.style.cssText = 'position:fixed;width:0;height:0;opacity:0;pointer-events:none;';
    this.colorInput.addEventListener('input', () => this.actions.onAddColor(this.colorInput.value));
    this.shadow.appendChild(this.colorInput);

    this.noteCard = doc.createElement('div');
    this.noteCard.className = 'glass note-card hidden';
    this.noteCard.setAttribute('data-locus-note', '');
    this.shadow.appendChild(this.noteCard);

    doc.documentElement.appendChild(this.host);
  }

  /** Rebuild the toolbar swatches for the current palette (builtin + custom). */
  setPalette(palette: PaletteEntry[]): void {
    this.palette = palette;
    this.customColors = palette.slice(3);
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
    const add = this.doc.createElement('button');
    add.className = 'add-color';
    add.textContent = '+';
    add.title = 'Add a custom color';
    add.setAttribute('data-locus-add-color', '');
    add.addEventListener('click', () => this.colorInput.click());
    this.toolbar.appendChild(add);
    // Keep the toolbar in place when the palette changes while it is open.
    if (this.isToolbarVisible() && this.lastAnchor) {
      this.showToolbar(this.lastAnchor, this.lastColorShown, this.lastPlacement);
    }
  }

  containsEvent(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  isToolbarVisible(): boolean {
    return !this.toolbar.classList.contains('hidden');
  }

  showToolbar(anchor: DOMRect, lastColor: ColorKey, placement: 'below' | 'above' = 'below'): void {
    this.lastAnchor = anchor;
    this.lastPlacement = placement;
    this.lastColorShown = lastColor;
    for (const swatch of this.toolbar.querySelectorAll<HTMLButtonElement>('.swatch')) {
      swatch.dataset['last'] = swatch.dataset['color'] === lastColor ? 'true' : 'false';
    }
    this.toolbar.classList.remove('hidden');
    const view = this.doc.defaultView;
    const width = this.toolbar.offsetWidth;
    const height = this.toolbar.offsetHeight;
    const maxLeft = (view?.innerWidth ?? 0) - width - 8;
    const maxTop = (view?.innerHeight ?? 0) - height - 8;
    const top = placement === 'below' ? anchor.bottom + 10 : anchor.top - height - 10;
    this.toolbar.dataset['placement'] = placement;
    this.toolbar.style.left = `${clamp(anchor.left + anchor.width / 2 - width / 2, 8, maxLeft)}px`;
    this.toolbar.style.top = `${clamp(top, 8, maxTop)}px`;
  }

  hideToolbar(): void {
    this.toolbar.classList.add('hidden');
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
    const view = this.doc.defaultView;
    const maxLeft = (view?.innerWidth ?? 0) - 308;
    const maxTop = (view?.innerHeight ?? 0) - 200;
    this.noteCard.style.left = `${clamp(options.rect.left, 8, maxLeft)}px`;
    this.noteCard.style.top = `${clamp(options.rect.bottom + 10, 8, maxTop)}px`;
    textarea.focus();
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
