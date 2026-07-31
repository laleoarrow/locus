import { useState } from 'react';
import type { LibrarySite } from '@/domain/library';
import type { CustomColor } from '@/domain/types';
import { PageCard } from './PageCard';

export function SiteGroup({
  site,
  query,
  customColors,
}: {
  site: LibrarySite;
  query: string;
  customColors: CustomColor[];
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="site-group" data-origin={site.origin}>
      <button className="site-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`chevron${open ? ' open' : ''}`} aria-hidden="true">
          ›
        </span>
        <span className="site-name">{site.label}</span>
        <span className="site-count">
          {site.pages.length} page{site.pages.length === 1 ? '' : 's'} · {site.annotationCount}
        </span>
      </button>
      {open && (
        <div className="site-pages">
          {site.pages.map((page) => (
            <PageCard
              key={page.sourceId}
              page={page}
              query={query}
              customColors={customColors}
              showSite={false}
            />
          ))}
        </div>
      )}
    </section>
  );
}
