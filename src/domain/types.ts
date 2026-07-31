/** All timestamps are epoch milliseconds. */

export type BuiltinColorKey = 'yellow' | 'teal' | 'pink';

/** A builtin key or a custom color key (`c<hex>`, see domain/colors.ts). */
export type ColorKey = string;

/** A user-added highlight color, persisted in settings. */
export interface CustomColor {
  key: string;
  label: string;
  swatch: string;
  bg: string;
}

/** Append-only per-page palette state; newer events win for the same key. */
export interface PageColorEvent {
  key: ColorKey;
  enabled: boolean;
  /** Stable ordering for enabled colors. */
  addedAt: number;
  /** Conflict clock used when backup/WebDAV unions events. */
  updatedAt: number;
}

export type ToolbarPlacement = 'below' | 'above' | 'auto';

/** User preferences, persisted in settings and pushed to content scripts. */
export interface Prefs {
  placement: ToolbarPlacement;
  customColors: CustomColor[];
  /** Origins where Locus is switched off (it is on everywhere by default). */
  disabledSites: string[];
  /** Detect the page's DOI to link versions of the same paper. */
  detectDoi: boolean;
  /** Periodically check GitHub releases for a newer version (metadata only). */
  checkUpdates: boolean;
}

/** Result of the last update check, persisted in settings. */
export interface UpdateInfo {
  latestVersion: string;
  releaseUrl: string;
  checkedAt: number;
}

/** A logical document being read. */
export interface DocumentRecord {
  id: string;
  title: string;
  /** Normalized DOI when detected ('' = unknown); links versions of a paper. */
  doi: string;
  createdAt: number;
  updatedAt: number;
}

/** A concrete URL where a document lives. 1:1 with documents in this milestone. */
export interface SourceRecord {
  id: string;
  documentId: string;
  /** Normalized URL used for matching; see domain/url.ts. */
  urlKey: string;
  /** Last raw URL seen for this source. */
  url: string;
  title: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

export type AnnotationKind = 'text' | 'image';

/** One highlight (text run or image ring) with an optional Markdown note. */
export interface AnnotationRecord {
  id: string;
  documentId: string;
  sourceId: string;
  kind: AnnotationKind;
  color: ColorKey;
  /** Independent conflict clock so recolouring cannot overwrite notes/deletions. */
  colorUpdatedAt?: number;
  /** Markdown source of the note ('' = none). Rendered by lib/markdown.ts. */
  comment: string;
  /** Snapshot of the annotated text (text) or alt text (image) at creation. */
  exact: string;
  createdAt: number;
  updatedAt: number;
  /** 0 = alive; otherwise the tombstone timestamp. Rows are never removed. */
  deletedAt: number;
}

/** Effective colour clock for both v0.7 rows and legacy rows from older releases. */
export function effectiveColorUpdatedAt(
  annotation: Pick<AnnotationRecord, 'colorUpdatedAt' | 'createdAt'>,
): number {
  return annotation.colorUpdatedAt ?? annotation.createdAt;
}

/** One step in an element path: index among same-tag preceding siblings. */
export interface DomPathStep {
  tag: string;
  index: number;
}

/** A range endpoint: element path from <body>, plus which direct text-node child and character offset. */
export interface DomPoint {
  steps: DomPathStep[];
  textIndex: number;
  offset: number;
}

/** Everything needed to re-locate a text annotation (milestone item 9). */
export interface AnchorData {
  kind?: 'text';
  exact: string;
  prefix: string;
  suffix: string;
  /** Character positions into the page text (see anchor/textIndex.ts). */
  start: number;
  end: number;
  startPoint: DomPoint;
  endPoint: DomPoint;
}

/** Everything needed to re-locate an image annotation. */
export interface ImageAnchorData {
  kind: 'image';
  /** Absolute image URL at capture time. */
  src: string;
  alt: string;
  /** Index among the document's images sharing this src. */
  imgIndex: number;
  /** Element path from <body> to the <img>. */
  path: DomPathStep[];
}

export type AnchorPayload = AnchorData | ImageAnchorData;

export type AnchorRecord = AnchorPayload & {
  id: string;
  annotationId: string;
};

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface AnnotationWithAnchor {
  annotation: AnnotationRecord;
  anchor: AnchorRecord;
}

export type AnchorState = 'anchored' | 'detached';
