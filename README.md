# Locus / 文迹

A minimal, **local-first annotation layer for academic reading**, shipped as a
Manifest V3 extension for Chrome and Microsoft Edge.

Locus is not a reference manager. It does one thing: let you highlight and
annotate the HTML pages you read, keep those annotations on your machine, and
bring them back reliably — even when the page shifts under you.

- **Per-site, at runtime.** No host access at install; you enable Locus per
  site from the toolbar popup.
- **Select → highlight → note.** A compact floating toolbar appears after
  selection; highlights use your last color; notes are plain text.
- **Local only.** Everything lives in IndexedDB. No accounts, no sync, no
  telemetry, nothing leaves the machine.
- **Resilient anchors.** Each annotation stores the exact text, surrounding
  context, character positions, and DOM paths; recovery tries them in order.
  An annotation that can't be re-anchored shows as *detached* in the side
  panel — it is never silently deleted.
- **Non-invasive rendering.** CSS Custom Highlight API where available (zero
  DOM mutation, zero layout shift); a zero-box `<mark>` fallback elsewhere.
  All extension UI lives in a Shadow DOM.
- **Native side panel.** Chrome/Edge Side Panel lists the current page's
  annotations; click to scroll-and-pulse; delete is a tombstone with undo.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and
[docs/ACCEPTANCE-TEST-PLAN.md](docs/ACCEPTANCE-TEST-PLAN.md) for the test plan.

## Development

```bash
pnpm install       # installs deps + generates WXT types
pnpm dev           # dev mode (Chrome)
pnpm dev:edge      # dev mode (Edge)
```

## Quality gates

```bash
pnpm typecheck     # wxt prepare + tsc --noEmit (strict)
pnpm test          # Vitest unit tests (anchoring, repo, url)
pnpm e2e           # builds --mode e2e and runs Playwright extension tests
pnpm build         # production build → .output/chrome-mv3
pnpm build:edge    # production build → .output/edge-mv3
```

The e2e build pre-grants `http://localhost/*` only so Playwright can bypass
the (un-automatable) native permission prompt; production builds request no
host access at install.

## Loading a build

1. `pnpm build` (or `pnpm build:edge`)
2. Chrome: `chrome://extensions` → Developer mode → *Load unpacked* →
   `.output/chrome-mv3`. Edge: `edge://extensions` → *Load unpacked* →
   `.output/edge-mv3`.
3. Open any article, click the Locus toolbar icon, and *Enable on this site*.
