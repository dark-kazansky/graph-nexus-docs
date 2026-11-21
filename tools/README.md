# Documentation build

The docs are static HTML with no runtime dependencies. `site/index.html` is the
single landing page for both products and links directly to each documentation
home and API reference. Page **content** lives in
the page files themselves; everything around it (header, sidebar, table of
contents, prev/next, footer, search) is generated.

```
sh tools/build.sh
```

Safe to run repeatedly — it is idempotent, and it fails loudly if any internal
link or anchor breaks.

## Single source of truth

| File | Owns |
| --- | --- |
| `tools/nav.json` | Section order, page order, page titles, product variants |
| `assets/doc.css` | All styling for docs and product pages |
| `assets/docs.js` | Mobile nav drawer, TOC scroll-spy, search |
| `assets/search-index.js` | Generated — do not edit |

To add a page: create the file with a `<main class="doc-content">` body, add an
entry to `nav.json`, and run the build.

## Pipeline

`build.sh` runs these in order:

0. **`make_signatures.py`** — generates `graph-nexus/api-signatures.html`, every
   public member with its signature from the SDK's `src/graph-nexus.d.ts`.
1. **`make_api_index.py`** — builds `graph-nexus/api.html`, an index of every API
   symbol the guides reference, and rewrites reference links to point at it.
2. **`make_landing.py`** — regenerates the documentation home card grids from
   `nav.json`.
3. **`build_docs.py`** — the main generator. For each page it extracts the body,
   normalises it, and re-emits the shell:
   - re-levels headings so nesting is gap-free (`h1` → `h2` → `h3`)
   - gives every heading an id plus a hover anchor link
   - turns same-page links into `#fragment` anchors
   - unwraps dead legacy wrappers, converts inline image styles to classes
   - converts the old show/hide widgets to native `<details>`
   - builds the sidebar, on-page TOC, prev/next links and the search index
4. **`check_links.py`** — verifies every internal href/src and anchor resolves.
5. **`check_api_coverage.py`** — for `GraphNexus`, `Chart`, `Graph`, `Combo`,
   `TimeBar` and `Map`: fails if a member listed in `api.html` is not declared in
   the SDK's `src` (`graph-nexus.js`, `engine/*.js`), or a public src member is not
   documented.

## The SDK

`make_signatures.py`, `check_api_coverage.py` and the screenshot / GIF scripts read or run the
Graph Nexus SDK, which lives in its own repository. Set `GRAPH_NEXUS_SDK` to its folder, or check
it out next to this repository (`../graph-nexus`). Run every command from this repository's root.

## Screenshots

`make_3d_screenshots.mjs` redraws the `3d-*.png` figures of `features/3d-view.html` with
the current library (headless Chromium via Playwright): `node tools/make_3d_screenshots.mjs`.

`make_landing_gifs.mjs` records the animated feature GIFs in `site/assets/` for the home page
from the app's main content only (no panels). It plays scripted clicks and zooms on the
demos in the SDK's `Examples/` and needs ffmpeg: `node tools/make_landing_gifs.mjs`, or pass
scene names to redo some.
The hero is a 60 fps MP4 recorded on Playwright's fake clock (one exact 1/60 s step per
frame). After re-recording it, refresh the WebM fallback:
`ffmpeg -i site/assets/hero.mp4 -c:v libvpx-vp9 -crf 32 -b:v 0 -an site/assets/hero.webm`.
