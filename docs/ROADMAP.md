# Road to a real Canva alternative

The bar: someone who uses Canva for everyday work can switch to Paperwall
and not miss much. The repository stays private until this checklist is
done. Each release is a pull request: built on its own branch, reviewed,
tested, then merged. A box is ticked only when the scoreboard verifies it.

Decisions so far: optional online features are allowed but **off by
default**, clearly labeled, and never needed for the core app. Approved:
free stock photos (Openverse), AI with your own Claude API key, and
on-device AI models. Not approved: a collaboration server.

## v0.2 Library: enough to start from

- [x] 300+ original templates across 30+ categories, each checked by a
      quality gate (no text overflow, nothing off the page, readable contrast)
      (TPL-06, TPL-08: 397 templates, 44 categories)
- [x] Multi-page template sets: presentations, resumes, menus, planners (TPL-07)
- [x] 60+ open-license font families (TXT-21: 92 families)
- [x] 1,500+ icons (open-license set) plus Paperwall's own (ELM-07: 1,956)
- [x] More stickers, shapes, frames and decorative elements (ELM-08: 198 stickers)
- [x] Template browser: categories, sizes, search, previews (TPL-01, TPL-02, TPL-09)

## v0.3 Editor pro

- [x] Photo frames (shapes you drop a photo into) and grid collages (IMG-14, IMG-15)
- [x] More text effects: glow, hollow, echo, splice, lift, neon, glitch (TXT-22)
- [x] Ready-made text combinations (TXT-23)
- [x] Multi-stop gradients; duotone and more photo adjustments (CLR-05, IMG-16)
- [x] Freehand drawing (pen, marker, highlighter) (ELM-09)
- [x] Rulers, guides, margins, bleed, grid snapping (VIEW-06, VIEW-07)
- [x] Elbow and curved connector lines (ELM-10)
- [x] Find and replace text; spell check while editing (EDIT-19, EDIT-20)
- [x] Page grid view, hidden pages, page titles (PAGE-09 to PAGE-11)
- [x] Version history on your device (DOC-12)

## v0.4 Motion

- [x] Animations for elements and pages (fade, rise, pan, pop, typewriter…) (MOT-01, MOT-02)
- [x] Page timing and transitions; playing them (MOT-03, MOT-04)
- [x] Download as GIF and video (WebM/MP4) (MOT-05, MOT-06)
- [x] Video and audio elements (MOT-07, MOT-08)
- [x] Carried over from v0.3 review: a page-level connector whose two ends are both inside one turned group follows that group when it moves

## v0.5 Present, docs and whiteboards

- [ ] Presenter view with notes and a timer
- [ ] Documents: long text with headings, lists and images
- [ ] Whiteboards: infinite canvas, sticky notes, connectors
- [ ] Carried over from v0.4 review: keep pictures, videos and sounds in their own store (as files, not text inside each saved design), so big videos don't slow saving

## v0.6 Online extras (opt-in)

Give people every option they might want. Each online feature talks to a
swappable provider, and keys stay on the device and go only to the provider
picked. No ads, accounts or paid tiers.

- [ ] Stock photo search: Openverse (no key), Unsplash and Pexels (your key),
      with attribution
- [ ] AI writing: write, rewrite, shorten, translate, with Claude, OpenAI or
      Gemini (your key) or a local model through Ollama (no key)
- [ ] AI design: describe a design, get an editable one (same providers)
- [ ] Background removal for any photo, on-device model
- [ ] Provider settings: pick a provider per feature, test a key, forget keys

## v0.7 Pro export

- [ ] Vector PDF with embedded fonts
- [ ] Print PDF with bleed and crop marks
- [ ] PowerPoint (.pptx) download

## v0.8 Everyone

- [ ] Interface in 6+ languages
- [ ] Accessibility pass (screen reader, keyboard-only)
- [ ] Performance with 50+ pages and large photos

## Out of scope (by decision)

- Real-time collaboration, comments and shared links (no server)
- Cloud sync (save to a file instead)
- Printing and delivery services, websites, social scheduling
