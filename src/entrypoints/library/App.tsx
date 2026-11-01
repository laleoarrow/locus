import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationEditAction, AnnotationEditExpectation } from '@/domain/editing';
import type { LLMConfigView } from '@/domain/llm';
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
import { BulkEditActions } from './components/BulkEditActions';
import { SelectionProvider } from './components/SelectionContext';
import { NoteDraftProvider } from './components/NoteDraftContext';
import { LLMSettings } from './components/LLMSettings';
import { ConnectionStatus } from './components/ConnectionStatus';
import { SummaryActions } from './components/PageSummary';
import { SummaryReview, type SummaryReviewEntry } from './components/SummaryReview';
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
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LLMConfigView | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [review, setReview] = useState<SummaryReviewEntry[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [summarySaving, setSummarySaving] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const generationRun = useRef(0);
  const busy = bulkBusy || generating || summarySaving;
  useEffect(() => {
    return () => { generationRun.current++; };
  }, []);

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
  const sites = useMemo(() => mode === 'site' ? groupBySite(pages) : [], [pages, mode]);
  const timeline = useMemo(() => mode === 'timeline' ? toTimeline(pages) : [], [pages, mode]);
  const visibleIds = useMemo(() => new Set(pages.flatMap((page) => page.annotations.map((entry) => entry.id))), [pages]);
  useEffect(() => {
    setSelectedIds((current) => {
      const remaining = new Set([...current].filter((id) => visibleIds.has(id)));
      return remaining.size === current.size ? current : remaining;
    });
  }, [visibleIds]);
  const visibleSelectedIds = useMemo(() => new Set([...selectedIds].filter((id) => visibleIds.has(id))), [selectedIds, visibleIds]);
  const selectedAnnotations = useMemo(() => (input?.annotations ?? [])
    .filter((row) => visibleSelectedIds.has(row.id))
    .map((row) => ({ id: row.id, updatedAt: row.updatedAt, deletedAt: row.deletedAt, colorUpdatedAt: effectiveColorUpdatedAt(row) })),
  [input, visibleSelectedIds]);
  const selectedPageIds = useMemo(() => pages.filter((page) => page.annotations.some((entry) => visibleSelectedIds.has(entry.id)))
    .map((page) => page.sourceId), [pages, visibleSelectedIds]);
  const toggleMany = (ids: string[]) => {
    if (busy || ids.length === 0) return;
    setSelecting(true);
    setSelectedIds((current) => {
      const next = new Set(current);
      const remove = ids.every((id) => current.has(id));
      for (const id of ids) if (visibleIds.has(id)) { if (remove) next.delete(id); else next.add(id); }
      return next;
    });
  };
  const applySelected = async (action: AnnotationEditAction, expected: AnnotationEditExpectation[]): Promise<number> => {
    setBulkBusy(true);
    try {
      const result = await requestBg({ type: 'annotations:edit', expected, action });
      if (!result || result.error) throw new Error(result?.error ?? 'Could not edit selected annotations.');
      setSelectedIds(new Set());
      return result.updated;
    } finally { setBulkBusy(false); }
  };
  const generate = async (sourceIds: string[]) => {
    if (!llmConfig?.enabled) { setSettingsOpen(true); return; }
    const targets = [...new Set(sourceIds)].map((sourceId) => ({
      sourceId, title: allPages.find((page) => page.sourceId === sourceId)?.title ?? 'Page', pending: true,
    }));
    if (targets.length === 0) return;
    const run = ++generationRun.current;
    setReview(targets); setGenerating(true); setSummaryError('');
    for (const target of targets) {
      if (generationRun.current !== run) return;
      try {
        const result = await requestBg({ type: 'llm:generate', sourceId: target.sourceId });
        if (generationRun.current !== run) return;
        setReview((current) => current?.map((entry) => entry.sourceId === target.sourceId
          ? { ...entry, pending: false, draft: result?.draft, error: result?.error ?? (!result?.draft ? 'Generation failed.' : undefined) } : entry) ?? null);
      } catch {
        if (generationRun.current !== run) return;
        setReview((current) => current?.map((entry) => entry.sourceId === target.sourceId
          ? { ...entry, pending: false, error: 'The request was interrupted. Try again.' } : entry) ?? null);
      }
    }
    if (generationRun.current === run) setGenerating(false);
  };
  const closeReview = () => { generationRun.current++; setGenerating(false); setReview(null); };
  const saveSummaries = async () => {
    const changes = (review ?? []).flatMap((entry) => entry.draft ? [entry.draft] : []);
    setSummarySaving(true); setSummaryError('');
    try {
      const result = await requestBg({ type: 'summary:save', changes });
      if (!result || result.error) throw new Error(result?.error ?? 'Could not save main content.');
      closeReview();
    } catch (reason) { setSummaryError(reason instanceof Error ? reason.message : 'Could not save main content.'); }
    finally { setSummarySaving(false); }
  };
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

  const libraryTotal = useMemo(() => countAnnotations(allPages), [allPages]);
  const total = useMemo(() => countAnnotations(collectionPages), [collectionPages]);
  const shown = useMemo(() => countAnnotations(pages), [pages]);

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
    <NoteDraftProvider>
    <SelectionProvider value={{ selectedIds: visibleSelectedIds, enabled: selecting, busy, toggle: (id) => toggleMany([id]), toggleMany }}>
    <SummaryActions.Provider value={{ enabled: llmConfig?.enabled ?? false, busy, generate: (ids) => void generate(ids), configure: () => setSettingsOpen(true) }}>
    <div className="library">
      <header className="library-header">
        <div className="title-row">
          <h1>Locus · 文迹</h1>
          <span className="subtitle">
            {input === undefined
              ? 'Loading…'
              : `${shown} of ${total} annotation${total === 1 ? '' : 's'}`}
          </span>
          <ConnectionStatus disabled={busy} onLLMConfig={setLlmConfig} onLLMSettings={() => setSettingsOpen(true)} />
        </div>

        <div className="controls" inert={bulkBusy}>
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
          <button type="button" className="chip selection-start" data-selection="start"
            disabled={busy || selecting || shown === 0} aria-controls={selecting ? 'selection-actions' : undefined}
            onClick={() => setSelecting(true)}>批量选择</button>
        </div>

        <div className="filters" inert={bulkBusy}>
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
            onSelect={() => setSelecting(true)}
            palette={bulkPalette}
            counts={liveColorCounts}
            preferredSource={filters.colors.length === 1 ? filters.colors[0] : undefined}
            onReplace={replaceColors}
          />
        </div>
        {selecting && <BulkEditActions count={visibleSelectedIds.size} pageCount={selectedPageIds.length} selected={selectedAnnotations}
          palette={bulkPalette} deletedOnly={filters.deletedOnly} busy={busy}
          onSelectAll={() => setSelectedIds(new Set(visibleIds))} onClear={() => setSelectedIds(new Set())}
          onExit={() => { setSelecting(false); setSelectedIds(new Set()); }}
          onApply={applySelected} onSummarize={() => void generate(selectedPageIds)} />}
      </header>

      <main className="library-body" data-layout={mode} inert={bulkBusy}>
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
          sites.map((site) => (
            <SiteGroup
              key={site.origin || 'unknown'}
              site={site}
              query={filters.query}
              customColors={customColors}
            />
          ))
        ) : mode === 'timeline' ? (
          <Timeline
            days={timeline}
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
      {settingsOpen && llmConfig && <LLMSettings config={llmConfig} onSaved={setLlmConfig} onClose={() => setSettingsOpen(false)} />}
      {review && <SummaryReview entries={review} generating={generating} saving={summarySaving} error={summaryError}
        onClose={closeReview} onSave={() => void saveSummaries()}
        onChange={(sourceId, content) => setReview((current) => current?.map((entry) => entry.sourceId === sourceId && entry.draft
          ? { ...entry, draft: { ...entry.draft, content } } : entry) ?? null)} />}
    </div>
    </SummaryActions.Provider>
    </SelectionProvider>
    </NoteDraftProvider>
  );
}
