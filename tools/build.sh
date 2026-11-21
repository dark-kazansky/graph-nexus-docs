#!/bin/sh
# Rebuild the documentation site. Run from the repository root:
#     sh tools/build.sh
#
# tools/nav.json is the single source of truth for navigation. Page bodies live
# in the page files themselves; this script regenerates every surrounding shell.
set -e
cd "$(dirname "$0")/.."

python3 tools/make_signatures.py  # API signatures page from the SDK's src/graph-nexus.d.ts
python3 tools/make_api_index.py   # Nexus API index + local reference links
python3 tools/make_landing.py     # documentation home / card grids
python3 tools/build_docs.py "$@"  # page shells, nav, TOC, prev/next, search index
python3 tools/check_links.py      # fail loudly on broken internal links
python3 tools/check_api_coverage.py  # fail loudly on documented-API / source drift
