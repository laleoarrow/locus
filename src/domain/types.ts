/** All timestamps are epoch milliseconds. */

export type ColorKey = 'yellow' | 'green' | 'blue' | 'pink' | 'orange';

/** A logical document being read. */
export interface DocumentRecord {
  id: string;
  title: string;
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

/** One highlight with an optional plain-text comment. */
export interface AnnotationRecord {
  id: string;
  documentId: string;
  sourceId: string;
  color: ColorKey;
  comment: string;
  /** Snapshot of the annotated text at creation time. */
  exact: string;
  createdAt: number;
  updatedAt: number;
  /** 0 = alive; otherwise the tombstone timestamp. Rows are never removed. */
  deletedAt: number;
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

/** Everything needed to re-locate an annotation (milestone item 9). */
export interface AnchorData {
  exact: string;
  prefix: string;
  suffix: string;
  /** Character positions into the page text (see anchor/textIndex.ts). */
  start: number;
  end: number;
  startPoint: DomPoint;
  endPoint: DomPoint;
}

export interface AnchorRecord extends AnchorData {
  id: string;
  annotationId: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface AnnotationWithAnchor {
  annotation: AnnotationRecord;
  anchor: AnchorRecord;
}

export type AnchorState = 'anchored' | 'detached';
