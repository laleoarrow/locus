# Locus / 文迹 0.9.2

## Sync on your schedule

- Choose hourly, daily, weekly or manual-only sync in the Library or side panel. The default is daily, including upgrades from the old five-minute setting.
- Editing notes and saving settings no longer trigger an immediate upload. Reopening the browser preserves the schedule; an overdue check runs once when the browser resumes. The connection panel shows the next scheduled sync.
- A separate **全量同步** action checks the complete library against the cloud. It uploads only changed pages and the small index; identical content is not uploaded again.
- Quota failures continue to pause automatic uploads until a successful manual retry.

## Status without clutter

Connection explanations now appear as structured hints on the corresponding labels. Hover or focus a label to read them, and press Escape to dismiss the hint. Errors and quota pauses remain visible. Hints stay inside the viewport and follow layout changes.

Includes the efficient page-level sync from 0.9.0. All devices sharing a sync folder must run 0.9.0 or later. Update the existing extension in place to retain annotations and settings.

## Validation

TypeScript checks, 275 unit tests and all 68 browser cases passed. Tests cover saved schedule choices, no immediate upload after edits or configuration saves, due alarms and restart persistence, quota pauses, concurrent edits, complete manual reads with zero unchanged uploads, and accessible structured hints. Chrome/Edge packages and the production Edge store package were verified.
