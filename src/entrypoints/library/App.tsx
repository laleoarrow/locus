import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { loadLibrary } from '@/db/library';
import { getLibraryMode, getPrefs } from '@/db/repo';
import { buildPaletteForKeys, specFor } from '@/domain/colors';
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
import { effectiveColorUpdatedAt, type ColorKey } from '@/domain/types';
import { requestBg } from '@/messaging/protocol';
import { BulkColorActions } from './components/BulkColorActions';
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
  const mode = useLiveQuery(() => getLibraryMode(), []) ?? 'page';
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');

  const customColors = prefs?.customColors ?? [];
  const allPages = useMemo(() => (input ? buildLibrary(input) : []), [input]);
  const collectionPages = useMemo(
    () =>
      filterLibrary(allPages, {
        ...EMPTY_FILTERS,
        deletedOnly: filters.deletedOnly,
      }),
    [allPages, filters.deletedOnly],
  );
  const usedColors = useMemo(
    () => [
      ...new Set(collectionPages.flatMap((page) => page.annotations.map((entry) => entry.color))),
    ],
    [collectionPages],
  );
  const palette = useMemo(
    () =>
      buildPaletteForKeys(usedColors, customColors).filter((entry) =>
        usedColors.includes(entry.key),
      ),
    [customColors, usedColors],
  );
  const liveColorCounts = useMemo(() => {
    const counts = new Map<ColorKey, number>();
    for (const annotation of input?.annotations ?? []) {
      if (annotation.deletedAt !== 0) continue;
      counts.set(annotation.color, (counts.get(annotation.color) ?? 0) + 1);
    }
    return counts;
  }, [input]);
  const bulkPalette = useMemo(
    () => buildPaletteForKeys([...liveColorCounts.keys()], customColors),
    [customColors, liveColorCounts],
  );
  const origins = useMemo(() => availableOrigins(collectionPages), [collectionPages]);
  const pages = useMemo(() => filterLibrary(allPages, filters), [allPages, filters]);
  const availableColorKeys = useMemo(() => new Set(usedColors), [usedColors]);
  const availableOriginKeys = useMemo(
    () => new Set(origins.map((origin) => origin.origin)),
    [origins],
  );

  useEffect(() => {
    setFilters((current) => {
      const nextColors = current.colors.filter((color) => availableColorKeys.has(color));
      const nextOrigins = current.origins.filter((origin) => availableOriginKeys.has(origin));
      return nextColors.length === current.colors.length &&
        nextOrigins.length === current.origins.length
        ? current
        : { ...current, colors: nextColors, origins: nextOrigins };
    });
  }, [availableColorKeys, availableOriginKeys]);

  const libraryTotal = countAnnotations(allPages);
  const total = countAnnotations(collectionPages);
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
  const replaceColors = async (
    sourceColor: ColorKey,
    targetColor: ColorKey,
    expectedCount: number,
  ) => {
    const sourceWasFiltered = filters.colors.includes(sourceColor);
    const wasDeletedView = filters.deletedOnly;
    const expectedAnnotations = (input?.annotations ?? [])
      .filter((annotation) => annotation.deletedAt === 0 && annotation.color === sourceColor)
      .map((annotation) => ({
        id: annotation.id,
        updatedAt: annotation.updatedAt,
        colorUpdatedAt: effectiveColorUpdatedAt(annotation),
      }));
    const result = await requestBg({
      type: 'annotations:replace-color',
      sourceColor,
      targetColor,
      expectedCount,
      expectedAnnotations,
    });
    if (!result) {
      throw new Error('Locus was updated in the background. Reload the extension and try again.');
    }
    if (result.error) throw new Error(result.error);
    if (result.updated > 0 && sourceWasFiltered && !wasDeletedView) {
      setFilters((current) => {
        const colors = current.colors.filter((color) => color !== sourceColor);
        if (!colors.includes(targetColor)) colors.push(targetColor);
        return { ...current, colors };
      });
    }
    return result.updated;
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
                onClick={() => void requestBg({ type: 'library:set-mode', mode: entry.key })}
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
                aria-label={`Filter ${entry.label} annotations`}
                aria-pressed={filters.colors.includes(entry.key)}
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
          <BulkColorActions
            palette={bulkPalette}
            counts={liveColorCounts}
            preferredSource={filters.colors.length === 1 ? filters.colors[0] : undefined}
            onReplace={replaceColors}
          />
        </div>
      </header>

      <main className="library-body" data-layout={mode}>
        {input === undefined ? null : libraryTotal === 0 ? (
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
