import { BACKUP_FORMAT, parseBackup, type BackupFile } from './backup';
import { effectiveColorUpdatedAt, type AnnotationRecord, type PageSummaryRecord, type SettingRecord } from './types';

export const SYNC_DIRECTORY = 'locus-v4/';
export const MAX_SYNC_BLOB_BYTES = 8 * 1024 * 1024;
export const MAX_SYNC_ROOT_BYTES = 32 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
export class SyncDataError extends Error {}

export interface SyncManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: 4;
  pages: Record<string, string>;
  settings: string;
}

export interface SyncProjection {
  pages: Map<string, BackupFile>;
  settings: BackupFile;
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, ordered(item)]));
  return value;
}

export function stableJSON(value: unknown): string { return JSON.stringify(ordered(value)); }
export function byteLength(body: string): number { return new TextEncoder().encode(body).byteLength; }
export async function contentHash(body: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function emptyBackup(): BackupFile {
  return { format: BACKUP_FORMAT, formatVersion: 3, exportedAt: 0, appVersion: 'sync-v4',
    documents: [], sources: [], annotations: [], anchors: [], pageSummaries: [], settings: [] };
}

function byId<T extends { id: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function largest(values: string[]): string { return values.filter(Boolean).sort().at(-1) ?? ''; }

/** Local viewing metadata and graph aliases never determine a network revision. */
export async function projectBackup(file: BackupFile): Promise<SyncProjection> {
  const pages = new Map<string, BackupFile>();
  const sources = new Map(file.sources.map((source) => [source.id, source]));
  const documents = new Map(file.documents.map((document) => [document.id, document]));
  const anchors = new Map(file.anchors.map((anchor) => [anchor.annotationId, anchor]));
  const needed = new Set([...file.annotations.map((row) => row.sourceId),
    ...(file.pageSummaries ?? []).map((row) => row.sourceId)]);
  const keys = [...new Set([...needed].map((id) => sources.get(id)?.urlKey).filter((key): key is string => Boolean(key)))].sort();
  for (const urlKey of keys) {
    const matching = file.sources.filter((source) => source.urlKey === urlKey);
    const ids = new Set(matching.map((source) => source.id));
    const pageId = await contentHash(urlKey);
    const sourceId = `source:${pageId}`;
    const documentId = `document:${pageId}`;
    const page = emptyBackup();
    page.annotations = byId(file.annotations.filter((row) => ids.has(row.sourceId)).map((row) => ({
      ...row, sourceId, documentId, colorUpdatedAt: effectiveColorUpdatedAt(row),
    })));
    page.pageSummaries = (file.pageSummaries ?? []).filter((row) => ids.has(row.sourceId))
      .map((row) => ({ ...row, sourceId })).reduce<PageSummaryRecord[]>((rows, row) =>
        [rows[0] ? mergeSummary(rows[0], row) : row], []);
    const docs = matching.map((source) => documents.get(source.documentId)).filter((row) => row !== undefined);
    const title = largest([...matching.map((source) => source.title), ...docs.map((row) => row.title)]);
    page.documents = [{ id: documentId, title, doi: largest(docs.map((row) => row.doi ?? '')), createdAt: 0, updatedAt: 0 }];
    page.sources = [{ id: sourceId, documentId, urlKey, url: urlKey, title, firstSeenAt: 0, lastSeenAt: 0 }];
    page.anchors = byId(page.annotations.flatMap((row) => {
      const anchor = anchors.get(row.id);
      return anchor ? [{ ...anchor, id: `anchor:${row.id}`, annotationId: row.id }] : [];
    }));
    pages.set(urlKey, page);
  }
  const settings = emptyBackup();
  const parsed = parseBackup(file);
  if ('error' in parsed) throw new SyncDataError('Invalid local sync data.');
  settings.settings = mergeSettings([], parsed.file.settings);
  return { pages, settings };
}

function mergeSummary(a: PageSummaryRecord, b: PageSummaryRecord): PageSummaryRecord {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (a.content === '' || b.content === '') return a.content === '' ? a : b;
  return a.content > b.content ? a : b;
}

export function annotationBaseWins(incoming: AnnotationRecord, local: AnnotationRecord): boolean {
  if (incoming.updatedAt !== local.updatedAt) return incoming.updatedAt > local.updatedAt;
  if (incoming.deletedAt !== local.deletedAt) return incoming.deletedAt > local.deletedAt;
  const { color: _a, colorUpdatedAt: _b, ...incomingBase } = incoming;
  const { color: _c, colorUpdatedAt: _d, ...localBase } = local;
  return stableJSON(incomingBase) > stableJSON(localBase);
}

function mergeSettings(a: SettingRecord[], b: SettingRecord[]): SettingRecord[] {
  const rows = new Map<string, SettingRecord>();
  for (const row of [...a, ...b]) {
    const previous = rows.get(row.key);
    if (Array.isArray(row.value)) {
      const values = new Map((Array.isArray(previous?.value) ? previous.value : []).map((item) => [stableJSON(item), item]));
      for (const item of row.value) values.set(stableJSON(item), item);
      rows.set(row.key, { key: row.key, value: [...values.entries()].sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0).map(([, item]) => item) });
    } else if (!Array.isArray(previous?.value) && (!previous || stableJSON(row.value) > stableJSON(previous.value))) rows.set(row.key, row);
  }
  return [...rows.values()].sort((x, y) => x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
}

/** Merge two already projected graphs without mutating either snapshot. */
export function mergeProjections(a: SyncProjection, b: SyncProjection): SyncProjection {
  const pages = new Map(a.pages);
  for (const [key, incoming] of b.pages) {
    const previous = pages.get(key);
    if (!previous) { pages.set(key, incoming); continue; }
    const page = emptyBackup();
    const annotations = new Map(previous.annotations.map((row) => [row.id, row]));
    const anchors = new Map(previous.anchors.map((row) => [row.annotationId, row]));
    const incomingAnchors = new Map(incoming.anchors.map((row) => [row.annotationId, row]));
    for (const row of incoming.annotations) {
      const local = annotations.get(row.id);
      const baseWins = !local || annotationBaseWins(row, local);
      const base = baseWins ? row : local;
      const localClock = local ? effectiveColorUpdatedAt(local) : -1;
      const incomingClock = effectiveColorUpdatedAt(row);
      const colorWins = incomingClock > localClock || (incomingClock === localClock && row.color > (local?.color ?? ''));
      annotations.set(row.id, { ...base, color: colorWins ? row.color : local!.color,
        colorUpdatedAt: Math.max(localClock, incomingClock) } as AnnotationRecord);
      const incomingAnchor = incomingAnchors.get(row.id);
      if (incomingAnchor && (baseWins || (local && !annotationBaseWins(local, row) &&
        (!anchors.has(row.id) || stableJSON(incomingAnchor) > stableJSON(anchors.get(row.id)))))) anchors.set(row.id, incomingAnchor);
    }
    page.annotations = byId([...annotations.values()]);
    page.anchors = byId([...anchors.values()]);
    const summaries = [...(previous.pageSummaries ?? []), ...(incoming.pageSummaries ?? [])];
    page.pageSummaries = summaries.length ? [summaries.reduce(mergeSummary)] : [];
    const docA = previous.documents[0]!; const docB = incoming.documents[0]!;
    const title = largest([docA.title, docB.title]);
    page.documents = [{ ...docA, title, doi: largest([docA.doi, docB.doi]),
      createdAt: Math.min(docA.createdAt, docB.createdAt), updatedAt: Math.max(docA.updatedAt, docB.updatedAt) }];
    page.sources = [{ ...previous.sources[0]!, title, firstSeenAt: page.documents[0]!.createdAt, lastSeenAt: 0 }];
    pages.set(key, page);
  }
  const settings = emptyBackup(); settings.settings = mergeSettings(a.settings.settings, b.settings.settings);
  return { pages: new Map([...pages.entries()].sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0)), settings };
}

export function projectionBackup(projection: SyncProjection): BackupFile {
  const file = emptyBackup();
  for (const page of projection.pages.values()) {
    file.documents.push(...page.documents); file.sources.push(...page.sources);
    file.annotations.push(...page.annotations); file.anchors.push(...page.anchors);
    file.pageSummaries!.push(...(page.pageSummaries ?? []));
  }
  file.settings = projection.settings.settings;
  return file;
}

export function parseManifest(body: string): SyncManifest {
  if (byteLength(body) > MAX_SYNC_ROOT_BYTES) throw new SyncDataError('Sync index is too large.');
  const raw = JSON.parse(body) as Partial<SyncManifest>;
  if (raw?.format !== BACKUP_FORMAT || raw.formatVersion !== 4 || !raw.pages || typeof raw.pages !== 'object' || Array.isArray(raw.pages) ||
    typeof raw.settings !== 'string' || !HASH.test(raw.settings) || Object.entries(raw.pages).some(([key, hash]) =>
      !key || key.length > 16384 || typeof hash !== 'string' || !HASH.test(hash))) throw new SyncDataError('Invalid sync index.');
  return raw as SyncManifest;
}

export function blobPath(kind: 'page' | 'settings', hash: string): string {
  if (!HASH.test(hash)) throw new SyncDataError('Invalid sync file reference.');
  return `${SYNC_DIRECTORY}${kind}-${hash}.json`;
}

function validWireRows(file: BackupFile): boolean {
  const clock = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const strings = (row: object, keys: string[]) => keys.every((key) => typeof (row as Record<string, unknown>)[key] === 'string');
  const steps = (value: unknown): boolean => Array.isArray(value) && value.every((step) => step &&
    typeof step.tag === 'string' && Number.isInteger(step.index) && step.index >= 0);
  const point = (value: unknown): boolean => Boolean(value && typeof value === 'object' &&
    steps((value as { steps?: unknown }).steps) &&
    Number.isInteger((value as { textIndex?: number }).textIndex) && ((value as { textIndex: number }).textIndex >= 0) &&
    Number.isInteger((value as { offset?: number }).offset) && ((value as { offset: number }).offset >= 0));
  return file.documents.every((row) => strings(row, ['id', 'title', 'doi']) && clock(row.createdAt) && clock(row.updatedAt)) &&
    file.sources.every((row) => strings(row, ['id', 'documentId', 'urlKey', 'url', 'title']) && clock(row.firstSeenAt) && clock(row.lastSeenAt)) &&
    file.annotations.every((row) => strings(row, ['id', 'sourceId', 'documentId', 'color', 'comment', 'exact']) &&
      (row.kind === 'text' || row.kind === 'image') && Boolean(row.color) &&
      clock(row.createdAt) && clock(row.updatedAt) && clock(row.colorUpdatedAt) && clock(row.deletedAt)) &&
    file.settings.every((row) => Boolean(row.key) && Object.hasOwn(row, 'value')) &&
    file.anchors.every((row) => strings(row, ['id', 'annotationId']) && (row.kind === 'image'
      ? strings(row, ['src', 'alt']) && Number.isInteger(row.imgIndex) && row.imgIndex >= 0 && steps(row.path)
      : strings(row, ['exact', 'prefix', 'suffix']) && clock(row.start) && clock(row.end) && point(row.startPoint) && point(row.endPoint)));
}

export async function validateBlob(body: string, hash: string, kind: 'page' | 'settings', urlKey?: string): Promise<BackupFile> {
  if (byteLength(body) > MAX_SYNC_BLOB_BYTES || await contentHash(body) !== hash) throw new SyncDataError('Sync file failed its integrity check.');
  const parsed = parseBackup(JSON.parse(body));
  if ('error' in parsed || parsed.file.formatVersion !== 3) throw new SyncDataError('Invalid sync file.');
  const file = parsed.file;
  if (!validWireRows(file)) throw new SyncDataError('Invalid sync file fields.');
  const projection = await projectBackup(file);
  const expected = kind === 'settings' ? projection.settings : projection.pages.get(urlKey ?? '');
  // Exact canonical form rejects dropped invalid rows, foreign pages and dangling references.
  if (!expected || stableJSON(expected) !== body) throw new SyncDataError('Invalid sync file contents.');
  return file;
}
