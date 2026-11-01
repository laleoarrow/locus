import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AnnotationEditExpectation } from '@/domain/editing';
import type { LibraryAnnotation } from '@/domain/library';
import { requestBg } from '@/messaging/protocol';

interface NoteDraft {
  text: string;
  expected: AnnotationEditExpectation;
  status: string;
  busy: boolean;
}

interface NoteDraftStore {
  get(id: string): NoteDraft | undefined;
  subscribe(id: string, listener: () => void): () => void;
  begin(annotation: LibraryAnnotation): void;
  change(id: string, text: string): void;
  cancel(id: string): void;
  save(id: string): Promise<void>;
}

const NoteDraftContext = createContext<NoteDraftStore | null>(null);

/** Keep notifications local to the edited annotation, including hidden drafts. */
function createNoteDraftStore(): NoteDraftStore {
  const drafts = new Map<string, NoteDraft>();
  const listeners = new Map<string, Set<() => void>>();
  const replace = (id: string, draft?: NoteDraft) => {
    if (draft) drafts.set(id, draft);
    else drafts.delete(id);
    listeners.get(id)?.forEach((listener) => listener());
  };

  const begin = (annotation: LibraryAnnotation) => {
    if (drafts.has(annotation.id)) return;
    replace(annotation.id, {
      text: annotation.note, status: '', busy: false,
      expected: { id: annotation.id, updatedAt: annotation.updatedAt,
        colorUpdatedAt: annotation.colorUpdatedAt, deletedAt: annotation.deletedAt },
    });
  };
  const change = (id: string, text: string) => {
    const draft = drafts.get(id);
    if (draft && !draft.busy) replace(id, { ...draft, text });
  };
  const cancel = (id: string) => {
    if (!drafts.get(id)?.busy) replace(id);
  };
  const save = async (id: string) => {
    const draft = drafts.get(id);
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

  return {
    get: (id) => drafts.get(id), begin, change, cancel, save,
    subscribe: (id, listener) => {
      let subscriptions = listeners.get(id);
      if (!subscriptions) listeners.set(id, subscriptions = new Set());
      subscriptions.add(listener);
      return () => {
        subscriptions.delete(listener);
        if (subscriptions.size === 0) listeners.delete(id);
      };
    },
  };
}

/** In-memory edit sessions outlive filtered, collapsed and regrouped rows. */
export function NoteDraftProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createNoteDraftStore);
  return <NoteDraftContext.Provider value={store}>{children}</NoteDraftContext.Provider>;
}

export function useNoteDraft(id: string) {
  const store = useContext(NoteDraftContext);
  if (!store) throw new Error('NoteDraftProvider is missing.');
  const subscribe = useCallback((listener: () => void) => store.subscribe(id, listener), [store, id]);
  const getSnapshot = useCallback(() => store.get(id), [store, id]);
  const draft = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { draft, begin: store.begin, change: store.change, cancel: store.cancel, save: store.save };
}
