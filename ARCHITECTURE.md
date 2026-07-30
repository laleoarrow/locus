# Locus / 文迹 — Architecture

A minimal, local-first annotation layer for academic reading, shipped as a
Manifest V3 extension for Chrome and Microsoft Edge. Not a reference manager:
no bibliographic metadata, no AI, no tags/folders, no collaboration, no
citations, no summarization, no cloud sync, no telemetry.

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
  inside a closed Shadow DOM on a single host element appended to
  `<html>`. Page CSS cannot leak in; our CSS cannot leak out.

## 2. Runtime host access

- Manifest requests **no host permissions at install**. It declares
  `optional_host_permissions: ["http://*/*", "https://*/*"]`.
- The popup shows the current origin with an *Enable on this site* toggle.
  Clicking it calls `chrome.permissions.request({ origins: [origin + "/*"] })`
  inside the popup's user gesture.
- On grant, the background (re)registers a single dynamic content script
  (`chrome.scripting.registerContentScripts`, `persistAcrossSessions: true`)
  whose `matches` is the set of granted origins, and injects into the current
  tab immediately with `chrome.scripting.executeScript`.
- On revoke (`permissions.onRemoved` or the popup toggle), the registration is
  updated; open tabs simply stop at next navigation.
- The e2e build mode (`--mode e2e`) additionally grants
  `http://localhost/*` / `http://127.0.0.1/*` at install so Playwright can
  exercise the same registration code path without the native prompt (which
  cannot be automated). Production builds contain no install-time host access.

## 3. Domain model

Defined in `src/domain/types.ts`. All timestamps are epoch milliseconds.
`deletedAt: 0` means "alive" (IndexedDB indexes cannot express null cleanly).

| Entity | Purpose | Key fields |
|---|---|---|
| `DocumentRecord` | A logical document being read | `id`, `title`, `createdAt`, `updatedAt` |
| `SourceRecord` | A concrete URL where the document lives | `id`, `documentId`, `urlKey`, `url`, `title`, `firstSeenAt`, `lastSeenAt` |
| `AnnotationRecord` | One highlight (`kind: text \| image`) + optional Markdown note | `id`, `documentId`, `sourceId`, `kind`, `color`, `comment`, `exact`, `createdAt`, `updatedAt`, `deletedAt` |
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
same-src images; otherwise detached. Images wrapped in links are never
offered for annotation (clicking them must keep navigating).

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

- Selecting text (or clicking a non-linked image) pops a liquid-glass pill
  toolbar with the three color orbs; the last-used color is ringed and is
  also what shortcut keys map to: **1/2/3** pick a color, **Esc/click-away**
  dismisses.
- Clicking an existing highlight (hit-tested against rendered ranges — the
  Custom Highlight API has no DOM elements to click) opens the Markdown note
  editor with live preview; Cmd/Ctrl+Enter saves, and *Remove highlight*
  tombstones.
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
- `annotation:changed` (bg → all tabs + runtime): invalidation broadcast
  carrying `urlKey`.
- `annotation:reveal` (panel → bg → tab), `annotations:anchor-state`
  (content → bg → panel): anchored/detached status per annotation id.
- `site:enable` / `site:disable` / `site:status` (popup → bg).

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
- No install-time host access; no network calls of any kind; no telemetry.
- Highlight rendering causes no visible layout shift on fixture pages.
- Reload restores every valid annotation; un-anchorable annotations surface
  as detached in the side panel and are never silently deleted.
