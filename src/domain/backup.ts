import type {
  AnchorRecord,
  AnnotationRecord,
  DocumentRecord,
  SettingRecord,
  SourceRecord,
} from './types';

/**
 * Backup file format: the portable form of a Locus library. Used for manual
 * backup and for moving annotations between machines (and between extension
 * installs, whose IndexedDB is keyed by extension id).
 *
 * Versioned independently of the DB schema: `formatVersion` describes this
 * file's shape, so an old file stays readable after DB migrations.
 */
export const BACKUP_FORMAT = 'locus-backup';
export const BACKUP_FORMAT_VERSION = 1;

/** Volatile settings that must never travel between machines. */
export const UNPORTABLE_SETTING_KEYS = new Set(['updateInfo']);

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: number;
  appVersion: string;
  documents: DocumentRecord[];
  sources: SourceRecord[];
  annotations: AnnotationRecord[];
  anchors: AnchorRecord[];
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

/**
 * Validate a parsed backup file. Import runs on a user-supplied file, so every
 * row is checked before it reaches the database; malformed rows are dropped
 * rather than trusted, and a file with the wrong shape is rejected outright.
 */
export function parseBackup(raw: unknown): { file: BackupFile } | { error: string } {
  if (!isObject(raw)) return { error: 'Not a Locus backup file.' };
  if (raw['format'] !== BACKUP_FORMAT) return { error: 'Not a Locus backup file.' };
  const formatVersion = raw['formatVersion'];
  if (typeof formatVersion !== 'number' || !Number.isFinite(formatVersion)) {
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
    (d) => isStringField(d, 'id') && isNumberField(d, 'updatedAt'),
  ) as unknown as DocumentRecord[];
  const sources = rows('sources').filter(
    (s) => isStringField(s, 'id') && isStringField(s, 'documentId') && isStringField(s, 'urlKey'),
  ) as unknown as SourceRecord[];
  const annotations = rows('annotations').filter(
    (a) =>
      isStringField(a, 'id') &&
      isStringField(a, 'sourceId') &&
      isStringField(a, 'documentId') &&
      isNumberField(a, 'updatedAt') &&
      isNumberField(a, 'deletedAt'),
  ) as unknown as AnnotationRecord[];
  const anchors = rows('anchors').filter(
    (a) => isStringField(a, 'id') && isStringField(a, 'annotationId'),
  ) as unknown as AnchorRecord[];
  const settings = rows('settings').filter(
    (s) => isStringField(s, 'key') && !UNPORTABLE_SETTING_KEYS.has(s['key'] as string),
  ) as unknown as SettingRecord[];

  return {
    file: {
      format: BACKUP_FORMAT,
      formatVersion,
      exportedAt: isNumberField(raw, 'exportedAt') ? (raw['exportedAt'] as number) : 0,
      appVersion: isStringField(raw, 'appVersion') ? (raw['appVersion'] as string) : 'unknown',
      documents,
      sources,
      annotations,
      anchors,
      settings,
    },
  };
}

/** Default download name, e.g. `locus-backup-2026-07-30.json`. */
export function backupFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `locus-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}
