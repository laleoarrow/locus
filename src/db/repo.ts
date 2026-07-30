import { DEFAULT_COLOR } from '@/domain/colors';
import type {
  AnchorPayload,
  AnnotationRecord,
  AnnotationWithAnchor,
  ColorKey,
  CustomColor,
  DocumentRecord,
  Prefs,
  SourceRecord,
  ToolbarPlacement,
} from '@/domain/types';
import { toUrlKey } from '@/domain/url';
import { db } from './schema';

const LAST_COLOR_KEY = 'lastUsedColor';

function uuid(): string {
  return crypto.randomUUID();
}

/** Find or create the source (and its document) for a URL. */
export async function ensureSource(url: string, title: string): Promise<SourceRecord> {
  const urlKey = toUrlKey(url);
  const now = Date.now();
  return db.transaction('rw', db.sources, db.documents, async () => {
    const existing = await db.sources.where('urlKey').equals(urlKey).first();
    if (existing) {
      const patch = { lastSeenAt: now, url, title: title || existing.title };
      await db.sources.update(existing.id, patch);
      return { ...existing, ...patch };
    }
    const document: DocumentRecord = { id: uuid(), title, createdAt: now, updatedAt: now };
    const source: SourceRecord = {
      id: uuid(),
      documentId: document.id,
      urlKey,
      url,
      title,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    await db.documents.add(document);
    await db.sources.add(source);
    return source;
  });
}

export async function findSourceByUrl(url: string): Promise<SourceRecord | undefined> {
  return db.sources.where('urlKey').equals(toUrlKey(url)).first();
}

export interface CreateAnnotationInput {
  sourceId: string;
  documentId: string;
  color: ColorKey;
  comment: string;
  anchor: AnchorPayload;
}

/** Create an annotation and its anchor atomically; remembers the color as last-used. */
export async function createAnnotation(input: CreateAnnotationInput): Promise<AnnotationWithAnchor> {
  const now = Date.now();
  const isImage = input.anchor.kind === 'image';
  const annotation: AnnotationRecord = {
    id: uuid(),
    documentId: input.documentId,
    sourceId: input.sourceId,
    kind: isImage ? 'image' : 'text',
    color: input.color,
    comment: input.comment,
    exact: input.anchor.kind === 'image' ? input.anchor.alt : input.anchor.exact,
    createdAt: now,
    updatedAt: now,
    deletedAt: 0,
  };
  const anchor = { ...input.anchor, id: uuid(), annotationId: annotation.id };
  await db.transaction('rw', db.annotations, db.anchors, db.documents, db.settings, async () => {
    await db.annotations.add(annotation);
    await db.anchors.add(anchor);
    await db.documents.update(input.documentId, { updatedAt: now });
    await db.settings.put({ key: LAST_COLOR_KEY, value: input.color });
  });
  return { annotation, anchor };
}

/** Live (non-tombstoned) annotations for a source, oldest first, with anchors. */
export async function listForSource(sourceId: string): Promise<AnnotationWithAnchor[]> {
  const annotations = await db.annotations
    .where('sourceId')
    .equals(sourceId)
    .filter((a) => a.deletedAt === 0)
    .sortBy('createdAt');
  const anchors = await db.anchors
    .where('annotationId')
    .anyOf(annotations.map((a) => a.id))
    .toArray();
  const anchorByAnnotation = new Map(anchors.map((a) => [a.annotationId, a]));
  return annotations.flatMap((annotation) => {
    const anchor = anchorByAnnotation.get(annotation.id);
    return anchor ? [{ annotation, anchor }] : [];
  });
}

export async function listForUrl(
  url: string,
): Promise<{ source: SourceRecord | undefined; items: AnnotationWithAnchor[] }> {
  const source = await findSourceByUrl(url);
  return { source, items: source ? await listForSource(source.id) : [] };
}

export async function setComment(id: string, comment: string): Promise<void> {
  await db.annotations.update(id, { comment, updatedAt: Date.now() });
}

/** Tombstone an annotation. The row (and its anchor) is kept for undo/history. */
export async function tombstone(id: string): Promise<void> {
  await db.annotations.update(id, { deletedAt: Date.now(), updatedAt: Date.now() });
}

export async function undelete(id: string): Promise<void> {
  await db.annotations.update(id, { deletedAt: 0, updatedAt: Date.now() });
}

export async function getAnnotation(id: string): Promise<AnnotationRecord | undefined> {
  return db.annotations.get(id);
}

export async function getLastColor(): Promise<ColorKey> {
  const record = await db.settings.get(LAST_COLOR_KEY);
  return record && typeof record.value === 'string' && record.value ? record.value : DEFAULT_COLOR;
}

const PLACEMENT_KEY = 'toolbarPlacement';
const CUSTOM_COLORS_KEY = 'customColors';

function isPlacement(value: unknown): value is ToolbarPlacement {
  return value === 'below' || value === 'above' || value === 'auto';
}

export async function getPrefs(): Promise<Prefs> {
  const [placement, colors] = await Promise.all([
    db.settings.get(PLACEMENT_KEY),
    db.settings.get(CUSTOM_COLORS_KEY),
  ]);
  return {
    placement: placement && isPlacement(placement.value) ? placement.value : 'below',
    customColors: Array.isArray(colors?.value) ? (colors.value as CustomColor[]) : [],
  };
}

export async function setPlacement(placement: ToolbarPlacement): Promise<void> {
  await db.settings.put({ key: PLACEMENT_KEY, value: placement });
}

export async function addCustomColor(color: CustomColor): Promise<void> {
  const prefs = await getPrefs();
  if (prefs.customColors.some((c) => c.key === color.key)) return;
  await db.settings.put({ key: CUSTOM_COLORS_KEY, value: [...prefs.customColors, color] });
}

export async function removeCustomColor(key: string): Promise<void> {
  const prefs = await getPrefs();
  await db.settings.put({
    key: CUSTOM_COLORS_KEY,
    value: prefs.customColors.filter((c) => c.key !== key),
  });
}
