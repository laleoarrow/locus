# Annotation Library — design

_Approved 2026-07-31. Next major feature after v0.4.1._

## Problem

Locus can only show the annotations belonging to the page you are currently on.
There is no way to see what you have annotated across sites, to find a highlight
when you cannot remember which paper it was in, or to tidy up a growing library.
Every annotation is stored but only reachable by returning to its page.

## Goal

A standalone full-page view listing every annotation across every site, with
enough organisation, search and editing to be the single place a reader manages
their collection.

## Non-goals

Bulk operations and exporting filtered subsets (deliberately deferred — the user
chose the narrower scope). Tags, folders, AI summarisation and citation
management stay out: they are the reference-manager features Locus exists
without.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Where does it live | A standalone extension page opened in a new tab | A library needs width; the side panel is ~400 px and `sidepanel/App.tsx` is already 622 lines and concurrently edited |
| Organisation | All three modes, switchable: by page, by site, by timeline | The user reads in several mental models; each is a projection of one dataset, so supporting all three is cheap |
| Scope of actions | Browse, search, filter, jump to source, edit note, delete, restore | Matches "unified management" without the cost of bulk editing |
| Query strategy | Load all live annotations into memory once, then filter in pure functions | See below |

### Why in-memory rather than indexed queries

An annotation plus its anchor is roughly 600 bytes; 5 000 annotations is about
3 MB, and searching them is a linear scan over a few thousand short strings.
Cross-dimension filtering (site × colour × time × keyword) does not map onto
IndexedDB's single-index model anyway, so a database-backed version would still
finish the job in memory. Adding indexes and pagination now would be premature.

The ceiling is worth writing down: if a library ever reaches tens of thousands
of annotations, revisit this by adding an `origin` index on `sources` and paging
the timeline. Nothing else in the design would have to change, because all
grouping and filtering already lives behind one pure module.

## Architecture

```
src/entrypoints/library/       new page — no other entrypoint is restructured
  index.html · main.tsx
  App.tsx                      shell: search box, mode switch, filter bar
  components/
    AnnotationRow.tsx          quote + note + colour + actions (shared by all modes)
    PageCard.tsx               one annotated page and its annotations
    SiteGroup.tsx              collapsible group of pages under one origin
    Timeline.tsx               flat reverse-chronological list, split by day
  style.css
src/domain/library.ts          PURE: view model, grouping, filtering, search, sorting
src/db/library.ts              read-only queries: everything needed for the page
```

Dependency direction follows the existing rule: `entrypoints → db/messaging →
domain`. `domain/library.ts` imports no `chrome.*` and touches no DOM, so it is
unit-testable exactly like `domain/placement.ts`.

## Data flow

The page subscribes with Dexie `liveQuery`, so a sync pull, a backup import or
an edit made in the side panel updates it without a refresh — the same pattern
the side panel already uses.

Reads go straight to Dexie. **Every mutation goes through the existing
background messages** (`annotation:set-comment`, `annotation:delete`,
`annotation:undelete`). No new write path is introduced, which is what keeps
the sync, tombstone and idempotency invariants intact.

## Organisation modes

Three projections of one dataset; the chosen mode persists in prefs.

- **By page** (default) — one card per annotated page, listing that page's
  annotations. Matches how a reader thinks about papers.
- **By site** — origins collapsed into groups, each containing page cards.
- **Timeline** — every annotation newest-first, separated by day.

## Search and filters

Search matches quoted text, note body and page title, case-insensitively, with
the matched span highlighted in the result. Filters: site, colour, date range,
detached, deleted.

Two filters need explanation:

**Deleted** reveals tombstoned annotations with a Restore action — effectively a
recycle bin. The rows have always been kept (nothing is ever hard-deleted);
until now there was simply no way to see them.

**Detached** is harder, because whether an annotation still resolves is only
known by a content script running on that page, and the library has no such
script. This adds an `anchorStates` table (schema v3, an additive bump
consistent with the documented migration strategy) recording the last known
state per annotation. It is written **only when the state changes**, and it is
**excluded from backup export** — it is local runtime knowledge, and syncing it
would produce meaningless writes and conflicts. `exportBackup` enumerates tables
explicitly, so a new table is naturally left out.

## Jumping to the source

Clicking an annotation opens its page and scrolls to it. If the page is not
already open this cannot be a plain message: the tab must exist *and* its
content script must have booted before `annotation:reveal` will be received.

A new `library:reveal` background message therefore owns the sequence: find an
existing tab for that `urlKey` and focus it, or create one; wait for the tab to
finish loading; then deliver the reveal, retrying a few times while the content
script starts. Sending directly would fail silently.

Detached annotations still open their page — they simply have nothing to scroll
to, and the row says so.

## Error handling

- Empty library and empty filter results get distinct, explanatory states rather
  than a blank page.
- A source whose URL no longer parses is grouped under an "Unknown site" bucket
  instead of throwing.
- If `library:reveal` cannot deliver after its retries, the tab is still opened
  and focused; the failure is reported in the row, not swallowed.
- Annotations whose anchor row is missing are skipped, consistent with
  `listForSource`.

## Testing

**Unit** (`tests/library.test.ts`) over the pure module: grouping in all three
modes, search across quote/note/title including case-insensitivity, each filter
and their combination, tombstone and detached handling, empty library, several
pages sharing one origin, and a source with an unparseable URL.

**E2E** (`e2e/library.spec.ts`): the page opens from the popup and lists
annotations made on more than one fixture; switching modes re-groups the same
data; search narrows it; clicking a row opens a **previously unopened** page and
scrolls to the annotation; editing a note and deleting propagate to the side
panel; a deleted annotation can be restored.

The existing 76 unit and 24 e2e tests must stay green.

## Rollout

Ships as v0.5.0 with a release built the same way as v0.4.1 (sideload zips with
the pinned key on GitHub; store packages via `pnpm zip:store*`). Store
screenshots will need regenerating, since the library is a new headline feature.
