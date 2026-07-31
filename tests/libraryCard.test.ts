import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  filterLibrary,
  type LibraryAnnotation,
  type LibraryPage,
} from '@/domain/library';
import { PageCard } from '@/entrypoints/library/components/PageCard';

function annotation(index: number): LibraryAnnotation {
  return {
    id: `annotation-${index}`,
    sourceId: 'source',
    documentId: 'document',
    color: 'yellow',
    quote: `quote ${index}`,
    note: '',
    isImage: false,
    imageSrc: '',
    createdAt: index,
    updatedAt: index,
    deleted: false,
    detached: false,
  };
}

function pageWith(count: number): LibraryPage {
  return {
    sourceId: 'source',
    documentId: 'document',
    url: 'https://example.test/article',
    urlKey: 'https://example.test/article',
    title: 'Compact card',
    origin: 'https://example.test',
    doi: '',
    annotations: Array.from({ length: count }, (_, index) => annotation(index + 1)),
    lastActivityAt: count,
  };
}

function renderCard(page: LibraryPage, query = ''): void {
  document.body.innerHTML = renderToStaticMarkup(
    createElement(PageCard, { page, query, customColors: [] }),
  );
}

describe('PageCard compact annotation list', () => {
  it('shows the first five annotations while preserving the complete count', () => {
    renderCard(pageWith(6));

    expect(
      [...document.querySelectorAll<HTMLElement>('.annotation')].map(
        (row) => row.dataset.annotationId,
      ),
    ).toEqual([
      'annotation-1',
      'annotation-2',
      'annotation-3',
      'annotation-4',
      'annotation-5',
    ]);
    expect(document.querySelector('.count')?.textContent).toContain('6 annotations');
    expect(document.querySelector('.annotation-overflow')?.textContent).toContain('…');
    expect(
      document.querySelector<HTMLElement>('.annotation-overflow')?.dataset.hiddenCount,
    ).toBe('1');
  });

  it('does not render an overflow control for exactly five annotations', () => {
    renderCard(pageWith(5));

    expect(document.querySelectorAll('.annotation')).toHaveLength(5);
    expect(document.querySelector('.annotation-overflow')).toBeNull();
  });

  it('filters the complete page before applying the five-row display limit', () => {
    const page = pageWith(6);
    page.annotations[5]!.quote = 'sixth-hit';
    const [filtered] = filterLibrary([page], {
      ...EMPTY_FILTERS,
      query: 'sixth-hit',
    });

    expect(filtered).toBeDefined();
    renderCard(filtered!, 'sixth-hit');

    expect(document.querySelectorAll('.annotation')).toHaveLength(1);
    expect(document.querySelector('.annotation')?.textContent).toContain('sixth-hit');
    expect(document.querySelector('.annotation-overflow')).toBeNull();
  });
});
