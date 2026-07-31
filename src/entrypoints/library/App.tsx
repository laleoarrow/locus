import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { loadLibrary } from '@/db/library';
import { getPrefs } from '@/db/repo';
import { buildPalette, specFor } from '@/domain/colors';
import {
  availableOrigins,
  buildLibrary,
  countAnnotations,
  dayKey,
  EMPTY_FILTERS,
  filterLibrary,
  groupBySite,
  toTimeline,
  type GroupMode,
  type LibraryFilters,
} from '@/domain/library';
import type { ColorKey } from '@/domain/types';
import { PageCard } from './components/PageCard';
import { SiteGroup } from './components/SiteGroup';
import { Timeline } from './components/Timeline';

const MODES: { key: GroupMode; label: string }[] = [
  { key: 'page', label: 'By page' },
  { key: 'site', label: 'By site' },
  { key: 'timeline', label: 'Timeline' },
];

/** Local ISO date input value (`YYYY-MM-DD`) → epoch ms at start/end of day. */
function dateToStart(value: string): number | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
}
function dateToEnd(value: string): number | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999).getTime();
}

export function App() {
  // liveQuery keeps the page current when a sync pull, a backup import or an
  // edit in the side panel changes the database.
  const input = useLiveQuery(() => loadLibrary(), []);
  const prefs = useLiveQuery(() => getPrefs(), []);
  const [mode, setMode] = useState<GroupMode>('page');
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');

  const customColors = prefs?.customColors ?? [];
  const palette = useMemo(() => buildPalette(customColors), [customColors]);

  const allPages = useMemo(() => (input ? buildLibrary(input) : []), [input]);
  const pages = useMemo(() => filterLibrary(allPages, filters), [allPages, filters]);
  const origins = useMemo(() => availableOrigins(allPages), [allPages]);

  const total = countAnnotations(allPages);
  const shown = countAnnotations(pages);

  const patch = (next: Partial<LibraryFilters>) => setFilters((prev) => ({ ...prev, ...next }));
  const toggleColor = (color: ColorKey) =>
    patch({
      colors: filters.colors.includes(color)
        ? filters.colors.filter((c) => c !== color)
        : [...filters.colors, color],
    });
  const toggleOrigin = (origin: string) =>
    patch({
      origins: filters.origins.includes(origin)
        ? filters.origins.filter((o) => o !== origin)
        : [...filters.origins, origin],
    });
  const reset = () => {
    setFilters(EMPTY_FILTERS);
    setFromText('');
    setToText('');
  };

  const filtersActive =
    filters.query !== '' ||
    filters.colors.length > 0 ||
    filters.origins.length > 0 ||
    filters.from !== null ||
    filters.to !== null ||
    filters.deletedOnly ||
    filters.detachedOnly;

  const now = Date.now();
  const today = dayKey(now);
  const yesterday = dayKey(now - 86_400_000);

  return (
    <div className="library">
      <header className="library-header">
        <div className="title-row">
          <h1>Locus · 文迹</h1>
          <span className="subtitle">
            {input === undefined
              ? 'Loading…'
              : `${shown} of ${total} annotation${total === 1 ? '' : 's'}`}
          </span>
        </div>

        <div className="controls">
          <input
            className="search"
            type="search"
            data-library="search"
            placeholder="Search quotes, notes and titles…"
            value={filters.query}
            onChange={(event) => patch({ query: event.target.value })}
          />
          <div className="segmented" role="group" aria-label="Grouping">
            {MODES.map((entry) => (
              <button
                key={entry.key}
                data-mode={entry.key}
                aria-pressed={mode === entry.key}
                onClick={() => setMode(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filters">
          <div className="chips" role="group" aria-label="Colours">
            {palette.map((entry) => (
              <button
                key={entry.key}
                className={`chip color-chip${filters.colors.includes(entry.key) ? ' on' : ''}`}
                data-filter-color={entry.key}
                title={entry.label}
                onClick={() => toggleColor(entry.key)}
              >
                <span style={{ background: specFor(entry.key, customColors).swatch }} />
              </button>
            ))}
          </div>

          {origins.length > 1 && (
            <div className="chips" role="group" aria-label="Sites">
              {origins.map((origin) => (
                <button
                  key={origin.origin || 'unknown'}
                  className={`chip${filters.origins.includes(origin.origin) ? ' on' : ''}`}
                  data-filter-origin={origin.origin}
                  onClick={() => toggleOrigin(origin.origin)}
                >
                  {origin.label} <em>{origin.count}</em>
                </button>
              ))}
            </div>
          )}

          <label className="date">
            From
            <input
              type="date"
              data-filter="from"
              value={fromText}
              onChange={(event) => {
                setFromText(event.target.value);
                patch({ from: dateToStart(event.target.value) });
              }}
            />
          </label>
          <label className="date">
            To
            <input
              type="date"
              data-filter="to"
              value={toText}
              onChange={(event) => {
                setToText(event.target.value);
                patch({ to: dateToEnd(event.target.value) });
              }}
            />
          </label>

          <button
            className={`chip${filters.detachedOnly ? ' on' : ''}`}
            data-filter="detached"
            onClick={() => patch({ detachedOnly: !filters.detachedOnly })}
          >
            Detached
          </button>
          <button
            className={`chip${filters.deletedOnly ? ' on' : ''}`}
            data-filter="deleted"
            onClick={() => patch({ deletedOnly: !filters.deletedOnly })}
          >
            Deleted
          </button>

          {filtersActive && (
            <button className="chip clear" data-filter="clear" onClick={reset}>
              Clear
            </button>
          )}
        </div>
      </header>

      <main className="library-body">
        {input === undefined ? null : total === 0 ? (
          <div className="empty">
            <h2>No annotations yet</h2>
            <p>Highlight something while you read and it will show up here.</p>
          </div>
        ) : pages.length === 0 ? (
          <div className="empty" data-empty="filtered">
            <h2>{filters.deletedOnly ? 'Nothing deleted' : 'Nothing matches'}</h2>
            <p>
              {filters.deletedOnly
                ? 'Deleted annotations appear here so you can restore them.'
                : 'Try a different search or clear the filters.'}
            </p>
          </div>
        ) : mode === 'site' ? (
          groupBySite(pages).map((site) => (
            <SiteGroup
              key={site.origin || 'unknown'}
              site={site}
              query={filters.query}
              customColors={customColors}
            />
          ))
        ) : mode === 'timeline' ? (
          <Timeline
            days={toTimeline(pages)}
            query={filters.query}
            customColors={customColors}
            today={today}
            yesterday={yesterday}
          />
        ) : (
          pages.map((page) => (
            <PageCard
              key={page.sourceId}
              page={page}
              query={filters.query}
              customColors={customColors}
            />
          ))
        )}
      </main>
    </div>
  );
}
