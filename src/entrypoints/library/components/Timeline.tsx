import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildTimeMachine, siteLabel, type TimelineDay } from '@/domain/library';
import type { CustomColor } from '@/domain/types';
import { AnnotationRow, Marked } from './AnnotationRow';
import './Timeline.css';

/**
 * The timeline projection, staged like Time Machine: a rail you can travel
 * along, eras you pass on the way, and layers that recede as they get older.
 *
 * The legacy `timeline`, `timeline-day`, `timeline-entry` and
 * `page-title-inline` class names are kept exactly as they were — the library
 * E2E suite asserts on them — with the new presentation layered on through
 * `tm-` classes in Timeline.css.
 */
export function Timeline({
  days,
  query,
  customColors,
  today,
  yesterday,
}: {
  days: TimelineDay[];
  query: string;
  customColors: CustomColor[];
  today: string;
  /** Kept for call-site compatibility; relative labels are derived from `today`. */
  yesterday: string;
}) {
  void yesterday;
  const eras = useMemo(() => buildTimeMachine(days, today), [days, today]);
  const allDays = useMemo(() => eras.flatMap((era) => era.days), [eras]);
  const [activeDay, setActiveDay] = useState(allDays[0]?.day ?? '');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track which layer the reader is currently level with, so the rail shows
  // where in the history they are standing.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const layers = [...root.querySelectorAll<HTMLElement>('[data-day]')];
    if (layers.length === 0) return;
    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((record) => record.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const day = visible?.target.getAttribute('data-day');
        if (day) setActiveDay(day);
      },
      // A band near the top: the layer you have "arrived at" is the one just
      // under the sticky header, not whatever happens to fill the viewport.
      { rootMargin: '-88px 0px -55% 0px', threshold: 0 },
    );
    for (const layer of layers) observer.observe(layer);
    return () => observer.disconnect();
  }, [allDays]);

  const travelTo = useCallback((day: string) => {
    const target = scrollRef.current?.querySelector<HTMLElement>(`[data-day="${day}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveDay(day);
  }, []);

  if (allDays.length === 0) return null;

  const totalMarks = allDays.reduce((sum, day) => sum + day.count, 0);
  const oldest = allDays[allDays.length - 1];

  return (
    <div className="timeline tm-root" ref={scrollRef}>
      <div className="tm-stage">
        {eras.map((era) => (
          <section key={era.key} className="tm-era">
            <header className="tm-era-head">
              <span className="tm-era-label">{era.label}</span>
              <span className="tm-era-count">
                {era.count} mark{era.count === 1 ? '' : 's'}
              </span>
            </header>

            {era.days.map((day) => (
              <section
                key={day.day}
                className="timeline-day tm-layer"
                data-day={day.day}
                data-active={day.day === activeDay ? 'true' : undefined}
                // Depth drives how far the layer sits back; clamped in CSS so
                // a long history never fades into unreadability.
                style={{ '--tm-depth': day.depth } as React.CSSProperties}
              >
                <h2 className="tm-day-label">
                  <span className="tm-node" aria-hidden="true" />
                  <span className="tm-when">{day.label}</span>
                  <span className="tm-date">{day.fullDate}</span>
                  <span className="tm-count">
                    {day.count} mark{day.count === 1 ? '' : 's'}
                  </span>
                </h2>

                <ul className="annotations tm-cards">
                  {day.entries.map(({ page, annotation }) => (
                    <li key={annotation.id} className="timeline-entry tm-entry">
                      <p className="timeline-source tm-source">
                        <span className="site">{siteLabel(page.origin)}</span>
                        <span className="page-title-inline">
                          <Marked text={page.title} query={query} />
                        </span>
                      </p>
                      <ul className="annotations">
                        <AnnotationRow
                          page={page}
                          annotation={annotation}
                          query={query}
                          customColors={customColors}
                        />
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </section>
        ))}

        <p className="tm-horizon">
          <span>{totalMarks} marks</span>
          <span>·</span>
          <span>back to {oldest?.fullDate}</span>
        </p>
      </div>

      {/* The rail: one tick per day, taller where an era begins. */}
      <nav className="tm-rail" aria-label="Timeline">
        {eras.map((era) => (
          <div key={era.key} className="tm-rail-era">
            <span className="tm-rail-era-label">{era.label}</span>
            {era.days.map((day) => (
              <button
                key={day.day}
                type="button"
                className="tm-tick"
                data-tick={day.day}
                data-active={day.day === activeDay ? 'true' : undefined}
                aria-current={day.day === activeDay ? 'true' : undefined}
                title={`${day.label} · ${day.fullDate} · ${day.count} mark${day.count === 1 ? '' : 's'}`}
                onClick={() => travelTo(day.day)}
              >
                <span
                  className="tm-tick-bar"
                  // Longer bar for a busier day, capped so one heavy day does
                  // not squash the rest of the rail.
                  style={{ '--tm-weight': Math.min(day.count, 6) } as React.CSSProperties}
                />
                {/* A persistent day number turns the rail into a ruler; the
                    wordier label stays in the tooltip so the column keeps its
                    width and nothing shifts on hover. */}
                <span className="tm-tick-day">{Number(day.day.slice(-2))}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}
