# Paperwall and Canva, honestly

Canva is a huge product: a design editor, a content library, AI tools, video,
whiteboards, documents, websites, team collaboration and printing. Paperwall is
one part of that: **a design editor for one person** (posters, posts,
invitations, menus, thumbnails, slides, animated posts, documents and
whiteboards), running entirely on your device.

So the honest answer to "do we have parity with Canva?" is:

- **For making a static design on your own, start to finish: yes, the core
  is there**, and every piece of it is verified by a browser test
  ([SCOREBOARD.md](../SCOREBOARD.md)).
- **For everything Canva does: no.** Its stock photos and AI are opt-in
  extras that use free providers or your own key (no hosted library, no
  image generation), it has no real-time collaboration and no cloud, and
  its video editing is basic (videos and a soundtrack in animated designs, no timeline editor).
  Some of that is on the roadmap; some of it (the cloud) is left out on
  purpose.

Below, 32 capability areas, compared at the level of what a person can do.
Canva's side is described from its public product pages in general terms;
check them for current details. "Partial" means Paperwall does the job in a
smaller way.

## Count

| | Areas |
| --- | --- |
| Paperwall does it | 20 |
| Partly | 7 |
| Not yet | 5 |

## The core editor

| Area | Paperwall | Notes |
| --- | --- | --- |
| Size presets and custom sizes (px, mm, in) | ✅ | 13 presets |
| Text: fonts, size, styles, spacing, lists, effects, curved text | ✅ | 23 text features verified, including lift, hollow, splice, echo, glitch, glow and neon effects and ready-made combinations |
| Shapes, lines, arrows, gradients, borders | ✅ | gradients with up to eight colors |
| Photo frames and photo grids | ✅ | nine frame shapes, twelve grid layouts |
| Freehand drawing | ✅ | pen, marker, highlighter |
| Connector lines that stay attached | ✅ | straight, elbow, curved |
| Rulers, guides, grid, margins, print bleed | ✅ | |
| Find and replace, spell check | ✅ | |
| Page titles, hidden pages, page grid view | ✅ | |
| Version history | ✅ | kept on your device |
| Images: add, drag in, paste, crop, filters, duotone, frames, replace | ✅ | |
| Layers, align, distribute, group, lock, flip, transparency | ✅ | |
| Undo/redo, copy/paste, duplicate, keyboard shortcuts | ✅ | |
| Snapping with guides | ✅ | to the page and to other elements |
| Multiple pages, reorder, present full screen | ✅ | |
| Resize a design to another format | ✅ | free |
| Brand kit (colors, fonts, apply in one click) | ✅ | free, saved on your device |
| Charts and tables | ✅ | bar, line, pie, donut |
| QR codes | ✅ | made on your device |
| Remove a plain background | ✅ | logos, product shots on white |
| Remove the background of any photo | ✅ | a small open-license model, downloaded once with your OK, run on your device |
| Download PNG (1–3x, transparent), JPG, SVG, PDF, print, clipboard | ✅ | free, no watermark |
| Vector PDF with embedded fonts | ✅ | shapes, gradients and photos as vectors and images; text in font subsets, selectable and searchable; effects come as pictures of just that element |
| Print PDF with bleed and crop marks | ✅ | 3 mm bleed, trim and bleed boxes, pictures at 300 DPI |
| PDF with selectable text (flattened) | ✅ | each page a picture plus a searchable text layer |
| PowerPoint download | ✅ | editable text boxes, shapes and pictures, speaker notes; effects, charts and icons as pictures; fonts aren't embedded |
| Works offline, no account | ✅ | Canva is an online service |
| Your files never leave your device | ✅ | enforced by the browser's security policy |
| Phone and tablet | ✅ | installable web app, touch editing |
| Open source and free forever | ✅ | MIT |

## Smaller than Canva

| Area | Paperwall | Notes |
| --- | --- | --- |
| Templates | 🟡 | 397 original templates in 44 categories, including multi-page decks, calendars, menus and planners. Canva's library is still far larger. |
| Fonts | 🟡 | 92 open-license families with a searchable picker, plus your own font files |
| Icons and graphics | 🟡 | 1,956 icons (our own plus Lucide) and 198 stickers |
| Presentations | 🟡 | present full screen with transitions and animations; speaker notes and a presenter view (next page, notes, timer, slides in their own window); no recording |
| Documents | 🟡 | headings, paragraphs, lists and pictures that flow down the page and print on sheets; no tables of contents or page numbers yet |
| Stock photos | 🟡 | opt-in: Openverse (no key), Unsplash and Pexels (your key), each photo with its credit; no video library |
| AI tools | 🟡 | opt-in, your own key or a local model: write, rewrite, shorten, translate text, describe a design and get an editable one; no image generation |
| Whiteboards | 🟡 | a canvas that grows, sticky notes in six colors, lines between things; no voting, timers or templates for workshops yet |

## Not in Paperwall (yet)

| Area | Plan |
| --- | --- |
| Video, animation, GIF/MP4 export | Done in v0.4: element and page animations, transitions, page timing, videos and a soundtrack, and GIF, MP4 and WebM downloads. Not yet: a timeline editor, cutting clips, video sound. |
| Real-time collaboration, comments, share links | Not planned: there's no server. You can send the design file. |
| Cloud sync across devices | Left out on purpose. Save to a file to move a design. |
| Websites, social scheduling, print ordering | Out of scope. |

