import Dexie, { type Table } from 'dexie';
import type {
  AnchorRecord,
  AnnotationRecord,
  DocumentRecord,
  SettingRecord,
  SourceRecord,
} from '@/domain/types';

/**
 * Extension-origin IndexedDB. Opened by the background worker (single write
 * path) and by the side panel (liveQuery reads). Content scripts never touch
 * it — their storage would land in the page origin.
 *
 * Migration strategy: additive `version(n)` bumps only; the DB version is the
 * schema version. Deletes are tombstones (`deletedAt`), never row removals.
 */
/**
 * Last known anchoring result for an annotation, reported by the content
 * script when it changes.
 *
 * Deliberately a table of its own rather than a field on `AnnotationRecord`:
 * it is local runtime knowledge, so writing it must not touch the annotation's
 * `updatedAt` (which decides sync conflicts) and it must not travel in a
 * backup. `exportBackup` enumerates tables explicitly, so this one is left out
 * by construction.
 */
export interface AnchorStateRecord {
  annotationId: string;
  detached: boolean;
  checkedAt: number;
}

export class LocusDB extends Dexie {
  documents!: Table<DocumentRecord, string>;
  sources!: Table<SourceRecord, string>;
  annotations!: Table<AnnotationRecord, string>;
  anchors!: Table<AnchorRecord, string>;
  settings!: Table<SettingRecord, string>;
  anchorStates!: Table<AnchorStateRecord, string>;

  constructor() {
    super('locus');
    this.version(1).stores({
      documents: 'id, updatedAt',
      sources: 'id, urlKey, documentId',
      annotations: 'id, sourceId, documentId, createdAt, deletedAt',
      anchors: 'id, annotationId',
      settings: 'key',
    });
    // v2: DOI index for cross-version paper matching; backfill ''.
    this.version(2)
      .stores({
        documents: 'id, updatedAt, doi',
      })
      .upgrade((tx) =>
        tx
          .table('documents')
          .toCollection()
          .modify((doc: { doi?: string }) => {
            doc.doi ??= '';
          }),
      );
    // v3: last known anchoring state, so the library can surface detached
    // annotations without a content script running on every page. Purely
    // additive — nothing to backfill, an absent row simply means "not seen".
    this.version(3).stores({
      anchorStates: 'annotationId, detached',
    });
  }
}

export const db = new LocusDB();
