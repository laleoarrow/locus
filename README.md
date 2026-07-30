# Locus / 文迹

A minimal, **local-first annotation layer for academic reading**, shipped as a
Manifest V3 extension for Chrome and Microsoft Edge.

Locus is not a reference manager. It does one thing: let you highlight and
annotate the HTML pages you read, keep those annotations on your machine, and
bring them back reliably — even when the page shifts under you.

- **Per-site, at runtime.** No host access at install; you enable Locus per
  site from the toolbar popup.
- **Select → highlight → note.** Selecting text pops a liquid-glass toolbar
  with three colors (fluorescent yellow, teal, pink). Press **1/2/3** to pick
  a color from the keyboard; the last-used color is remembered. Clicking a
  highlight opens a **Markdown** note editor with live preview — **Enter**
  saves (Shift+Enter for a newline), **Delete** on an empty note (or
  **⌘/Ctrl+Delete** anytime) removes the highlight. **Cmd+Z / Ctrl+Z** undoes
  your last highlight.
- **Images too.** Clicking a figure (not wrapped in a link) offers the same
  toolbar and draws a glowing ring around the image.
- **Your palette, your layout.** The toolbar's **+** orb adds custom colors
  (they get the next shortcut digits; manage them in the side panel). The
  toolbar shows below the selection by default, or set it to *above* /
  *auto* — auto dodges other extensions' floating toolbars.
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

## Download

Grab the latest packaged build from the
[Releases page](https://github.com/laleoarrow/locus/releases) —
`locus-x.y.z-edge.zip` for Microsoft Edge, `locus-x.y.z-chrome.zip` for
Chrome. Unzip it, then load the folder as an unpacked extension (steps
below). To build from source instead:

## Installing in Edge (or Chrome)

1. `pnpm build:edge` (or `pnpm build` for Chrome). `pnpm zip:edge` also
   produces a distributable archive under `.output/`.
2. Edge: open `edge://extensions`, turn on **Developer mode** (left sidebar),
   click **Load unpacked**, and pick the `.output/edge-mv3` folder.
   Chrome: `chrome://extensions` → Developer mode → *Load unpacked* →
   `.output/chrome-mv3`.
3. Open any article, click the Locus toolbar icon, and *Enable on this site*.
   Select text (or click a figure) and highlight away.
