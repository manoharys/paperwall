# Contributing to Placard

Thanks for helping. Placard is small on purpose: plain JavaScript, no
framework, no runtime dependencies, and every feature proven by a test.

## The two rules

1. **Clean room.** Read [CLEAN_ROOM.md](CLEAN_ROOM.md) first. Don't copy
   anything from another product: no code, templates, fonts, icons, text or
   look. Don't use tools that look inside other products. PRs that break this
   are closed.
2. **A feature is done when a browser test proves it.** Name the test with
   the feature id from [`features.json`](features.json), like
   `test('[TXT-04] choose a font', ...)`. The scoreboard picks it up.

## Getting started

```bash
git clone <this repo> && cd <it>
npm run dev          # http://127.0.0.1:5173, no install needed
npm test             # unit tests (no browser)
npm install          # only needed for the browser tests
npx playwright install chromium
npm run test:e2e     # browser tests against the built app
npm run scoreboard   # everything, and regenerates SCOREBOARD.md
```

## Where things live

| Folder | What |
| --- | --- |
| `src/model` | The design, every edit, text layout, the SVG renderer, PDF/QR/zip writers. Pure functions, unit-tested, no browser needed. |
| `src/app` | The editor: canvas, panels, export, storage, shortcuts. |
| `src/templates` | Templates, as code. |
| `assets/fonts` | Bundled fonts with their licenses. |
| `test/unit`, `test/e2e` | Unit tests and browser tests. |
| `scripts` | Dev server, build, scoreboard, demo recording. |

## Good first contributions

- **Templates.** The most visible gap. Add one to `src/templates/index.js`
  using only Placard's shapes, text, icons and stickers and the bundled
  fonts. Check it with `node scripts/render-templates.mjs` (with `npm run dev`
  running) and make sure no headline wraps badly. Your template is released
  as CC0.
- **Icons and stickers.** Draw them yourself on the 24 × 24 (icons) or
  100 × 100 (stickers) grid in `src/model/graphics.js`. CC0.
- **Translations** of the interface (coming: one file per language).
- Anything listed as "not done yet" in [SCOREBOARD.md](SCOREBOARD.md).

## Pull requests

- Keep them focused. One feature or fix per PR.
- `npm test` and `npm run test:e2e` must pass; CI runs both.
- New behavior needs a test. Bugs need a test that failed before the fix.
- No new runtime dependencies. Dev dependencies need a good reason.
- Write user-facing text in plain words: "Download", not "Export asset".
- By contributing you agree your work is released under the MIT license
  (and CC0 for templates, icons and stickers).

## Reporting bugs

Open an issue with what you did, what you expected and what happened, plus
your browser. A design file (Save to file) that shows the bug helps a lot.
Security problems: see [SECURITY.md](SECURITY.md) instead.
