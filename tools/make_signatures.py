#!/usr/bin/env python3
"""Generate graph-nexus/api-signatures.html from the SDK's src/graph-nexus.d.ts.

Lists every method and property of the public API objects with its exact
TypeScript signature, so no public member is undocumented. Each entry links to
api.html#Object_member, which make_api_index.py then indexes.
"""
import html
import os
import re
from sdk_path import sdk_root

DOCS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DTS = os.path.join(sdk_root(DOCS), 'src', 'graph-nexus.d.ts')
OUT = os.path.join(DOCS, 'graph-nexus', 'api-signatures.html')

# typings interface -> documented object name, with a short blurb
OBJECTS = [
    ('GraphNexusStatic', 'GraphNexus', 'The <code>GraphNexus</code> object: creates components and holds global settings.'),
    ('Chart', 'Chart', 'A chart, returned by <code>GraphNexus.create()</code>.'),
    ('Graph', 'Graph', 'Graph analysis, from <code>chart.graph()</code> or <code>GraphNexus.getGraphEngine()</code>.'),
    ('Combo', 'Combo', 'Combo operations, from <code>chart.combo()</code>.'),
    ('GraphMap', 'Map', 'Map mode, from <code>chart.map()</code>.'),
    ('TimeBar', 'TimeBar', "A time bar, returned by <code>GraphNexus.create({ type: 'timebar' })</code>."),
]
ASYNC_NOTE = ('Methods that return a <code>Promise</code> also accept a trailing callback, '
              'for example <code>chart.layout(\'organic\', {}, () =&gt; {})</code>.')


def interface_body(src, name):
    m = re.search(r'export interface ' + name + r'\b[^{]*\{', src)
    if not m:
        raise SystemExit(f'make_signatures: interface {name} not found in {DTS}')
    depth, i = 1, m.end()
    while depth:
        depth += {'{': 1, '}': -1}.get(src[i], 0)
        i += 1
    return src[m.end():i - 1]


def members(body):
    """Yield (name, [signature lines], doc) for each top-level member, in source order."""
    out, doc = {}, ''
    for line in body.split('\n'):
        stripped = line.strip()
        c = re.match(r'/\*\*(.*?)\*/', stripped)
        if c:
            doc = c.group(1).strip()
            continue
        if not line.startswith('  ') or line.startswith('   ') or not stripped:
            continue
        m = re.match(r'([A-Za-z_$][\w$]*)\??\s*[(:<]', stripped)
        if not m:
            continue
        entry = out.setdefault(m.group(1), [[], ''])
        entry[0].append(stripped.rstrip(';'))
        if doc:
            entry[1] = doc
        doc = ''
    return [(k, v[0], v[1]) for k, v in out.items()]


def main():
    src = open(DTS, encoding='utf-8').read()
    parts = ['<h1>API Signatures</h1>',
             '<p>Every public method and property, with its TypeScript signature from '
             '<code>graph-nexus.d.ts</code> (shipped in the package). Option and item shapes are in the typings '
             'and on the <a href="api.html">API Index</a>.</p>',
             f'<p>{ASYNC_NOTE}</p>']
    for iface, obj, blurb in OBJECTS:
        parts.append(f'<h2 id="{obj}">{obj}</h2><p>{blurb}</p>')
        for name, sigs, doc in members(interface_body(src, iface)):
            code = html.escape('\n'.join(sigs))
            parts.append(f'<h3 id="sig-{obj}_{name}"><a href="api.html#{obj}_{name}">{obj}.{name}</a></h3>')
            if doc:
                parts.append(f'<p>{html.escape(doc)}</p>')
            parts.append(f'<pre class="prettyprint"><code class="lang-ts">{code}</code></pre>')
    page = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n'
            '<title>API Signatures | Nexus</title>\n</head>\n<body>\n'
            '<main class="doc-content" id="content">\n' + '\n'.join(parts) +
            '\n<nav class="page-nav" aria-label="Previous and next page"></nav>\n</main>\n</body>\n</html>\n')
    open(OUT, 'w', encoding='utf-8').write(page)
    print(f'{os.path.relpath(OUT, DOCS)}: generated from graph-nexus.d.ts')


if __name__ == '__main__':
    main()
