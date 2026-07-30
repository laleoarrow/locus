import { LOCUS_HOST_ID } from '@/domain/anchor/textIndex';
import { COLOR_KEYS, COLORS } from '@/domain/colors';
import type { ColorKey } from '@/domain/types';

export interface ToolbarActions {
  onHighlight(color: ColorKey): void;
  onHighlightWithComment(color: ColorKey): void;
}

const SHADOW_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.toolbar, .comment-box {
  position: fixed;
  z-index: 2147483647;
  background: #ffffff;
  color: #1f2328;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(31, 35, 40, 0.16);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.toolbar { display: flex; align-items: center; gap: 4px; padding: 5px 6px; }
.swatch {
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid transparent; padding: 0; cursor: pointer;
}
.swatch[data-last="true"] { border-color: #1f2328; }
.swatch:hover { transform: scale(1.12); }
.divider { width: 1px; height: 18px; background: #d0d7de; margin: 0 2px; }
.comment-btn {
  border: 0; background: transparent; cursor: pointer; padding: 2px 4px;
  font-size: 14px; line-height: 1; color: #57606a;
}
.comment-btn:hover { color: #1f2328; }
.comment-box { padding: 8px; width: 240px; }
.comment-box textarea {
  width: 100%; min-height: 64px; resize: vertical;
  border: 1px solid #d0d7de; border-radius: 6px; padding: 6px;
  font: inherit; color: inherit; background: #fff;
}
.comment-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px; }
.comment-actions button {
  border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa;
  padding: 3px 10px; cursor: pointer; font: inherit;
}
.comment-actions button.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
.pulse {
  position: fixed; z-index: 2147483646; pointer-events: none;
  background: rgba(31, 111, 235, 0.35); border-radius: 2px;
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
  private readonly commentBox: HTMLDivElement;
  private commentSave: ((text: string) => void) | null = null;

  constructor(
    private readonly doc: Document,
    actions: ToolbarActions,
  ) {
    this.host = doc.createElement('div');
    this.host.id = LOCUS_HOST_ID;
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = SHADOW_CSS;
    this.shadow.appendChild(style);

    this.toolbar = doc.createElement('div');
    this.toolbar.className = 'toolbar hidden';
    this.toolbar.setAttribute('data-locus-toolbar', '');
    for (const key of COLOR_KEYS) {
      const swatch = doc.createElement('button');
      swatch.className = 'swatch';
      swatch.dataset['color'] = key;
      swatch.title = `Highlight (${COLORS[key].label})`;
      swatch.style.background = COLORS[key].swatch;
      swatch.addEventListener('click', () => actions.onHighlight(key));
      this.toolbar.appendChild(swatch);
    }
    const divider = doc.createElement('div');
    divider.className = 'divider';
    this.toolbar.appendChild(divider);
    const commentBtn = doc.createElement('button');
    commentBtn.className = 'comment-btn';
    commentBtn.textContent = '✎';
    commentBtn.title = 'Highlight & comment';
    commentBtn.setAttribute('data-locus-comment-btn', '');
    commentBtn.addEventListener('click', () => {
      const last = this.toolbar.querySelector<HTMLButtonElement>('.swatch[data-last="true"]');
      actions.onHighlightWithComment((last?.dataset['color'] as ColorKey | undefined) ?? 'yellow');
    });
    this.toolbar.appendChild(commentBtn);
    this.shadow.appendChild(this.toolbar);

    this.commentBox = doc.createElement('div');
    this.commentBox.className = 'comment-box hidden';
    this.commentBox.setAttribute('data-locus-comment-box', '');
    this.shadow.appendChild(this.commentBox);

    doc.documentElement.appendChild(this.host);
  }

  containsEvent(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  showToolbar(anchor: DOMRect, lastColor: ColorKey): void {
    for (const swatch of this.toolbar.querySelectorAll<HTMLButtonElement>('.swatch')) {
      swatch.dataset['last'] = swatch.dataset['color'] === lastColor ? 'true' : 'false';
    }
    this.toolbar.classList.remove('hidden');
    const view = this.doc.defaultView;
    const width = this.toolbar.offsetWidth;
    const height = this.toolbar.offsetHeight;
    const maxLeft = (view?.innerWidth ?? 0) - width - 8;
    const maxTop = (view?.innerHeight ?? 0) - height - 8;
    this.toolbar.style.left = `${clamp(anchor.left + anchor.width / 2 - width / 2, 8, maxLeft)}px`;
    this.toolbar.style.top = `${clamp(anchor.bottom + 8, 8, maxTop)}px`;
  }

  hideToolbar(): void {
    this.toolbar.classList.add('hidden');
  }

  openCommentBox(anchor: DOMRect, onSave: (text: string) => void): void {
    this.commentSave = onSave;
    this.commentBox.textContent = '';
    const textarea = this.doc.createElement('textarea');
    textarea.placeholder = 'Add a note…';
    const actions = this.doc.createElement('div');
    actions.className = 'comment-actions';
    const cancel = this.doc.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.closeCommentBox());
    const save = this.doc.createElement('button');
    save.className = 'primary';
    save.textContent = 'Save';
    save.setAttribute('data-locus-comment-save', '');
    save.addEventListener('click', () => {
      this.commentSave?.(textarea.value.trim());
      this.closeCommentBox();
    });
    actions.append(cancel, save);
    this.commentBox.append(textarea, actions);
    this.commentBox.classList.remove('hidden');
    const view = this.doc.defaultView;
    const maxLeft = (view?.innerWidth ?? 0) - 248;
    const maxTop = (view?.innerHeight ?? 0) - 140;
    this.commentBox.style.left = `${clamp(anchor.left, 8, maxLeft)}px`;
    this.commentBox.style.top = `${clamp(anchor.bottom + 8, 8, maxTop)}px`;
    textarea.focus();
  }

  closeCommentBox(): void {
    this.commentSave = null;
    this.commentBox.classList.add('hidden');
    this.commentBox.textContent = '';
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
