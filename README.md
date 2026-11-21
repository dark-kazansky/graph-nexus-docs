# Graph Nexus documentation

Source of the Graph Nexus documentation site, published with GitHub Pages from this repository:
https://dark-kazansky.github.io/graph-nexus-docs/

The site is static HTML, CSS and JavaScript: `site/` is the home page, `graph-nexus/` the guides
and API reference, `assets/` shared styles, scripts and the search index.

## Editing

Edit page content in place, then rebuild the shells, navigation, search index and checks:

    sh tools/build.sh

Some tools read or render the SDK (the API signatures page, the API coverage check, screenshots
and GIFs). The SDK is a separate repository: set `GRAPH_NEXUS_SDK` to its folder, or check it out
next to this one (`../graph-nexus`). See `tools/README.md`.

Pushing to `main` republishes the site (GitHub Pages, about a minute).
