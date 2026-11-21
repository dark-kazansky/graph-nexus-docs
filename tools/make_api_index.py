#!/usr/bin/env python3
"""Build a local Nexus API index and point the docs at it.

The Nexus guides referenced 445 API symbols through an external
reference.htm URL that this bundle cannot serve. This script harvests every
referenced symbol, the wording the guides use for it, and which guides mention
it, then emits graph-nexus/api.html and rewrites the links to stay local.

It does not invent signatures or parameter lists — it records only what the
guides themselves state.
"""
import collections
import glob
import html
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Matches both the original external reference links and the local ones this
# script produces, so it can be re-run safely.
LINK = re.compile(
    r'<a href="(?:https://nexusgraph\.io/reference\.htm|'
    r'(?:\.\./)*api\.html)#([^"]+)"[^>]*>(.*?)</a>', re.S)

OBJECT_ORDER = ['GraphNexus', 'Chart', 'ChartOptions', 'ChartEvents',
                'ItemFormat', 'Combo', 'Graph', 'TimeBar', 'TimeBarOptions',
                'TimeBarEvents', 'Map', 'MapOptions']

OBJECT_BLURB = {
    'GraphNexus': 'Entry point for creating components and global helpers.',
    'Chart': 'Methods on a chart instance returned by GraphNexus.create().',
    'ChartOptions': 'Options that control chart appearance and behaviour.',
    'ChartEvents': 'Events a chart raises, subscribed to with chart.on().',
    'ItemFormat': 'The shape of node, link, glyph and label objects you load.',
    'Combo': 'Methods for grouping, nesting and expanding combos.',
    'Graph': 'The chart-independent graph engine used for analysis.',
    'TimeBar': 'Methods on a time bar instance.',
    'TimeBarOptions': 'Options that control time bar appearance and behaviour.',
    'TimeBarEvents': 'Events raised by the time bar.',
    'Map': 'Methods available in map mode.',
    'MapOptions': 'Options that control map mode.',
}


def pages():
    return sorted(glob.glob(os.path.join(ROOT, 'graph-nexus/*/*.html'))
                  + glob.glob(os.path.join(ROOT, 'graph-nexus/*.html')))


def page_title(path):
    src = open(path, encoding='utf-8').read()
    m = re.search(r'<h1[^>]*>(.*?)</h1>', src, re.S)
    return html.unescape(re.sub(r'<[^>]+>', '', m.group(1))).strip() if m else \
        os.path.basename(path)


def symbol_name(anchor):
    parts = anchor.split('_')
    return '.'.join(parts)


def same_symbol(text, anchor):
    """True when the link wording adds nothing beyond the symbol name."""
    def key(s):
        return re.sub(r'[^a-z0-9]', '', s.lower())
    return key(text) == key(symbol_name(anchor)) or key(text) == key(
        symbol_name(anchor).split('.')[-1])


def main():
    labels = collections.defaultdict(collections.Counter)
    sources = collections.defaultdict(set)
    titles = {}

    for path in pages():
        if os.path.basename(path) == 'api.html':
            continue
        src = open(path, encoding='utf-8').read()
        found = LINK.findall(src)
        if not found:
            continue
        titles[path] = page_title(path)
        for anchor, text in found:
            text = re.sub(r'\s+', ' ',
                          html.unescape(re.sub(r'<[^>]+>', '', text))).strip()
            if text:
                labels[anchor][text] += 1
            sources[anchor].add(path)

    grouped = collections.defaultdict(list)
    for anchor in sorted(sources, key=str.lower):
        grouped[anchor.split('_')[0]].append(anchor)

    order = [o for o in OBJECT_ORDER if o in grouped]
    order += sorted(o for o in grouped if o not in OBJECT_ORDER)

    body = ['<h1>Nexus API Index</h1>',
            '<p class="lede">Every Nexus API symbol referred to by these '
            'guides, grouped by object, with the guides that describe each '
            'one.</p>',
            '<div class="notice"><div class="boxout"><div class="boxout-icon">'
            '</div><div class="boxout-body"><p>This index records the symbols '
            'the guides reference and where they are explained. It is not a '
            'full signature reference: parameter lists and return types are '
            'documented in the guide pages linked beside each entry.</p>'
            '</div></div></div>']

    for obj in order:
        anchors = grouped[obj]
        body.append(f'<h2 id="{obj}">{html.escape(obj)}</h2>')
        if obj in OBJECT_BLURB:
            body.append(f'<p>{html.escape(OBJECT_BLURB[obj])}</p>')
        body.append(f'<p class="api-count">{len(anchors)} referenced '
                    f'{"symbol" if len(anchors) == 1 else "symbols"}</p>')
        for anchor in anchors:
            gloss = labels[anchor].most_common(1)
            gloss = gloss[0][0] if gloss else ''
            links = ' · '.join(
                f'<a href="{os.path.relpath(p, os.path.join(ROOT, "graph-nexus"))}">'
                f'{html.escape(titles[p])}</a>'
                for p in sorted(sources[anchor], key=lambda x: titles[x]))
            body.append(
                f'<div class="api-symbol" id="{html.escape(anchor)}">'
                f'<div class="sig">{html.escape(symbol_name(anchor))}</div>'
                + (f'<p class="api-gloss">{html.escape(gloss)}</p>'
                   if gloss and not same_symbol(gloss, anchor) else '')
                + f'<p class="api-sources"><span class="label">Described in'
                  f'</span> {links}</p></div>')

    out = os.path.join(ROOT, 'graph-nexus/api.html')
    open(out, 'w', encoding='utf-8').write(
        '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n'
        '<title>Nexus API Index | Graph Nexus</title>\n'
        '<link rel="stylesheet" href="../assets/doc.css">\n</head>\n<body>\n'
        '<main class="doc-content">\n' + '\n'.join(body) +
        '\n</main>\n</body>\n</html>\n')
    print(f'graph-nexus/api.html: {sum(len(v) for v in grouped.values())} '
          f'symbols across {len(order)} objects')

    # Point the guides at the local index instead of the unreachable host.
    rewritten = 0
    for path in pages():
        if os.path.basename(path) == 'api.html':
            continue
        src = open(path, encoding='utf-8').read()
        depth = os.path.relpath(os.path.join(ROOT, 'graph-nexus/api.html'),
                                os.path.dirname(path))
        new, n = re.subn(r'https://nexusgraph\.io/reference\.htm#',
                         depth.replace(os.sep, '/') + '#', src)
        new, n2 = re.subn(r'https://nexusgraph\.io/reference\.htm(?=")',
                          depth.replace(os.sep, '/'), new)
        if new != src:
            open(path, 'w', encoding='utf-8').write(new)
            rewritten += n + n2
    print(f'rewrote {rewritten} reference links to the local index')

    nav_path = os.path.join(ROOT, 'tools/nav.json')
    manifest = json.load(open(nav_path, encoding='utf-8'))
    for product in manifest['products']:
        if product['id'] != 'graph-nexus':
            continue
        overview = product['groups'][0]['pages']
        if not any(p['href'] == 'api.html' for p in overview):
            overview.append({'href': 'api.html', 'title': 'API Index'})
    json.dump(manifest, open(nav_path, 'w', encoding='utf-8'), indent=2)
    print('nav.json updated')


if __name__ == '__main__':
    main()
