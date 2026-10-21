# Changelog

## 0.8.0 (unreleased): Everyone

- The interface in nine languages: English, Spanish, French, German,
  Portuguese (Brazil), Hindi, Arabic, Japanese and Kannada. It follows the
  browser's language; a picker on the home screen and in the More menu
  changes it at once, and the choice is kept. Every button, label, tooltip,
  message and dialog is translated (by hand, checked key by key in a unit
  test); numbers, dates, plurals and "3 minutes ago" are written the local
  way. New text boxes start in your language; what you write and the
  templates stay as they are.
- Arabic reads right to left: the panels, top bar and page strip are
  mirrored, while the page you design keeps its own layout.
- Works with a keyboard alone: a "skip to the canvas" link; on the canvas,
  N and Shift+N pick elements one at a time (Tab moves on, as anywhere
  else), the arrow keys move them
  and Alt with the arrow keys resizes them; Enter and Space press the
  focused button; the color picker opens on its hex code; the Layers list is
  a list of buttons.
- Works with screen readers: every control has a name, dialogs are labelled
  and keep focus inside until closed (then give it back), and what's
  selected, the page you're on and every message are announced.
- Easier to see: visible focus rings everywhere, and accent text and buttons
  at WCAG AA contrast in light and dark modes. With "reduce motion" set,
  the interface stops animating.
- Stays quick with 50+ pages, long documents and large photos: only what
  changed is redrawn, page thumbnails are drawn as they scroll into view,
  previews come from smaller copies of photos, and GIF and video downloads
  draw still layers once and video frames straight to the canvas. In
  Safari, plain videos play live when presenting.

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
- Documents come as their sheets in every PDF (vector, flattened and print)
  and as a slide a sheet in PowerPoint. Sticky notes stay notes of their
  color with editable text, and videos show their full-size still.
- Written from the public specs: deflate, a Brotli decoder and a WOFF2 font
  reader (to embed the bundled fonts), a TrueType subsetter, and the PDF and
  PowerPoint writers.

## 0.6.0 (unreleased): Online extras, all opt-in

Nothing here goes online until you turn it on, and each one talks only to
the provider you pick. Keys stay on your device. No ads, no accounts.

- Stock photos: search Openverse (no key), or Unsplash and Pexels with your
  own key. Each photo keeps its credit (creator, license, source), shown
  with a "Copy credit" button.
- AI writing: write, rewrite, shorten, lengthen, fix, change the tone of or
  translate a text box, with Claude, OpenAI or Gemini (your key) or a model
  on your own computer through Ollama. One undo step each.
- AI design: describe a design and get an editable one (or three to pick
  from), with Paperwall's own fonts and icons.
- Background removal for any photo, by a small open-license model
  (U²-Net small, 4.6 MB) downloaded once with your OK and run on your
  device by Paperwall's own engine.
- Online extras settings: turn each on or off, pick a provider, test a key,
  forget all keys.
- The page's security policy lists exactly these providers' addresses and
  nothing else.

## 0.5.0 (unreleased): Present, docs and whiteboards

- Speaker notes for each page, and a presenter view: the slides in a
  window of their own (drag it to the projector) and, for you, the page
  now, the next one, its notes and a timer.
- Documents: headings, paragraphs, lists and pictures flow down the page
  as you write; drag a block above or below another to move it. PDF and
  print split it into sheets between blocks.
- Whiteboards: a canvas that grows as you add to it, sticky notes in six
  colors, and lines between things.
- Files (pictures, videos, sounds, fonts) are stored apart from each saved
  design, once, so big videos don't slow saving or the home screen.
- A video's still picture is taken full size from where it starts.
- GIF and video downloads of pages with big photos are quicker: each photo
  is made only as big as the frames can show, once.

## 0.4.0: Motion

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
