# Locus — Acceptance Test Plan

Scope: milestone 1 (HTML annotation, local persistence, side panel).
Layers: unit (Vitest, jsdom + fake-indexeddb) and extension e2e
(Playwright, real Chromium with the `--mode e2e` build, which pre-grants
`http://localhost/*` so the un-automatable native permission prompt is
bypassed while still exercising the dynamic registration code path).

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
| U14 | palette | custom colors build from hex, order after builtins (shortcut digits), unknown keys fall back to yellow |
| U15 | prefs | placement and custom colors persist; add dedupes; remove works |

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
| E15 | image | clicking a plain image offers the toolbar and shortcut 1 rings it (ring tracks the image box, survives reload, lists in the panel); linked images are ignored |
| E16 | note keys | Enter saves the note (Shift+Enter = newline); Delete with an empty note (or ⌘/Ctrl+Delete anytime) removes the highlight |
| E17 | custom color | the toolbar "+" adds a picker color; it appears with the next shortcut digit, highlights, and survives reload |
| E18 | placement | position pref: below (default) / above / auto — auto flips above when another floating UI overlaps the below band |
| E19 | builds | `wxt build -b chrome` and `-b edge` both produce a loadable MV3 bundle from the same source |

## Manual checklist (pre-release)

- Install-time permission dialog requests no host access.
- Popup enable/disable round-trip on a real publisher page (e.g. any HTML
  article) — enable injects immediately, revoke stops on next navigation.
- Edge: side panel opens and lists annotations (Edge ≥ 114).
- Keyboard: toolbar buttons reachable; comment box supports IME input
  (Chinese) without the page stealing keys.
