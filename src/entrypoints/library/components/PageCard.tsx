import { highlightParts, siteLabel, type LibraryPage } from '@/domain/library';
import type { CustomColor } from '@/domain/types';
import { requestBg } from '@/messaging/protocol';
import { AnnotationRow } from './AnnotationRow';

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
      <ul className="annotations">
        {page.annotations.map((annotation) => (
          <AnnotationRow
            key={annotation.id}
            page={page}
            annotation={annotation}
            query={query}
            customColors={customColors}
          />
        ))}
      </ul>
    </article>
  );
}
