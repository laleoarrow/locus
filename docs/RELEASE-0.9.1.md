# Locus / 文迹 0.9.1

## A quieter connection panel

- Connection status keeps the essentials visible: current state, last check, last successful sync, upload bytes and actions.
- Explanations move into structured hints on the relevant labels. Hover or focus a label to read them; Escape dismisses the hint.
- Connection errors and quota pauses stay visible so required actions are easy to find.

Includes the efficient page-level sync from 0.9.0: no uploads when unchanged, only changed pages plus a small index when edited, and automatic retry pauses when upload quota is exhausted. All devices sharing a sync folder must run 0.9.0 or later.

## Validation

TypeScript checks, 257 unit tests and 66 browser cases passed. The status cases additionally verify hover and keyboard access, Escape dismissal, narrow-window containment, dynamic layout changes and no network requests caused by reading hints. Chrome/Edge packages and the production store package were verified.
