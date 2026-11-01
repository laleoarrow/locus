import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import type { AnnotationEditExpectation } from '@/domain/editing';
import type { LibraryAnnotation } from '@/domain/library';
import { requestBg } from '@/messaging/protocol';

interface NoteDraft {
  text: string;
  expected: AnnotationEditExpectation;
  status: string;
  busy: boolean;
}

interface NoteDraftState {
  drafts: ReadonlyMap<string, NoteDraft>;
  begin(annotation: LibraryAnnotation): void;
  change(id: string, text: string): void;
  cancel(id: string): void;
  save(id: string): Promise<void>;
}

const NoteDraftContext = createContext<NoteDraftState | null>(null);

/** In-memory edit sessions outlive filtered, collapsed and regrouped rows. */
export function NoteDraftProvider({ children }: { children: ReactNode }) {
  const current = useRef(new Map<string, NoteDraft>());
  const [drafts, setDrafts] = useState(current.current);
  const replace = (id: string, draft?: NoteDraft) => {
    const next = new Map(current.current);
    if (draft) next.set(id, draft);
    else next.delete(id);
    current.current = next;
    setDrafts(next);
  };

  const begin = (annotation: LibraryAnnotation) => {
    if (current.current.has(annotation.id)) return;
    replace(annotation.id, {
      text: annotation.note, status: '', busy: false,
      expected: { id: annotation.id, updatedAt: annotation.updatedAt,
        colorUpdatedAt: annotation.colorUpdatedAt, deletedAt: annotation.deletedAt },
    });
  };
  const change = (id: string, text: string) => {
    const draft = current.current.get(id);
    if (draft && !draft.busy) replace(id, { ...draft, text });
  };
  const cancel = (id: string) => {
    if (!current.current.get(id)?.busy) replace(id);
  };
  const save = async (id: string) => {
    const draft = current.current.get(id);
    if (!draft || draft.busy) return;
    replace(id, { ...draft, busy: true, status: '' });
    try {
      const result = await requestBg({
        type: 'annotations:edit', expected: [draft.expected],
        action: { type: 'comment', comment: draft.text.trim(), mode: 'replace' },
      });
      if (!result || result.error) throw new Error(result?.error ?? 'Could not save the note. Try again.');
      replace(id);
    } catch (error) {
      replace(id, { ...draft, busy: false,
        status: error instanceof Error ? error.message : 'Could not save the note. Try again.' });
    }
  };

  return <NoteDraftContext.Provider value={{ drafts, begin, change, cancel, save }}>
    {children}
  </NoteDraftContext.Provider>;
}

export function useNoteDrafts(): NoteDraftState {
  const context = useContext(NoteDraftContext);
  if (!context) throw new Error('NoteDraftProvider is missing.');
  return context;
}
