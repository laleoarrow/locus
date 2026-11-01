# Locus / 文迹 0.9.6

## Keep the toolbar near selected text

- Auto placement no longer treats the content container you are selecting inside, or its ordinary text, as a competing floating toolbar.
- Independent floating controls within that container still participate in collision avoidance.
- When the usual positions are blocked, Auto searches near the selection rather than moving to a distant clear part of the page. If no nearby clear space exists, it keeps the selection usable and minimizes overlap locally.
- Explicit Above/Below preferences are unchanged.

Includes the right-side card checkboxes and blank-area selection from 0.9.5. Update the existing extension in place to retain notes and settings.

## Validation

- Typecheck and all 298 unit tests passed.
- Both new browser regressions reproduced the distant-placement bug on 0.9.5 and passed on this build.
- All 76 browser cases verified. One existing text-drag test needed its scroll and measurement to be atomic during a live list refresh; it then passed three consecutive runs without changing production behavior.
- Verified production Chrome/Edge archives and the keyless Edge store package.
