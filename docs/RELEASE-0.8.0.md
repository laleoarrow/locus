# Locus / 文迹 0.8.0

Select the notes you want to change, keep each page's main ideas together, and optionally use your own model to help organise them.

## New

- **Selected batch editing.** Choose individual annotations, a page, or all filtered results. Change colours, append or replace notes, delete, and restore. The selection includes collapsed rows and works across page, site and timeline views. A concurrent edit aborts the batch rather than overwriting newer content.
- **Main content under each page title.** Add and edit a separate Markdown summary. It remains independent of the original highlights and notes, and travels with backups and WebDAV sync.
- **Optional LLM organisation.** Configure an OpenAI-compatible API URL, model and key, with an editable default prompt. Generation is off by default and starts only on request. Preview and edit individual or multi-page drafts before saving. API settings and keys stay on the current device, outside backups and sync.

## Fixed

- Auto toolbar positioning now detects deeply nested and open/closed-shadow floating controls, follows late appearances and movement, and searches nearby free space when both vertical positions are blocked.
- Changing position settings or a palette updates an already visible toolbar immediately. Scrolling, resizing and narrow viewports retain usable placement.
- Note/delete/restore timestamps advance monotonically, preserving stale-edit protection even within the same millisecond.

## Upgrade

Update your existing extension in place; keep its extension ID and data. The database upgrades additively to schema v4. Backups use format v3 to include page summaries and still import v1/v2 files. Update every device sharing a WebDAV library to 0.8.0 before continuing sync with the new format.

Download the Chrome or Edge ZIP below and reload the existing unpacked extension. The keyless Edge store package is prepared separately and is not the sideload download.

## Validation

TypeScript checks, 203 unit tests, all 55 browser regression cases, Chrome/Edge production builds, and the Edge store-package verifier. LLM protocol and failure tests use a local mock service; a separate production-extension check generated a draft through a real local OpenAI-compatible service using synthetic notes. The installed Edge build was checked in place with all 34 existing live annotations retained, and Auto was visually verified alongside the actual Doubao selection toolbar.
