# Locus / 文迹 — Architecture

A minimal, local-first annotation layer for academic reading, shipped as a
Manifest V3 extension for Chrome and Microsoft Edge. Not a reference manager:
no bibliographic metadata, no AI, no tags/folders, no collaboration, no
citations, no summarization, no hosted backend, no telemetry. Optional WebDAV
sync talks only to storage configured and controlled by the user.

## 1. Process topology

```
┌────────────────────────────┐   chrome.runtime messages   ┌──────────────────────────┐
│ Content script (per tab)   │ ──────────────────────────► │ Background service worker │
│  selection · anchoring ·   │ ◄────────────────────────── │  message router · repo    │
│  rendering · shadow-DOM UI │      broadcasts             │  writes · dynamic content │
└────────────────────────────┘                             │  script registration      │
                                                           └────────────┬─────────────┘
┌────────────────────────────┐                                          │ Dexie (writes)
│ Side panel (extension page)│── Dexie liveQuery (reads) ──► IndexedDB ◄┘
│  annotation list · undo    │── mutations via messages ──► background
└────────────────────────────┘
┌────────────────────────────┐
│ Popup (extension page)     │  per-site enable/disable, opens side panel
└────────────────────────────┘
```

Rules enforced by this topology:

- **Content script** does selection, anchoring, and rendering only. It owns no
  persistence; every read/write goes through typed runtime messages to the
  background worker.
- **All mutations** flow through the background repository. The background is
  the single writer, so cross-context invalidation is one broadcast.
- **Persistent state lives in IndexedDB** (extension origin), never only in
  service-worker globals. The worker may die at any time; every handler
  re-opens Dexie on demand.
- **Side panel reads directly** from Dexie with `liveQuery` (extension pages
  share the extension-origin IndexedDB; Dexie propagates change events across
  contexts via BroadcastChannel), and sends mutations to the background so
  content scripts hear about them.
- **UI isolation:** all in-page UI (toolbar, comment box, pulse overlay) lives
  inside an open Shadow DOM on a single host element appended to
  `<html>`. Page CSS cannot leak in; our CSS cannot leak out.

## 2. Host access & per-site control

Product decision (v0.3): Locus is **on everywhere by default** — the manifest
grants `http://*/*` / `https://*/*` at install (this is a sideloaded personal
tool; one grant beats a per-site prompt on every publisher domain). The
original per-site runtime-grant model is preserved in git history (≤ v0.2).

- The background still registers one dynamic content script from the granted
  origins at startup (`chrome.scripting.registerContentScripts`,
  `persistAcrossSessions: true`), so the mechanism is unchanged.
- Per-site control is now a **preference**: `prefs.disabledSites` is an
  origin blacklist. The popup toggles it, and the toolbar's ⌘-hover ✕ zone
  adds the current origin. A disabled origin's content script stays dormant
  (no listeners act, nothing renders) and flips back on live when the origin
  is re-enabled — no reload needed.
- Nothing about the page is sent to Locus or GitHub. The two optional network
  features are WebDAV sync to a server the user configures and the update check
  for public GitHub release metadata; neither sends page content or telemetry.

## 3. Domain model

Defined in `src/domain/types.ts`. All timestamps are epoch milliseconds.
`deletedAt: 0` means "alive" (IndexedDB indexes cannot express null cleanly).

| Entity | Purpose | Key fields |
|---|---|---|
| `DocumentRecord` | A logical document being read | `id`, `title`, `createdAt`, `updatedAt` |
| `SourceRecord` | A concrete URL where the document lives | `id`, `documentId`, `urlKey`, `url`, `title`, `firstSeenAt`, `lastSeenAt` |
| `AnnotationRecord` | One highlight (`kind: text \| image`) + optional Markdown note | `id`, `documentId`, `sourceId`, `kind`, `color`, `colorUpdatedAt`, `comment`, `exact`, `createdAt`, `updatedAt`, `deletedAt` |
| `AnchorRecord` | Everything needed to re-locate the annotation | text: `exact`, `prefix`, `suffix`, `start`, `end`, `startPoint`, `endPoint` · image: `src`, `alt`, `imgIndex`, `path` |
| `SettingRecord` | Key/value app state (e.g. `lastUsedColor`) | `key`, `value` |

Notes are Markdown source strings rendered by `src/lib/markdown.ts` — a
dependency-free renderer whose output is built only from escaped text
(headings, lists, quotes, code, bold/italic, http(s) links), so it is safe in
both the shadow-DOM note editor and the side panel. Three highlight colors
(fluorescent yellow, teal, pink) map to keyboard shortcuts 1/2/3.

In this milestone a document has exactly one source (`urlKey` 1:1), but the
split is kept so future work (same paper on publisher + mirror) does not need
a migration of meaning, only of matching logic.

`urlKey` normalization (`src/domain/url.ts`): lowercase scheme+host, drop
default ports, drop fragment, drop `utm_*`/`fbclid`-style tracking params,
keep the remaining query (academic sites key articles off query IDs), drop a
single trailing slash on non-root paths.

Anchor endpoint paths (`DomPoint`) are element paths from `documentElement`
(`tag` + index among same-tag siblings at each step) plus the index of the
text node among the element's direct text-node children and a character
offset. This survives attribute/class churn, which is common on
publisher pages.

## 4. Storage schema & migrations

Dexie database `locus`, defined in `src/db/schema.ts`.

```ts
db.version(1).stores({
  documents:   "id, updatedAt",
  sources:     "id, urlKey, documentId",
  annotations: "id, sourceId, documentId, createdAt, deletedAt",
  anchors:     "id, annotationId",
  settings:    "key",
});
```

Migration strategy:

- Schema changes are **additive version bumps** (`db.version(n).stores(...).upgrade(tx => ...)`).
  Dexie runs pending upgrades sequentially, so any historical version can
  reach head.
- Records carry no schema-version field; the DB version is the schema version.
- **Deletes are tombstones**: `deletedAt` is set to the deletion time, never a
  row removal. Undo clears it back to `0`. List queries filter
  `deletedAt === 0`. Nothing in this milestone hard-deletes rows, which also
  guarantees detached annotations are never silently lost.
- Rows referencing each other (`annotation` ↔ `anchor`) are written in a
  single Dexie transaction.

## 5. Anchoring

### 5.1 Capture (at highlight creation)

Built from the live selection `Range` against a **text index**: a walk of all
visible text nodes under `document.body` (skipping `script`, `style`,
`noscript`, and the Locus shadow host) producing segments
`{ node, start, end }` whose concatenation is the *page text*. From the range
we store, per item 9 of the milestone:

- `exact` — the selected string as it appears in page text
- `prefix` / `suffix` — up to 32 characters of surrounding page text
- `start` / `end` — character positions in page text
- `startPath` / `endPath` — DOM paths as described above

### 5.2 Recovery algorithm (at restore)

Strategies run in order; the first verified hit wins. Verification always
means: the resolved range's text equals `exact`.

1. **DOM path.** Resolve `startPath`/`endPath` to text nodes, build the
   range, verify. Fast path for unchanged pages.
2. **Character position.** If `pageText.slice(start, end) === exact`, map the
   offsets back to a range through the text index. Survives pure
   attribute/structure churn that breaks paths.
3. **Context quote search.** Find every occurrence of `exact` in page text.
   Score each candidate by the longest matching run of `prefix` ending at the
   candidate plus that of `suffix` starting after it. A unique occurrence is
   accepted as-is; among multiple, the best candidate is accepted only if its
   context score clears a floor (≥ 4 matching characters, so incidental
   whitespace cannot corroborate) and strictly beats the runner-up —
   otherwise the annotation detaches rather than guessing. Handles
   inserted/removed content that shifts positions.
4. **Detached.** If nothing verifies, the annotation is marked *detached*:
   it renders nowhere on the page but stays fully visible in the side panel
   with a detached badge, and is never deleted by the system.

**Image anchors** (`src/domain/anchor/image.ts`) follow the same shape with
two strategies: DOM path (verified against `src`), then `src` + index among
same-src images; otherwise detached. A deliberate primary-button drag across
any image (including one wrapped in a link) is the selection gesture; ordinary
clicks and modifier-assisted gestures always remain with the page so links,
lightboxes and publisher controls keep their native behaviour.

Re-anchoring is retried for detached annotations on DOM mutations
(MutationObserver, debounced 300 ms) for the first 15 seconds after load,
which covers late-hydrating readers (MathJax-style typesetting, dynamic
fixtures) without a permanent observer cost.

### 5.3 Rendering

- **Primary:** CSS Custom Highlight API. One `Highlight` object per color
  registered in `CSS.highlights` (`locus-yellow`, …) plus one for the pulse.
  A `<style>` element with `::highlight(...)` rules is appended to `<head>`
  (this does not touch article text and adds zero layout cost).
- **Fallback** (API unavailable): wrap each text-node slice of the range in
  `<mark class="locus-mark" data-locus-id>` with margin/padding/border zeroed
  so no layout shift occurs. Marks are unwrapped on removal.
- **Image rings:** an image annotation renders as a glowing ring in a
  dedicated shadow overlay layer, absolutely positioned in document
  coordinates over the `<img>` (repositioned on resize and re-anchor).
  The image element itself is never touched.
- **Reveal/pulse:** side-panel click sends `annotation:reveal`; the content
  script scrolls the range to center and flashes absolutely-positioned
  overlay boxes (inside the shadow host) over the range's client rects.
  Article DOM is untouched.

### 5.4 Interaction model

- Selecting text (or dragging at least 8 px across an image with the unmodified
  primary button) pops a liquid-glass pill toolbar with the palette orbs —
  three builtins plus any user-added colors (the "+" orb opens a native picker;
  custom colors persist in prefs and get the next shortcut digits). **1–9**
  pick a color, **Esc/click-away** dismisses. Repeating that drag on an already
  annotated image opens its note; a normal image click is never intercepted.
- Toolbar placement is a preference (side-panel footer): *below* (default),
  *above*, or *auto*. The decision itself is pure geometry in
  `src/domain/placement.ts` (unit-tested without a DOM): given the selection
  box, the measured toolbar size and the boxes of other floating UI, it takes
  the side that fits and is clear, else the clear side, else the side with
  less overlap.

  Obstacles are gathered in the content script by **measuring rectangles**
  (`getBoundingClientRect` over positioned, high-z or shadow-hosting elements
  near the top of the tree), not by hit-testing sample points. An earlier
  `elementsFromPoint` version missed real rival toolbars for three reasons
  worth remembering: they are routinely wrapped in a `pointer-events: none`
  layer, which hit-testing skips entirely; they are as often `position:
  absolute` as fixed/sticky; and a single probe column misses anything that
  overlaps only part of our width. Full-page scrims (>60% of the viewport) are
  ignored, or every side would look occupied.

  Because rival toolbars react to the same `mouseup` and often render a beat
  later, placement is re-evaluated once ~350 ms after showing and the toolbar
  moves if the chosen side turned out to be taken. `fixtures/competitor.html`
  reproduces all four shapes; E26 covers them.
- **⌘/Ctrl-hover** on the toolbar's right edge slides out a ✕ zone that
  disables Locus on the current site (see §2).
- **DOI version linking** (optional, on by default): the content script reads
  the page's DOI from citation meta tags or the URL path — locally, nothing
  fetched — and the background records it on the document. When a page's DOI
  matches a *different* annotated document, a glass toast offers jumping to
  the annotated version. Requires DB v2 (`documents.doi` index).
- **Update check** (optional, on by default): a 12-hour alarm fetches release
  metadata from the GitHub API and badges the action icon when a newer
  version exists; the popup links to the release. Sideloaded extensions
  cannot self-install updates, so installation stays manual by design.
- Clicking an existing highlight (hit-tested against rendered ranges — the
  Custom Highlight API has no DOM elements to click) opens the Markdown note
  editor with live preview. **Enter** saves (Shift+Enter inserts a newline);
  **Delete** with an empty note — or **⌘/Ctrl+Delete** anytime — removes the
  highlight, as does the *Remove highlight* button. All removals tombstone.
- **Cmd+Z (macOS) / Ctrl+Z (Windows)** undoes the most recent Locus action
  in the tab (create → tombstone, note-editor delete → restore), via a
  per-tab action stack. The shortcut is ignored inside editable page
  elements so it never fights the page's own undo.

## 6. Messaging protocol

Typed request/response pairs in `src/messaging/protocol.ts`; a single
`onMessage` router in the background. Key messages:

- `source:bootstrap` (content → bg): register source for a URL, returns live
  annotations + anchors + last-used color.
- `annotation:create` (content → bg): annotation draft + anchor, returns ids.
- `annotation:set-comment`, `annotation:delete`, `annotation:undelete`
  (panel/content → bg).
- `annotations:replace-color` (library → bg): atomically recolours every live
  annotation using the selected source color, validates the exact preview
  snapshot and palette key, then schedules the same sync/invalidation path as
  single-row edits. Detached rows participate; tombstones never do.
- `annotation:changed` (bg → all tabs + runtime): invalidation broadcast
  carrying `urlKey`.
- `annotation:reveal` (panel → bg → tab), `annotations:anchor-state`
  (content → bg → panel): anchored/detached status per annotation id.
- `prefs:set-placement`, `prefs:add-color`, `prefs:remove-color`,
  `prefs:toggle-site`, `prefs:set-detect-doi`, `prefs:set-check-updates`
  (popup/panel/content → bg), each answering with the new `Prefs` and
  broadcasting `prefs:changed` to every tab.
- `update:status` (popup → bg): current version, last check result, and
  whether a newer release exists.

## 6b. Backup & sync

**Backup format** (`src/domain/backup.ts`): a versioned JSON snapshot
(`formatVersion`, independent of the DB schema version) holding documents,
sources, annotations, anchors and portable settings. Import validates every row
defensively — it runs on a user-supplied file — and drops malformed rows rather
than trusting them. `updateInfo` is excluded as volatile. v0.7 writes format v2
for the independent colour clock while continuing to read v1; older clients
reject v2 and therefore cannot overwrite a synced library using legacy
whole-row colour conflict rules.

**Merge** (`repo.importBackup`) is the one algorithm both backup-import and sync
rely on, so it must be convergent and non-destructive:

- Pages are matched by `urlKey`, and incoming `documentId`/`sourceId` are
  remapped to the local ones. Two machines that annotated the same URL keep one
  document, not two.
- Rows merge by id: newer `updatedAt` wins for notes/deletions, while colour
  uses its independent `colorUpdatedAt` clock. Tombstones travel, so a colour
  edit cannot resurrect a deletion or overwrite a newer note on another
  device.
- An incoming annotation identical to a local one in every meaningful field
  (source, colour, comment, kind, anchor position) counts as already present, so
  syncing does not accumulate duplicate highlights.

These properties make it idempotent: syncing twice equals syncing once.

**Sync** (`src/sync/`, driven from the background): pull the remote file, merge,
push the result back with `If-Match` on the ETag; a 412 means another device
pushed first, so the pass restarts from the pull (up to 3 attempts). Pushes are
debounced ~4 s after local edits; a mutation arriving during an active pass
queues one follow-up pass instead of being discarded. Pulls run on a
configurable alarm. A remote file that fails validation is reported, never
overwritten.

Credentials live in `chrome.storage.local`, not the Dexie settings table — that
keeps them structurally out of export files (asserted by E23). The UI is only
handed a view with `hasPassword: boolean`.

## 6c. Annotation library

A standalone extension page (`library.html`) listing every annotation across
every site — the one place to browse, search and tidy the whole collection. It
is a separate entrypoint rather than a side-panel mode: a library needs width,
and `sidepanel/App.tsx` was already carrying the page list, backup and sync.

- `src/domain/library.ts` is pure (no DOM, no `chrome.*`): the view model plus
  grouping, filtering, search and sorting. The three display modes — by page, by
  site, timeline — are three projections of one dataset, which is why supporting
  all three costs almost nothing.
- `src/db/library.ts` loads the whole library in one pass. Cross-dimension
  filtering (site × colour × time × keyword) does not map onto IndexedDB's
  single-index model, so a paged version would still finish in memory. The scale
  ceiling and its remedy are recorded in the design doc.
- The page reads through `liveQuery`, so a sync pull, a backup import or an edit
  in the side panel is reflected without a refresh. **Every mutation still goes
  through the existing background messages**, so no second write path exists to
  bypass the sync and tombstone invariants.
- The compact Batch menu can replace one colour across the complete live
  library in a single repository transaction. It is not scoped to the current
  filters or visible cards; the dialog previews the exact count and an active
  source-colour filter migrates to the target after success.
- Deleted annotations are reachable behind a *Deleted* filter with a Restore
  action — the rows were always kept, there was simply no way to see them.
- Detached state is knowledge only a running content script has, so the content
  script reports it and the background stores it in an `anchorStates` table
  (schema v3). It is written **only when the state changes**, and it never
  enters a backup: `exportBackup` enumerates tables explicitly, and a unit test
  pins that.
- Jumping to an annotation goes through `library:reveal`, which finds or creates
  the tab, waits for the page, then retries the reveal while the content script
  boots. Sending straight at a fresh tab would fail silently.

## 7. Source layout

```
src/
  domain/            pure logic, no chrome.*, no DOM globals at import time
    types.ts         all domain types
    colors.ts        color palette (5 colors + CSS values)
    url.ts           urlKey normalization
    anchor/
      textIndex.ts   page-text segment index, range↔offset mapping
      capture.ts     Range → AnchorData
      resolve.ts     recovery algorithm (strategies 1–3)
      domPath.ts     DomPoint build/resolve
  db/
    schema.ts        Dexie database + versions
    repo.ts          repository functions (single write path)
  messaging/protocol.ts
  entrypoints/
    background.ts    router, registration, broadcasts
    content.ts       selection → toolbar → capture → render; restore pipeline
    content/ui.ts    shadow-DOM toolbar/comment/pulse (plain DOM, no framework)
    sidepanel/       React app (list, undo toast, detached badges)
    popup/           React app (per-site access, open panel)
fixtures/            static pages: nested, repeated, dynamic, svg, mathjax, iframe
tests/               Vitest unit tests (jsdom + fake-indexeddb)
e2e/                 Playwright extension tests
```

Dependency direction: `entrypoints → messaging/db → domain`. Domain modules
import nothing above them and are fully unit-testable.

## 8. Invariants (quality gates)

- `pnpm typecheck`, `pnpm test`, `pnpm e2e` all pass.
- Chrome and Edge builds come from the same source (`wxt build -b chrome|edge`).
- The manifest grants HTTP(S) page access for annotation on arbitrary reading
  sites; the per-site off list must remain immediate and reversible.
- No hosted backend and no telemetry; only user-configured WebDAV sync and the
  GitHub release-metadata check may use the network.
- Highlight rendering causes no visible layout shift on fixture pages.
- Reload restores every valid annotation; un-anchorable annotations surface
  as detached in the side panel and are never silently deleted.
