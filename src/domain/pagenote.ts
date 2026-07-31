import JSZip from 'jszip';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupFile,
} from './backup';
import { customColorFromHex, DEFAULT_COLOR } from './colors';
import type {
  AnchorRecord,
  AnnotationRecord,
  CustomColor,
  DocumentRecord,
  SourceRecord,
} from './types';
import { toUrlKey } from './url';

const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_FILES = 100_000;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_JSON_BYTES = 100 * 1024 * 1024;
const MAX_ROWS = 50_000;
const CONTEXT_LENGTH = 32;
const UNKNOWN_POSITION_BASE = 8_000_000_000_000_000;

type UnknownRecord = Record<string, unknown>;

export interface PageNoteImportStats {
  highlights: number;
  deletedHighlights: number;
  highlightNotes: number;
  recordsSkipped: number;
  emptyNotesSkipped: number;
  standaloneNotesSkipped: number;
  degradedStrikethroughs: number;
}

export type PageNoteParseResult =
  | { file: BackupFile; stats: PageNoteImportStats }
  | { error: string };

interface TableRows {
  rows: UnknownRecord[];
  recognised: boolean;
  malformed: number;
}

interface PageMetadata {
  url: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface ImportedPage {
  document: DocumentRecord;
  source: SourceRecord;
}

interface NoteContent {
  row: UnknownRecord;
  content: string;
  deleted: boolean;
}

interface ReadBudget {
  used: number;
}

class ArchiveError extends Error {}

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(row: UnknownRecord, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function firstText(...values: string[]): string {
  return values.find((value) => value.trim().length > 0)?.trim() ?? '';
}

function numberField(row: UnknownRecord, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function firstTimestamp(row: UnknownRecord, ...keys: string[]): number {
  for (const key of keys) {
    const value = numberField(row, key);
    if (value !== null) return value;
  }
  return 0;
}

function firstHttpUrl(...values: string[]): string {
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') return value;
    } catch {
      // Try the next candidate.
    }
  }
  return '';
}

function fallbackTitle(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function earliestKnown(a: number, b: number): number {
  if (a === 0) return b;
  if (b === 0) return a;
  return Math.min(a, b);
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function impossiblePoint() {
  return { steps: [], textIndex: Number.MAX_SAFE_INTEGER, offset: 0 };
}

function textPosition(row: UnknownRecord, exact: string): { start: number; end: number } | null {
  const position = row['textPosition'];
  if (!isObject(position)) return null;
  const start = numberField(position, 'start');
  const end = numberField(position, 'end');
  if (start === null || end === null || end <= start || end - start !== exact.length) return null;
  return { start, end };
}

function combinedComment(row: UnknownRecord, linkedNote = ''): string {
  const values = [stringField(row, 'tip'), stringField(row, 'comment'), linkedNote]
    .map((value) => value.trim())
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
  return values.join('\n\n');
}

function tiptapText(value: unknown): string {
  if (!isObject(value)) return '';
  if (value['type'] === 'text' && typeof value['text'] === 'string') return value['text'];
  const content = value['content'];
  if (!Array.isArray(content)) return value['type'] === 'hardBreak' ? '\n' : '';
  const text = content.map(tiptapText).join('');
  const blockTypes = new Set([
    'paragraph',
    'heading',
    'blockquote',
    'codeBlock',
    'listItem',
    'bulletList',
    'orderedList',
  ]);
  return blockTypes.has(String(value['type'])) ? `${text}\n` : text;
}

function noteContent(row: UnknownRecord): string {
  const title = stringField(row, 'title').trim();
  const body = firstText(
    stringField(row, 'markdown'),
    stringField(row, 'plainText'),
    tiptapText(row['tiptap']),
    stringField(row, 'html')
      .replace(/<[^>]*>/g, ' ')
      .replaceAll('&nbsp;', ' ')
      .trim(),
  );
  if (!title) return body;
  if (!body || body === title) return title;
  return `# ${title}\n\n${body}`;
}

function makeNoteMaps(rows: UnknownRecord[]): {
  byNoteKey: Map<string, NoteContent>;
  byLightKey: Map<string, NoteContent>;
} {
  const byNoteKey = new Map<string, NoteContent>();
  const byLightKey = new Map<string, NoteContent>();

  for (const row of rows) {
    const deleted = row['deleted'] === true;
    const note = { row, content: deleted ? '' : noteContent(row), deleted };
    const key = firstText(stringField(row, 'key'), stringField(row, 'noteId'));
    if (key) byNoteKey.set(key, note);
    for (const lightKey of [
      stringField(row, 'lightKey'),
      stringField(row, 'lightId'),
      stringField(row, 'annotationKey'),
    ]) {
      if (lightKey) byLightKey.set(lightKey, note);
    }
    const relatedType = stringField(row, 'relatedType').toLowerCase();
    const relatedKey = stringField(row, 'relatedKey');
    if ((relatedType === 'light' || relatedType === 'highlight') && relatedKey) {
      byLightKey.set(relatedKey, note);
    }
  }

  return { byNoteKey, byLightKey };
}

function linkedNoteFor(
  row: UnknownRecord,
  maps: ReturnType<typeof makeNoteMaps>,
): NoteContent | undefined {
  for (const noteKey of [
    stringField(row, 'noteKey'),
    stringField(row, 'noteId'),
    stringField(row, 'annotationKey'),
  ]) {
    const note = maps.byNoteKey.get(noteKey);
    if (note) return note;
  }
  for (const lightKey of [stringField(row, 'key'), stringField(row, 'lightId')]) {
    const note = maps.byLightKey.get(lightKey);
    if (note) return note;
  }
  return undefined;
}

function pathMatches(name: string, folder: string): boolean {
  return new RegExp(`(?:^|/)${folder}/[^/]+\\.json$`, 'i').test(name);
}

async function readTable(
  entries: JSZip.JSZipObject[],
  tableName: string,
  budget: ReadBudget,
): Promise<TableRows> {
  const rows: UnknownRecord[] = [];
  let recognised = false;
  let malformed = 0;

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    // JSZip exposes the parsed central-directory size on loaded entries. Check
    // it before `async()` materialises the uncompressed payload in memory.
    const internal = entry as JSZip.JSZipObject & {
      _data?: { uncompressedSize?: unknown };
    };
    const uncompressedSize = internal._data?.uncompressedSize;
    if (
      typeof uncompressedSize !== 'number' ||
      !Number.isFinite(uncompressedSize) ||
      uncompressedSize < 0
    ) {
      throw new ArchiveError(`Cannot verify PageNote entry size: ${entry.name}`);
    }
    if (uncompressedSize > MAX_JSON_BYTES) {
      throw new ArchiveError(`PageNote entry is too large: ${entry.name}`);
    }
    budget.used += uncompressedSize;
    if (budget.used > MAX_TOTAL_JSON_BYTES) {
      throw new ArchiveError('PageNote JSON data is too large (maximum 100 MB).');
    }
    const text = await entry.async('string');
    if (new Blob([text]).size > MAX_JSON_BYTES) {
      throw new ArchiveError(`PageNote entry is too large: ${entry.name}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      malformed++;
      continue;
    }
    if (!isObject(parsed) || !isObject(parsed['tables'])) {
      malformed++;
      continue;
    }
    const table = parsed['tables'][tableName];
    if (!Array.isArray(table)) {
      malformed++;
      continue;
    }
    recognised = true;
    for (const row of table) {
      if (isObject(row)) rows.push(row);
      else malformed++;
      if (rows.length > MAX_ROWS) {
        throw new ArchiveError('PageNote backup contains too many records.');
      }
    }
  }

  return { rows, recognised, malformed };
}

function makeMetadataMaps(rows: UnknownRecord[]): {
  byReference: Map<string, PageMetadata>;
  byUrlKey: Map<string, PageMetadata>;
} {
  const byReference = new Map<string, PageMetadata>();
  const byUrlKey = new Map<string, PageMetadata>();

  for (const row of rows) {
    if (row['deleted'] === true) continue;
    const url = firstHttpUrl(stringField(row, 'url'), stringField(row, 'source'));
    if (!url) continue;
    const metadata: PageMetadata = {
      url,
      title: firstText(stringField(row, 'customTitle'), stringField(row, 'title')),
      createdAt: firstTimestamp(row, 'createAt', 'visitedAt', 'updateAt'),
      updatedAt: firstTimestamp(row, 'updateAt', 'visitedAt', 'createAt'),
    };
    byUrlKey.set(toUrlKey(url), metadata);
    for (const reference of [
      stringField(row, 'key'),
      stringField(row, 'webpageKey'),
      stringField(row, 'url'),
      stringField(row, 'source'),
    ]) {
      if (reference) byReference.set(reference, metadata);
    }
  }

  return { byReference, byUrlKey };
}

function metadataFor(
  row: UnknownRecord,
  directUrl: string,
  maps: ReturnType<typeof makeMetadataMaps>,
): PageMetadata | undefined {
  for (const reference of [
    stringField(row, 'webpageKey'),
    stringField(row, 'pageKey'),
  ]) {
    const metadata = maps.byReference.get(reference);
    if (metadata) return metadata;
  }
  return directUrl ? maps.byUrlKey.get(toUrlKey(directUrl)) : undefined;
}

function ensurePage(
  pages: Map<string, ImportedPage>,
  url: string,
  title: string,
  createdAt: number,
  updatedAt: number,
): ImportedPage {
  const urlKey = toUrlKey(url);
  const existing = pages.get(urlKey);
  if (existing) {
    existing.document.createdAt = earliestKnown(existing.document.createdAt, createdAt);
    existing.document.updatedAt = Math.max(existing.document.updatedAt, updatedAt);
    existing.source.firstSeenAt = earliestKnown(existing.source.firstSeenAt, createdAt);
    existing.source.lastSeenAt = Math.max(existing.source.lastSeenAt, updatedAt);
    if (!existing.document.title && title) existing.document.title = title;
    if (!existing.source.title && title) existing.source.title = title;
    return existing;
  }

  const idPart = encodeURIComponent(urlKey);
  const document: DocumentRecord = {
    id: `pagenote:document:${idPart}`,
    title,
    doi: '',
    createdAt,
    updatedAt,
  };
  const source: SourceRecord = {
    id: `pagenote:source:${idPart}`,
    documentId: document.id,
    urlKey,
    url,
    title,
    firstSeenAt: createdAt,
    lastSeenAt: updatedAt,
  };
  const page = { document, source };
  pages.set(urlKey, page);
  return page;
}

function colorFor(row: UnknownRecord, customColors: Map<string, CustomColor>): string {
  const raw = firstText(stringField(row, 'bg'), stringField(row, 'lightBg'));
  const custom = customColorFromHex(raw);
  if (!custom) return DEFAULT_COLOR;
  customColors.set(custom.key, custom);
  return custom.key;
}

/**
 * Convert a PageNote export ZIP into Locus's portable backup shape. The actual
 * database merge remains in repo.importBackup, so URL linking and idempotence
 * are shared with native Locus backups.
 */
export async function parsePageNoteZip(
  data: Blob | ArrayBuffer | Uint8Array,
  appVersion: string,
): Promise<PageNoteParseResult> {
  const archiveBytes = data instanceof Blob ? data.size : data.byteLength;
  if (archiveBytes > MAX_ARCHIVE_BYTES) {
    return { error: 'PageNote ZIP is too large (maximum 250 MB).' };
  }

  try {
    const zip = await JSZip.loadAsync(data);
    const files = Object.values(zip.files).filter((entry) => !entry.dir);
    if (files.length > MAX_FILES) {
      return { error: 'PageNote ZIP contains too many files.' };
    }

    const budget = { used: 0 };
    const [lights, webpages, notes] = await Promise.all([
      readTable(files.filter((entry) => pathMatches(entry.name, 'light')), 'light', budget),
      readTable(files.filter((entry) => pathMatches(entry.name, 'webpage')), 'webpage', budget),
      readTable(
        files.filter((entry) => /(?:^|\/)note\.json$/i.test(entry.name)),
        'note',
        budget,
      ),
    ]);
    if (!lights.recognised && !webpages.recognised && !notes.recognised) {
      return { error: 'That ZIP is not a PageNote backup.' };
    }

    const stats: PageNoteImportStats = {
      highlights: 0,
      deletedHighlights: 0,
      highlightNotes: 0,
      recordsSkipped: lights.malformed + webpages.malformed + notes.malformed,
      emptyNotesSkipped: 0,
      standaloneNotesSkipped: 0,
      degradedStrikethroughs: 0,
    };

    const metadataMaps = makeMetadataMaps(webpages.rows);
    const noteMaps = makeNoteMaps(notes.rows);
    const linkedNotes = new Set<UnknownRecord>();
    const pages = new Map<string, ImportedPage>();
    const annotations: AnnotationRecord[] = [];
    const anchors: AnchorRecord[] = [];
    const customColors = new Map<string, CustomColor>();
    let exportedAt = 0;
    for (const row of webpages.rows) {
      exportedAt = Math.max(exportedAt, firstTimestamp(row, 'updateAt', 'visitedAt', 'createAt'));
    }
    for (const row of notes.rows) {
      exportedAt = Math.max(exportedAt, firstTimestamp(row, 'updateAt', 'createAt'));
    }

    for (const row of lights.rows) {
      const referenced = metadataFor(row, '', metadataMaps);
      const url = firstHttpUrl(
        stringField(row, 'url'),
        stringField(row, 'source'),
        stringField(row, 'pageKey'),
        referenced?.url ?? '',
      );
      const exact = stringField(row, 'text');
      if (!url || !exact.trim()) {
        stats.recordsSkipped++;
        continue;
      }
      const metadata = metadataFor(row, url, metadataMaps) ?? referenced;
      const title = firstText(
        metadata?.title ?? '',
        stringField(row, 'title'),
        fallbackTitle(url),
      );
      const rawKey = firstText(stringField(row, 'key'), stringField(row, 'lightId'));
      const linkedNote = linkedNoteFor(row, noteMaps);
      const createdAt = firstTimestamp(row, 'createAt', 'time', 'updateAt');
      const updatedAt = Math.max(
        createdAt,
        firstTimestamp(row, 'updateAt', 'time', 'createAt'),
        linkedNote ? firstTimestamp(linkedNote.row, 'updateAt', 'createAt') : 0,
      );
      exportedAt = Math.max(exportedAt, updatedAt);
      const page = ensurePage(
        pages,
        url,
        title,
        earliestKnown(createdAt, metadata?.createdAt ?? 0),
        Math.max(updatedAt, metadata?.updatedAt ?? 0),
      );
      const prefix = stringField(row, 'pre').slice(-CONTEXT_LENGTH);
      const suffix = stringField(row, 'suffix').slice(0, CONTEXT_LENGTH);
      const generatedKey = stableHash(
        [page.source.urlKey, exact, prefix, suffix, String(createdAt)].join('\u0000'),
      ).toString(16);
      const annotationId = `pagenote:light:${encodeURIComponent(rawKey || `generated-${generatedKey}`)}`;
      const position = textPosition(row, exact);
      const start = position?.start ?? UNKNOWN_POSITION_BASE + stableHash(annotationId);
      const end = position?.end ?? start + exact.length;
      if (linkedNote) linkedNotes.add(linkedNote.row);
      const comment = combinedComment(row, linkedNote?.content);
      const deleted = row['deleted'] === true;

      annotations.push({
        id: annotationId,
        documentId: page.document.id,
        sourceId: page.source.id,
        kind: 'text',
        color: colorFor(row, customColors),
        comment,
        exact,
        createdAt,
        updatedAt,
        deletedAt: deleted ? Math.max(updatedAt, createdAt, 1) : 0,
      });
      anchors.push({
        id: `pagenote:anchor:${encodeURIComponent(rawKey || `generated-${generatedKey}`)}`,
        annotationId,
        exact,
        prefix,
        suffix,
        start,
        end,
        startPoint: impossiblePoint(),
        endPoint: impossiblePoint(),
      });
      if (deleted) stats.deletedHighlights++;
      else stats.highlights++;
      if (!deleted && comment) stats.highlightNotes++;
      if (!deleted && stringField(row, 'lightType').toLowerCase() === 'del') {
        stats.degradedStrikethroughs++;
      }
    }

    for (const note of notes.rows) {
      if (linkedNotes.has(note)) continue;
      if (note['deleted'] === true) {
        stats.recordsSkipped++;
        continue;
      }
      if (noteContent(note)) stats.standaloneNotesSkipped++;
      else stats.emptyNotesSkipped++;
    }

    return {
      file: {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        exportedAt,
        appVersion: `PageNote → Locus ${appVersion}`,
        documents: [...pages.values()].map((page) => page.document),
        sources: [...pages.values()].map((page) => page.source),
        annotations,
        anchors,
        settings:
          customColors.size > 0
            ? [{ key: 'customColors', value: [...customColors.values()] }]
            : [],
      },
      stats,
    };
  } catch (error) {
    if (error instanceof ArchiveError) return { error: error.message };
    return { error: 'That file is not a readable PageNote ZIP.' };
  }
}
