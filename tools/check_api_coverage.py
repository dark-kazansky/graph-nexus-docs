#!/usr/bin/env python3
"""Guard against documentation/source drift for the public API surface.

Both directions, for `GraphNexus`, `Chart`, `Graph`, `Combo`, `TimeBar`, `Map`:
every top-level member documented in graph-nexus/api.html must be declared on
the matching object in the SDK's src, and every member declared in src must be
documented (except INTERNAL). Reads static declarations only (no execution) and
exits non-zero on drift.

Nested option paths, events, options and item-format objects are
documentation-only shapes and are not checked.
"""
import os
import re
import sys
from sdk_path import sdk_root

DOCS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(sdk_root(DOCS), 'src')
API_HTML = os.path.join(DOCS, 'graph-nexus', 'api.html')

# Documented object -> (source file, regex isolating the object literal body, member indent).
# ponytail: regex slicing of object literals, switch to acorn if the src layout gets fancier.
OBJECTS = {
    'GraphNexus': ('graph-nexus.js', r'\nconst base = \{(.*?)\n\};', 2),
    'Chart': ('graph-nexus.js', r'\n  const api = \{(.*?)\n  \};', 4),
    'Graph': ('graph-nexus.js', r'function createGraphFacade.*?return \{(.*?)\n  \};', 4),
    'Combo': ('engine/combos.js', r'const api = \{(.*?)\n  \};', 4),
    'TimeBar': ('engine/timebar.js', r'const api = \{(.*?)\n  \};', 4),
    'Map': ('engine/map.js', r'const api = \{(.*?)\n  \};', 4),
}
# Declared in src but intentionally not public API.
INTERNAL = {'toString', 'reload'}
# Members declared at the object's own depth: `name(`, `async name(`, `name:`, `name,`.
MEMBER = r'^ {%d}(?:async )?([A-Za-z_$][\w$]*)\s*(?:\(|:|,)'


def documented_members():
    html = open(API_HTML, encoding='utf-8').read()
    members = {obj: set() for obj in OBJECTS}
    for anchor in re.findall(r'class="api-symbol" id="([^"]+)"', html):
        parts = anchor.split('_')
        if len(parts) == 2 and parts[0] in members:
            members[parts[0]].add(parts[1])
    return members


def source_members(obj):
    path, pattern, indent = OBJECTS[obj]
    src = open(os.path.join(SRC, path), encoding='utf-8').read()
    m = re.search(pattern, src, re.S)
    if not m:
        sys.exit(f'check_api_coverage: cannot find {obj} object in src/{path}')
    found = set(re.findall(MEMBER % indent, m.group(1), re.M))
    if not found:
        sys.exit(f'check_api_coverage: no members parsed for {obj} in src/{path}')
    return found


def main():
    docs = documented_members()
    src = {obj: source_members(obj) for obj in OBJECTS}
    missing = [f'{obj}.{name}' for obj in OBJECTS for name in sorted(docs[obj] - src[obj])]
    undocumented = [f'{obj}.{name}' for obj in OBJECTS for name in sorted(src[obj] - docs[obj] - INTERNAL)]
    for sym in missing:
        print(f'DRIFT: documented {sym} has no source counterpart')
    for sym in undocumented:
        print(f'DRIFT: source {sym} is not documented (add it to src/graph-nexus.d.ts)')
    checked = sum(len(v) for v in docs.values())
    print(f'checked {checked} documented members across '
          f'{len(OBJECTS)} objects, {len(missing) + len(undocumented)} drift(s)')
    return 1 if missing or undocumented else 0


if __name__ == '__main__':
    sys.exit(main())
