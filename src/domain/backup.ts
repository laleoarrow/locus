import type {
  AnchorRecord,
  AnnotationRecord,
  DocumentRecord,
  PageSummaryRecord,
  SettingRecord,
  SourceRecord,
} from './types';
import { isAnchorRecord } from './anchor/validate';

/**
 * Backup file format: the portable form of a Locus library. Used for manual
 * backup and for moving annotations between machines (and between extension
 * installs, whose IndexedDB is keyed by extension id).
 *
 * Versioned independently of the DB schema: `formatVersion` describes this
 * file's shape, so an old file stays readable after DB migrations.
 */
export const BACKUP_FORMAT = 'locus-backup';
// v2 added the independent colour clock; v3 adds independently merged page
// summaries. Older clients must reject v3 rather than silently strip them.
export const BACKUP_FORMAT_VERSION = 3;

/** Volatile settings that must never travel between machines. */
export const UNPORTABLE_SETTING_KEYS = new Set(['updateInfo', 'locus.llm.config']);

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: number;
  appVersion: string;
  documents: DocumentRecord[];
  sources: SourceRecord[];
  annotations: AnnotationRecord[];
  anchors: AnchorRecord[];
  /** Absent in v1/v2; current exports always include this array. */
  pageSummaries?: PageSummaryRecord[];
  settings: SettingRecord[];
}

export interface ImportSummary {
  annotationsAdded: number;
  annotationsUpdated: number;
  /** Incoming rows an equal-or-newer local row already covered. */
  annotationsSkipped: number;
  /** Incoming sources recognised as a page already known locally. */
  sourcesLinked: number;
  sourcesAdded: number;
  /** Portable settings inserted or extended by the incoming backup. */
  settingsUpdated: number;
  /** Page summaries inserted or replaced by a newer incoming revision. */
  summariesUpdated: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringField(row: Record<string, unknown>, field: string): boolean {
  return typeof row[field] === 'string';
}

function isNumberField(row: Record<string, unknown>, field: string): boolean {
  return typeof row[field] === 'number' && Number.isFinite(row[field] as number);
}

function hasText(row: Record<string, unknown>, field: string): boolean {
  return typeof row[field] === 'string' && (row[field] as string).trim().length > 0;
}

function isClock(row: Record<string, unknown>, field: string): boolean {
  return isNumberField(row, field) && (row[field] as number) >= 0;
}

/**
 * Validate a parsed backup file. Import runs on a user-supplied file, so every
 * row is checked before it reaches the database; malformed rows are dropped
 * rather than trusted, and a file with the wrong shape is rejected outright.
 */
export function parseBackup(raw: unknown): { file: BackupFile; invalidRowsDropped: boolean } | { error: string } {
  if (!isObject(raw)) return { error: 'Not a Locus backup file.' };
  if (raw['format'] !== BACKUP_FORMAT) return { error: 'Not a Locus backup file.' };
  const formatVersion = raw['formatVersion'];
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion) || formatVersion < 1) {
    return { error: 'Backup file has no version.' };
  }
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    return { error: `Backup was made by a newer Locus (format v${formatVersion}). Update first.` };
  }

  const rows = (key: string): Record<string, unknown>[] => {
    const value = raw[key];
    return Array.isArray(value) ? value.filter(isObject) : [];
  };

  const documents = rows('documents').filter(
    (d) => hasText(d, 'id') && isStringField(d, 'title') &&
      (d['doi'] === undefined || isStringField(d, 'doi')) && isClock(d, 'createdAt') && isClock(d, 'updatedAt'),
  ).map((d) => ({ ...d, doi: d['doi'] ?? '' })) as unknown as DocumentRecord[];
  const sources = rows('sources').filter(
    (s) => ['id', 'documentId', 'urlKey', 'url'].every((field) => hasText(s, field)) &&
      isStringField(s, 'title') && isClock(s, 'firstSeenAt') && isClock(s, 'lastSeenAt'),
  ) as unknown as SourceRecord[];
  const annotations = rows('annotations').filter(
    (a) =>
      ['id', 'sourceId', 'documentId', 'color'].every((field) => hasText(a, field)) &&
      (a['kind'] === undefined || a['kind'] === 'text' || a['kind'] === 'image') &&
      isStringField(a, 'comment') && isStringField(a, 'exact') &&
      (a['kind'] === 'image' || hasText(a, 'exact')) &&
      isClock(a, 'createdAt') && isClock(a, 'updatedAt') &&
      (a['colorUpdatedAt'] === undefined || isClock(a, 'colorUpdatedAt')) && isClock(a, 'deletedAt'),
  // Original text-only libraries predate annotation.kind; DOI and the colour
  // clock are the other historically optional fields. Do not guess other data.
  ).map((a) => ({ ...a, kind: a['kind'] ?? 'text' })) as unknown as AnnotationRecord[];
  const annotationKinds = new Map(annotations.map((annotation) => [annotation.id, annotation.kind]));
  const anchors = rows('anchors').filter(
    (row): row is Record<string, unknown> & AnchorRecord => isAnchorRecord(row) &&
      annotationKinds.get(row.annotationId) === (row.kind ?? 'text'),
  );
  const pageSummaries = rows('pageSummaries').filter(
    (s) => isStringField(s, 'sourceId') && Boolean(s['sourceId']) &&
      isStringField(s, 'content') && isNumberField(s, 'updatedAt') && (s['updatedAt'] as number) > 0,
  ).map((s): PageSummaryRecord => ({
    sourceId: s['sourceId'] as string,
    content: s['content'] as string,
    updatedAt: s['updatedAt'] as number,
  }));
  const settings = rows('settings').filter(
    (s) => hasText(s, 'key') && Object.hasOwn(s, 'value') && !UNPORTABLE_SETTING_KEYS.has(s['key'] as string),
  ) as unknown as SettingRecord[];
  // Manual imports salvage valid rows. Sync must detect that salvage before
  // replacing a remote snapshot, while intentional private-setting removal is safe.
  const invalidRowsDropped = Object.entries({ documents, sources, annotations, anchors, pageSummaries })
    .some(([key, accepted]) => raw[key] !== undefined &&
      (!Array.isArray(raw[key]) || raw[key].length !== accepted.length));

  return {
    invalidRowsDropped,
    file: {
      format: BACKUP_FORMAT,
      formatVersion,
      exportedAt: isNumberField(raw, 'exportedAt') ? (raw['exportedAt'] as number) : 0,
      appVersion: isStringField(raw, 'appVersion') ? (raw['appVersion'] as string) : 'unknown',
      documents,
      sources,
      annotations,
      anchors,
      pageSummaries,
      settings,
    },
  };
}

/** Default download name, e.g. `locus-backup-2026-07-30.json`. */
export function backupFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `locus-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}
