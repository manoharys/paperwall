# Clean-room rules

Placard is an independent design tool. It does what people expect any design
tool to do (put text, shapes and pictures on a page, then export it), and it
does that with code, artwork and words made for this project. These rules keep
it that way. Every contributor follows them, human or AI.

## What we never do

1. **No looking inside other products.** We don't download, decompile,
   disassemble, de-minify or run analysis tools on another design product's
   apps, websites, code or network traffic. That includes reverse-engineering
   toolkits pointed at them.
2. **No copying content.** No templates, fonts, icons, illustrations, photos,
   stock media, UI text, help-center text or marketing copy from other
   products.
3. **No copying the look.** Placard has its own layout, colors, icons and
   names. Where all design tools share an idea (a canvas in the middle, an
   undo button), we use the idea, not someone else's version of it.
4. **No lookalike branding.** The product name, logo and colors are neutral.
   Other products are named only to compare, as in "an alternative to X".
5. **No circumvention.** Nothing in Placard bypasses logins, licenses, DRM or
   paywalls of any other service. Placard never talks to other services at
   all.

## What we do instead

- **Features come from common knowledge.** The feature list in
  `features.json` is written in our own words from what people generally
  expect from a design tool. Each feature is short and testable.
- **Assets are original or openly licensed.**
  - Icons, illustrations and templates are drawn for Placard and released as
    CC0.
  - Fonts are open-license only (SIL Open Font License or Apache 2.0). Each
    font ships with its license file, listed in `assets/fonts/LICENSES.md`.
- **Every feature has a test.** A feature counts as done only when an
  automated test proves it works. The scoreboard is generated from the test
  run.

## If you think something here is yours

Open an issue titled "Rights request" with what it is and where it appears in
the repo. We'll look at it within 48 hours, and remove anything that shouldn't
be here.
