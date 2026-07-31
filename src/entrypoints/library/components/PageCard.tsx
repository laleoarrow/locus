import { useEffect, useId, useMemo, useState } from 'react';
import { highlightParts, siteLabel, type LibraryPage } from '@/domain/library';
import type { CustomColor } from '@/domain/types';
import { requestBg } from '@/messaging/protocol';
import { AnnotationRow } from './AnnotationRow';

const COMPACT_ANNOTATION_LIMIT = 5;

export function PageCard({
  page,
  query,
  customColors,
  showSite = true,
}: {
  page: LibraryPage;
  query: string;
  customColors: CustomColor[];
  showSite?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const annotationListId = useId();
  const annotationSetKey = useMemo(
    () => page.annotations.map((annotation) => annotation.id).join('\u0000'),
    [page.annotations],
  );
  useEffect(() => setExpanded(false), [annotationSetKey]);
  const hiddenCount = Math.max(0, page.annotations.length - COMPACT_ANNOTATION_LIMIT);
  const visibleAnnotations = expanded
    ? page.annotations
    : page.annotations.slice(0, COMPACT_ANNOTATION_LIMIT);
  const openPage = () =>
    void requestBg({
      type: 'library:reveal',
      url: page.url,
      annotationId: page.annotations[0]?.id ?? '',
    });

  return (
    <article className="page-card" data-source-id={page.sourceId}>
      <header>
        <h2>
          <button className="page-title" onClick={openPage} title={page.url}>
            {highlightParts(page.title, query).map((part, index) =>
              part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
            )}
          </button>
        </h2>
        <p className="page-meta">
          {showSite && <span className="site">{siteLabel(page.origin)}</span>}
          <span className="count">
            {page.annotations.length} annotation{page.annotations.length === 1 ? '' : 's'}
          </span>
          {page.doi && <span className="doi">{page.doi}</span>}
        </p>
      </header>
      <ul className="annotations" id={annotationListId}>
        {visibleAnnotations.map((annotation) => (
          <AnnotationRow
            key={annotation.id}
            page={page}
            annotation={annotation}
            query={query}
            customColors={customColors}
          />
        ))}
        {hiddenCount > 0 && (
          <li className="annotation-overflow" data-hidden-count={hiddenCount}>
            <button
              type="button"
              data-action="toggle-annotations"
              aria-expanded={expanded}
              aria-controls={annotationListId}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded
                ? 'Show less'
                : `… ${hiddenCount} more annotation${hiddenCount === 1 ? '' : 's'}`}
            </button>
          </li>
        )}
      </ul>
    </article>
  );
}
