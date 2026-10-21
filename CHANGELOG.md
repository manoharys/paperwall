# Changelog

## 0.7.0 (unreleased): Pro export

- Vector PDF, now the default PDF: shapes, lines, gradients and photos stay
  sharp at any size, and text is set in the design's own fonts, embedded as
  subsets, so it can be selected, searched and copied. Shadows, glows, photo
  filters, curved text and letters a font doesn't have come as a picture of
  just that element.
- Print PDF: the page grows by a 3 mm bleed so backgrounds and photos run
  past the edge, with trim and bleed boxes, crop marks, and pictures at
  300 DPI.
- The picture-per-page PDF stays, as PDF (flattened).
- Download as PowerPoint (.pptx): a slide per page at the design's size,
  with editable text boxes, shapes, cropped and framed photos, and speaker
  notes. Effects, charts, icons and stickers come as pictures. Opens in
  PowerPoint, Keynote and LibreOffice.
- Written from the public specs: deflate, a Brotli decoder and a WOFF2 font
  reader (to embed the bundled fonts), a TrueType subsetter, and the PDF and
  PowerPoint writers.

## 0.4.0 (unreleased): Motion

- Animations for elements as they come in: fade, rise, drop, pan, pop,
  wipe, typewriter, tumble and breathe, each with its own duration and
  delay; or animate a whole page, everything coming in one after another.
- How long each page shows, and the transition into it (fade, slide, push,
  zoom).
- Play: animations, transitions and page timing, from any page; presenting
  plays them too.
- Download as an animated GIF, or as an MP4 or WebM video. Encoded on your
  device: GIFs by our own encoder, video by the browser into MP4 and WebM
  files we write ourselves.
- Videos in designs: poster while editing, playing when presenting and in
  downloads, with a start point and looping.
- A soundtrack: a sound from Uploads plays when you press Play and is mixed
  into downloaded videos.
- v0.3 follow-ups: connectors to elements in turned groups, gradient stops
  without positions, whole-word find in older Safari.

## 0.3.0: Editor pro

- Photo frames in nine shapes and twelve photo grids: drop, drag or pick a
  photo and it's cropped to fill.
- Text effects (lift, hollow, splice, echo, glitch, glow, neon) and
  fourteen ready-made text combinations.
- Gradients with up to eight colors and twelve presets; duotone, warmth,
  tint, hue and vignette for photos.
- Freehand drawing with a pen, marker or highlighter.
- Rulers and guides, a snapping grid, safe margins and print bleed.
- Connector lines (straight, elbow, curved) that stay attached.
- Find and replace across every page; spell check while typing.
- Page titles, hidden pages and a page grid view.
- Version history kept on your device, with restore.
- Fixes: color swatches in color pickers were transparent; the build
  could corrupt code containing "$&".

## 0.2.0: Library

- 397 templates in 44 categories, made from original copy by a layout engine:
  text shrinks to fit and blocks stack, so nothing overflows. Every template
  passes a quality check in a real browser with the real fonts (no overflow,
  no broken words, nothing off the page, readable contrast).
- Multi-page templates: six presentation decks, a 12-month 2027 calendar, a
  two-page menu and planners. Adding one adds all its pages.
- Template browser: search, filter by size, category chips, page-at-a-time
  results and lazy previews.
- 92 open-license font families, loaded only when used, with a searchable
  font picker grouped by style.
- 1,956 icons (Paperwall's own plus Lucide, ISC) and 198 stickers.

## 0.1.0 (unreleased)

The first public version.

- Design editor: text, shapes, lines, images, icons, stickers, QR codes,
  charts and tables; snapping, rotation, cropping, filters, layers, groups,
  alignment, multiple pages, presenting.
- 16 original templates, 14 open-license fonts, 65 icons, 18 stickers.
- Free: transparent PNG, PNG 1–3x, JPG, SVG with fonts, PDF with selectable
  text, zip of pages, print, copy to clipboard. No watermark.
- Resize a design to another format; brand kit; remove plain backgrounds.
- Works offline as one HTML file or an installable web app; no account; no
  network requests.
- 131 of 132 features verified by browser tests ([SCOREBOARD.md](SCOREBOARD.md)).
