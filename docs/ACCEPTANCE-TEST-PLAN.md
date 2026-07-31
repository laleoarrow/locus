# Locus — Acceptance Test Plan

Scope: milestone 1 (HTML annotation, local persistence, side panel).
Layers: unit (Vitest, jsdom + fake-indexeddb) and extension e2e
(Playwright, real Chromium with the `--mode e2e` build and the same HTTP(S)
host permission as production; tests stay on localhost fixtures while still
exercising the dynamic registration and per-site disable paths).

## Unit (Vitest)

| ID | Area | Assertion |
|----|------|-----------|
| U1 | url | `urlKey` drops fragments, tracking params, default ports; keeps meaningful query |
| U2 | textIndex | page text concatenation skips script/style/locus host; range↔offset round-trips |
| U3 | capture | anchor from a Range stores exact/prefix/suffix/positions/DOM paths |
| U4 | resolve/path | unchanged DOM re-anchors via DOM path (strategy 1) |
| U5 | resolve/position | attribute/structure churn falls through to position match (strategy 2) |
| U6 | resolve/quote | inserted content shifts positions; context quote search picks the right one of several identical strings (strategy 3) |
| U7 | resolve/detached | removed text yields `null` (detached), never a wrong match |
| U8 | repo | create writes annotation+anchor atomically; list filters tombstones |
| U9 | repo | delete sets `deletedAt`; undelete restores; rows are never removed |
| U10 | repo | last-used color persists in settings |
| U11 | repo | image annotations store `kind: image` with alt text as `exact` |
| U12 | markdown | renderer covers headings/lists/quotes/code/links; escapes raw HTML; rejects non-http(s) URLs |
| U13 | image anchor | capture stores src/alt/index/path; resolves via path, falls back to src+index, detaches when gone |
| U14 | palette | custom colors build from hex, order after builtins, canonical `c<rrggbb>` keys recover their color without a catalog entry, invalid keys fall back to yellow |
| U15 | prefs | placement, custom colors, disabled sites, and toggles persist; adds dedupe |
| U16 | doi | normalize/extract DOIs from citation meta and URL paths (ovid-style tilde suffixes, case folding) |
| U17 | version | dotted version comparison for the update check |
| U18 | doi/repo | recordDoi + findAltVersion return the annotated sibling version only |
| U19 | backup/parse | v0.7 exports format v2 while still reading legacy v1; older clients reject v2 instead of overwriting colour-clock data; foreign/newer formats are rejected, malformed rows dropped and volatile settings stripped |
| U20 | backup/round trip | export→wipe→import restores annotations, anchors and notes; importing twice adds nothing |
| U21 | backup/tombstones | an older backup never resurrects a deleted annotation; a newer deletion propagates |
| U22 | backup/merge | another machine's rows attach to the local page by urlKey (one document, no duplicates); unseen pages are added; DOI backfilled; list prefs unioned |
| U23 | sync/config | collection URL normalization (trailing slash, query/fragment stripped, non-http rejected); completeness check |
| U24 | sync/auth | Basic auth survives non-ASCII credentials; HTTP statuses map to actionable messages |
| U25 | placement | toolbar box centres on the selection and clamps to viewport edges on both sides |
| U26 | placement | auto picks the clear side, the less-obstructed side when both collide, ignores non-overlapping obstacles, and respects an explicit preference |
| U27 | library/url | origin extraction, opaque (`about:`) origins treated as unknown, host labels |
| U28 | library/build | annotations grouped under their page with title/DOI/origin/image/detached carried; anchorless rows and empty pages dropped; empty library safe |
| U29 | library/filter | tombstones hidden by default and shown alone in the bin; search over quote, note and title; colour, origin, detached and date filters; combinations drop emptied pages |
| U30 | library/site | pages collapsed per origin with counts, newest first; distinct origins listed for the filter bar |
| U31 | library/timeline | newest-first stream split into local calendar days |
| U32 | library/search | text split around every case-insensitive match; repeats, misses and empty needles |
| U33 | library/db | one pass returns every table the view model needs, including recorded detached state |
| U34 | library/db | anchor state is written only when it actually changes; empty reports ignored |
| U35 | library/db | anchor state never appears in an exported backup and survives an import |
| U36 | library/prefs | grouping mode defaults safely, persists across Library tabs and rejects an invalid stored value |
| U37 | selection overlap | partial/contained/exact DOM Range overlaps match; disjoint, boundary-only and collapsed ranges do not, including nested text nodes |
| U38 | page colors | additions/removals are isolated by normalized page URL; legacy pages infer at most two custom choices; append-only removal events survive backup union without resurrection |
| U39 | library/timeline | day distance across months and years; relative wording gives way to dates past a week; consecutive days group into one era per month; depth is ranked by position so an uneven history still recedes evenly; single-day and empty histories do not divide by zero |
| U40 | repo/color replace | single and bulk recolouring share the same mutation rule; whole-library replacement includes live detached rows, excludes tombstones, persists across reopen, rejects an exact stale preview (including same-count membership changes) and unknown palette keys, and rolls the complete transaction back when any row write fails |
| U41 | backup/colour conflict | colour uses an independent conflict clock, so a later recolour merges with — rather than overwrites or resurrects — a newer remote note/deletion |

## E2E (Playwright, loaded extension)

Fixtures served from `fixtures/` on a local static server. The content
script mirrors its anchor state to `<html data-locus-anchored data-locus-detached>`
for observability without page-world coupling.

| ID | Flow | Assertion |
|----|------|-----------|
| E1 | load | extension service worker starts; fixture page gets content script |
| E2 | highlight | selecting text on `nested.html` shows the floating 3-color toolbar inside a shadow root; clicking a color creates a highlight (`data-locus-anchored="1"`) |
| E3 | persist/restore | reload restores the highlight via anchors (E2 page) |
| E4 | last color | second highlight defaults to the last-used color |
| E5 | note | clicking a highlight opens the Markdown note editor; the note live-previews, persists, and renders as Markdown in the side panel |
| E6 | repeated text | highlighting the 2nd of 3 identical strings on `repeated.html` restores onto the same occurrence after reload (verified by bounding-box vs the occurrence's container) |
| E7 | dynamic | `dynamic.html` re-writes its DOM ~500 ms after load; annotation re-anchors (observer retry) |
| E8 | detached | `dynamic.html#remove-target` removes the annotated paragraph; annotation shows as detached in the side panel, still listed, never deleted |
| E9 | side panel | panel lists annotations for the current source; click scrolls the page to the highlight and pulses it |
| E10 | delete/undo | panel delete shows an undo affordance; undo restores; after timeout the row remains in IndexedDB as a tombstone |
| E11 | layout | creating highlights on every fixture causes zero movement of probe elements (bounding boxes before/after are identical) |
| E12 | svg/mathjax/iframe | fixtures load without errors; annotating HTML text near SVG/MathJax-like markup works; selection inside a cross-frame iframe is ignored gracefully |
| E13 | shortcuts | with the toolbar open, pressing 2 highlights in the second color and dismisses the toolbar |
| E14 | undo | Cmd/Ctrl+Z tombstones the most recent highlight |
| E15 | image | ordinary clicks on plain, linked and already-ringed images remain entirely native; sub-8 px jitter, modifier gestures and mouseup on linked padding also stay native; unmodified horizontal/vertical drags past the 8 px threshold open the toolbar without firing page click/navigation, shortcut 1 creates a persistent ring, and dragging an existing ring opens its note without duplicating it |
| E16 | note keys | Enter saves the note (Shift+Enter = newline); Delete with an empty note (or ⌘/Ctrl+Delete anytime) removes the highlight |
| E17 | custom color | the toolbar "+" adds a picker color; it appears with the next shortcut digit, highlights, and survives reload |
| E18 | placement | position pref: below (default) / above / auto — auto flips above when another floating UI overlaps the below band |
| E19 | site off | ⌘-hover on the toolbar's right edge reveals ✕; clicking disables Locus for the origin (dormant, re-enable is live) |
| E20 | doi | annotating version A then opening same-DOI version B shows the jump toast; the DOI pref switch silences it |
| E22 | backup | Export produces a real download; wiping the DB and importing that file restores the annotation, its Markdown note and a working anchor; re-importing adds nothing |
| E23 | sync | two independent installs (separate profiles) converge in both directions through a mock WebDAV server; a deletion on one propagates and repeated syncs never resurrect it; a real export contains neither the sync username nor password |
| E24 | sync/errors | a wrong app password surfaces an actionable message instead of failing silently |
| E42 | library/bulk colour | whole-library replacement changes filtered and hidden live rows to an existing palette colour, includes detached rows, excludes deleted rows, refreshes an open page, migrates only the active source-colour filter, refreshes statistics and persists after reload; same/empty choices remain disabled and the pending dialog blocks card actions |
| E43 | sync/bulk colour | a failed WebDAV push leaves one complete local colour transaction rather than a partial update; after credentials are fixed, retry uploads the complete batch together, and a recolour made during an active slow push is queued and reaches the remote file in a follow-up pass |
| E44 | timeline | days group into eras with one rail tick each; backdating a history splits it into two eras and four days, and relative labels read Today / 2 days ago |
| E45 | timeline | clicking a rail tick travels to that day, marks it current and clears the previous one |
| E46 | timeline | depth rises monotonically from nearest to oldest layer, while quote text stays fully opaque — receding must never mean harder to read |
| E25 | builds | production Chrome and Edge builds are loadable MV3 bundles from the same source; `pnpm zip:store*` omits the manifest key while keeping WXT in production mode, and its verifier rejects React development code or absolute local paths |
| E26 | placement/rivals | auto dodges a rival toolbar built the way real ones are: `pointer-events: none` wrapper, `position: absolute`, shadow host nested below `<body>`, and one that renders 250 ms late |
| E27 | PageNote import | importing a PageNote ZIP through Backup restores its highlights, URLs, notes and colors; importing the same file again adds nothing |
| E32 | library | annotations from three pages are listed; switching to site and timeline re-groups the same data, and the chosen mode survives reopening the Library |
| E33 | library | search matches notes, quotes and page titles with the visible hit marked in every view; a miss shows the filtered-empty state; colour filter narrows and clears |
| E34 | library | clicking an annotation opens a page that was **not** already open and scrolls to it — the path that fails silently if the reveal is fired at a fresh tab |
| E35 | library | editing a note, deleting and restoring from the library, each reflected on the open page |
| E36 | library | a detached annotation is badged and can be filtered to |
| E37 | selection delete | Delete/Backspace tombstones every annotation overlapped by the native selection, leaves annotations outside it alone, bypasses ordinary page bubble blockers, ignores editable controls, and restores the batch with one Cmd/Ctrl+Z |
| E38 | page colors | a new page starts with three (at most five) choices; three manual additions persist only on that page; side-panel removal hides the choice without changing an existing annotation's rendered color |
| E39 | library cards | page cards show at most five matching annotations by default, expose the complete remainder through an ellipsis control, keep hidden matches searchable, and pack variable-height cards without grid-row gaps |
| E40 | library sites | site chips merge host variants into readable families; deleting the last live annotation in a selected family removes the stale chip and filter, while the deleted bin retains its own family/count universe |
| E41 | side panel navigation | the panel displays the version from its manifest and its All annotations control opens the full Library page |

## Manual checklist (pre-release)

- Install/store disclosure clearly requests access to HTTP(S) pages and matches
  the broad-host justification in the listing materials.
- Popup disable/enable round-trip on a real publisher page (e.g. any HTML
  article) — disable makes Locus dormant immediately and enable restores it
  without a reload.
- Edge: side panel opens and lists annotations (Edge ≥ 114).
- Keyboard: toolbar buttons reachable; comment box supports IME input
  (Chinese) without the page stealing keys.
- Keyboard: native selection across multiple highlights deletes as one batch;
  focused input/textarea/contenteditable controls keep their own Delete keys.
