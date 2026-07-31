import { siteLabel, type TimelineDay } from '@/domain/library';
import type { CustomColor } from '@/domain/types';
import { AnnotationRow, Marked } from './AnnotationRow';

/** `2026-07-31` → `Friday, 31 July 2026`, or "Today" / "Yesterday". */
function dayHeading(day: string, today: string, yesterday: string): string {
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  const [year, month, date] = day.split('-').map(Number);
  const parsed = new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

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
  yesterday: string;
}) {
  return (
    <div className="timeline">
      {days.map((day) => (
        <section key={day.day} className="timeline-day" data-day={day.day}>
          <h2>{dayHeading(day.day, today, yesterday)}</h2>
          <ul className="annotations">
            {day.entries.map(({ page, annotation }) => (
              <li key={annotation.id} className="timeline-entry">
                <p className="timeline-source">
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
    </div>
  );
}
