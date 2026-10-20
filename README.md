<div align="center">

<img src="assets/icons/icon.svg" width="88" alt="">

# Placard

### Design anything. Free, offline, yours.

An open-source alternative to Canva that runs entirely on your device.
No account. No upload. No watermark. No "Pro" wall.

**[Open Placard](https://manoharys.github.io/paperwall/)** · [download the one-file app](https://github.com/manoharys/paperwall/releases/latest) · [scoreboard](SCOREBOARD.md)

<img src="docs/assets/demo.gif" width="800" alt="Placard in use: pick a template, edit the headline, change the background gradient, add a sticker, resize the story to a square post, and download a transparent PNG with no watermark">

<sub>20 seconds, recorded from the real app by <code>scripts/record-demo.mjs</code> · <a href="docs/assets/demo.mp4">MP4</a></sub>

</div>

---

Posters, social posts, invitations, menus, thumbnails and slides, made in
your browser. Placard is **one HTML file**: open it once and it works offline,
on a plane, forever. Your photos never leave your computer, because the page
is not allowed to send anything anywhere: its security policy blocks every
network request, and the browser enforces that.

## What's free here

All of it. Including the things other tools put behind a subscription:

- **Transparent PNGs**, and PNGs at 2x and 3x size
- **Resize a design** to another format in one click (post → story → slides)
- **A brand kit**: your colors and fonts, applied in one click
- **Multi-page PDF with selectable text**, SVG with fonts inside, JPG, a zip of pages, print
- **Charts, tables, QR codes**, and removing plain backgrounds, all on your device
- **No watermark, ever**, and no account

## The scoreboard

Every feature in [`features.json`](features.json) is either **verified by an
end-to-end test in a real browser** or listed as **not done yet**. This table
is generated from the test run, never written by hand.

<!-- scoreboard:start -->
**131 of 132 features verified** by browser tests · 1 not done yet · [full scoreboard](SCOREBOARD.md)

| Area | Verified |
| --- | --- |
| Designs | 11 / 11 |
| Pages | 8 / 8 |
| Viewing | 5 / 5 |
| Selecting and moving | 13 / 13 |
| Editing | 18 / 18 |
| Text | 20 / 20 |
| Shapes and lines | 8 / 8 |
| Images | 12 / 13 |
| Graphics | 6 / 6 |
| Color | 4 / 4 |
| Brand kit | 3 / 3 |
| Templates | 5 / 5 |
| Export | 12 / 12 |
| The app | 6 / 6 |

Not done yet: remove an image's background on your device.
<!-- scoreboard:end -->

## Use it

- **In your browser:** [manoharys.github.io/paperwall](https://manoharys.github.io/paperwall/). Install it from the address bar to get an app that works offline.
- **As one file:** download `placard.html` from the [latest release](https://github.com/manoharys/paperwall/releases/latest) and double-click it. That's the whole app (under 1 MB, fonts included).
- **From source:**

  ```bash
  git clone https://github.com/manoharys/paperwall placard && cd placard
  npm run dev        # http://127.0.0.1:5173, no install needed
  npm run build      # dist/placard.html and the hostable site
  ```

There are no dependencies. Node 20+ runs the dev server and the build; the
end-to-end tests use Playwright.

## How it's built

- **Plain JavaScript, no framework, no dependencies.** The design model,
  edits, undo, text layout and the SVG renderer are pure functions with unit
  tests (`src/model`). The editor is a thin layer on top (`src/app`).
- **One renderer.** The page you edit and every file you download come from
  the same SVG renderer, so what you see is what you get.
- **Everything on your device.** Designs, uploads and your brand kit live in
  your browser's storage. PNG, JPG, PDF and zip files are made in the page.
  There's a QR code generator, a PDF writer and a zip writer in here, all
  small and tested.
- **Fonts:** 14 open-license families (SIL OFL / Apache 2.0), bundled.

## Compared with Canva

Placard covers making a static design on your own, start to finish. It has
no stock library, AI, video, collaboration or cloud. The honest,
area-by-area comparison is in [docs/PARITY.md](docs/PARITY.md).

## Contributing

Templates, icons and translations are the best place to start. See
[CONTRIBUTING.md](CONTRIBUTING.md); the clean-room rules apply to everyone.

## Clean room, on purpose

Placard is built from scratch. We never look at, download, decompile or
analyze another company's code, network traffic or files, and we don't copy
their templates, fonts, icons, illustrations, text or look. The rules are in
[CLEAN_ROOM.md](CLEAN_ROOM.md). Every template, icon and sticker was made for
Placard.


## License

[MIT](LICENSE) © 2026 Manohar. Templates, icons and stickers made for Placard
are dedicated to the public domain ([CC0](https://creativecommons.org/publicdomain/zero/1.0/)),
so you can use them in anything, including commercial work. Bundled fonts keep
their own open licenses ([assets/fonts/LICENSES.md](assets/fonts/LICENSES.md)).

Canva is a trademark of Canva Pty Ltd. Placard is an independent project and
is not affiliated with, endorsed by, or sponsored by Canva. See
[TRADEMARKS.md](TRADEMARKS.md).
