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
export class LocusDB extends Dexie {
  documents!: Table<DocumentRecord, string>;
  sources!: Table<SourceRecord, string>;
  annotations!: Table<AnnotationRecord, string>;
  anchors!: Table<AnchorRecord, string>;
  settings!: Table<SettingRecord, string>;

  constructor() {
    super('locus');
    this.version(1).stores({
      documents: 'id, updatedAt',
      sources: 'id, urlKey, documentId',
      annotations: 'id, sourceId, documentId, createdAt, deletedAt',
      anchors: 'id, annotationId',
      settings: 'key',
    });
  }
}

export const db = new LocusDB();
