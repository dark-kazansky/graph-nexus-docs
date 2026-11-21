#!/usr/bin/env python3
"""Generate documentation landing pages (card grids) from tools/nav.json.

Replaces the standalone Timeline monolithic docs.html and the bare meta-refresh
stub that stood in for the Nexus documentation home.
"""
import html
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BLURB = {
    'graph-nexus': (
        'Nexus is a JavaScript SDK for network visualization and timelines. These guides '
        'cover installation, the chart, time bar and timeline components, styling, layouts '
        'and the graph analytics behind them.'),
    'timeline': (
        'The Timeline is the timeline visualization component included in Graph Nexus. '
        'These guides cover installation, entities and events, time handling, styling '
        'and integration with Nexus.'),
}

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<link rel="stylesheet" href="{css}">
</head>
<body>
<main class="doc-content">
<h1>{h1}</h1>
<p class="lede">{blurb}</p>
{sections}
</main>
</body>
</html>
"""


def card_grid(product, variant, groups, prefix):
    out = []
    for group in groups:
        pages = [p for p in group['pages']
                 if p['href'] not in ('docs.html', 'index.html')
                 and os.path.exists(os.path.join(
                     ROOT, product['dir'],
                     (variant if os.path.exists(os.path.join(
                         ROOT, product['dir'], variant or '', p['href']))
                      else p.get('sharedVariant', variant)) or '',
                     p['href']))]
        if not pages:
            continue
        out.append(f'<h2>{html.escape(group["title"])}</h2>')
        out.append('<div class="doc-cards">')
        for page in pages:
            href = prefix + page['href']
            if (variant and page.get('sharedVariant')
                    and not os.path.exists(os.path.join(
                        ROOT, product['dir'], variant, page['href']))):
                href = f'../{page["sharedVariant"]}/{page["href"]}'
            out.append(f'<a class="doc-card" href="{href}">'
                       f'<span class="doc-card-title">'
                       f'{html.escape(page["title"])}</span></a>')
        out.append('</div>')
    return '\n'.join(out)


def main():
    manifest = json.load(open(os.path.join(ROOT, 'tools/nav.json'),
                              encoding='utf-8'))
    written = []
    for product in manifest['products']:
        for variant in product.get('variants') or [None]:
            target_dir = os.path.join(ROOT, product['dir'], variant or '')
            label = product.get('variantLabels', {}).get(variant)
            # One documentation set: Timeline is a section of Nexus Documentation.
            heading = 'Nexus Documentation' if not variant else product['name']
            depth = '../../' if variant else '../'
            body = PAGE.format(
                title=f'{heading} | Graph Nexus',
                css=depth + 'assets/doc.css',
                h1=html.escape(heading + (f' ({label})' if label else '')),
                blurb=html.escape(BLURB[product['id']]),
                sections=card_grid(product, variant, product['groups'], '') + ''.join(
                    # The Nexus home also lists the Timeline guides that ship in the same package.
                    '\n' + card_grid(other, other['variants'][0], other['groups'],
                                     os.path.relpath(os.path.join(ROOT, other['dir'], other['variants'][0]),
                                                     os.path.join(ROOT, product['dir'])) + '/')
                    for other in manifest['products']
                    if other is not product and not variant and other.get('variants')),
            )
            path = os.path.join(target_dir,
                                'docs.html' if variant else 'index.html')
            open(path, 'w', encoding='utf-8').write(body)
            written.append(os.path.relpath(path, ROOT))
    print('landing pages:', ', '.join(written))


if __name__ == '__main__':
    main()
