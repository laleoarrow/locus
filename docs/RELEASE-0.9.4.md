# Locus / 文迹 0.9.4

## Select cards directly

- Page cards show a checkbox beside the title. Check multiple cards to reveal the batch actions without opening a menu first.
- Selected and partially selected cards have a visible state. Card selection includes collapsed annotations within the current filter.
- A direct **批量选择** entry is also available above the library. Select all current results, clear the selection or finish selecting from the action bar.
- Batch buttons organize the selected pages' main content, change colors, append or replace notes, and delete or restore selected annotations. Existing previews and draft review remain in place.
- Filtering removes hidden annotations from the selection, and changing grouping keeps the current selection. Compact layouts remain scrollable when an edit form is open.

Includes the concise summaries and scheduled cloud sync from earlier releases. Update the existing extension in place to retain your notes and settings.

## Validation

- Typecheck, 287 unit tests and all 72 browser tests passed.
- Verified direct card selection, partial states, filtered select-all, collapsed annotations, keyboard controls, compact layouts and selected-page AI scope.
- Chrome and Edge production archives have identical contents; the keyless Edge store build passed verification.
- Reloaded the existing fixed-ID Edge installation in place and verified the visible actions with all 30 live annotations retained.
