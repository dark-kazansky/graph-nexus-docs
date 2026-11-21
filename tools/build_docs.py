#!/usr/bin/env python3
"""Rebuild every documentation page from tools/nav.json plus the page's own body.

Each page file is both source and output: the builder extracts the inner HTML of
<main class="doc-content">, normalises it, and re-emits the surrounding shell
(header, sidebar, table of contents, prev/next, footer). Running it twice is a
no-op, so it is safe to re-run after editing page content.

Usage:
    python3 tools/build_docs.py            # rebuild all pages + search index
    python3 tools/build_docs.py --check    # report what would change, write nothing
"""
import html
import json
import os
import re
import sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
        'meta', 'param', 'source', 'track', 'wbr'}
UNWRAP_CLASSES = {'row', 'anchor', 'kl-sidenavcontent', 'documentation',
                  'page-header', 'minianchor', 'text', 'flex-row',
                  'table-scroll'}
DROP_CLASSES = {'page-header'}


def slugify(text):
    text = html.unescape(re.sub(r'<[^>]+>', '', text)).strip().lower()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text).strip('-')
    return text or 'section'


class Normaliser(HTMLParser):
    """Cleans up the legacy body markup of one page."""

    def __init__(self, page_file):
        super().__init__(convert_charrefs=False)
        self.out = []
        self.page_file = page_file
        self.open_levels = []       # original heading levels of the ancestors
        self.headings = []          # (level, id, text) for the TOC
        self.stack = []             # open tags we actually emitted
        self.skip_depth = 0         # >0 while dropping a subtree
        self.skip_tag = None
        self.pending_id = None      # id lifted off a wrapper div
        self.heading = None         # {'level','id','buf'} while inside a heading
        self.used_ids = set()
        self.drop_list = False
        self.list_depth = 0

    # -- helpers ---------------------------------------------------------

    def emit(self, s):
        if not self.skip_depth:
            if self.heading is not None:
                self.heading['buf'].append(s)
            else:
                self.out.append(s)

    @staticmethod
    def attr_dict(attrs):
        return {k: (v if v is not None else '') for k, v in attrs}

    def next_heading_level(self, original):
        """Re-level headings so nesting is gap-free in document order.

        The legacy pages jump straight from h1 to h3 and mix h4/h5 arbitrarily.
        Tracking the ancestor levels as we go turns any such sequence into
        h1 -> h2 -> h3 with no skipped step, which is what assistive tech and
        the generated table of contents expect.
        """
        if original == 1:
            self.open_levels = []
            return 1
        while self.open_levels and self.open_levels[-1] >= original:
            self.open_levels.pop()
        self.open_levels.append(original)
        return min(len(self.open_levels) + 1, 6)

    def unique_id(self, base):
        candidate = base
        n = 2
        while candidate in self.used_ids:
            candidate = f'{base}-{n}'
            n += 1
        self.used_ids.add(candidate)
        return candidate

    BOOLEAN_ATTRS = {'hidden', 'open', 'disabled', 'checked', 'required',
                     'readonly', 'multiple', 'selected', 'autofocus'}

    def render_attrs(self, attrs):
        parts = []
        for key, value in attrs.items():
            if value == '' or value is None:
                # Drop empty leftovers like style=""; keep real boolean attrs.
                if key in self.BOOLEAN_ATTRS:
                    parts.append(f' {key}')
                continue
            parts.append(f' {key}="{html.escape(value, quote=True)}"')
        return ''.join(parts)

    def clean_image(self, attrs):
        """Turn per-image inline styles into reusable classes."""
        style = attrs.pop('style', '')
        classes = [c for c in attrs.get('class', '').split() if c]
        keep = []
        for decl in style.split(';'):
            if ':' not in decl:
                continue
            prop, value = [p.strip().lower() for p in decl.split(':', 1)]
            if prop == 'float' and value == 'right':
                classes.append('img-float-right')
            elif prop.startswith('border'):
                if 'framed' not in classes:
                    classes.append('framed')
            elif prop in ('width', 'max-width'):
                if value in ('100%', '100 %'):
                    classes.append('img-full')
                else:
                    keep.append(f'max-width:{value}')
            # margins and padding are handled by the stylesheet
        if keep:
            attrs['style'] = ';'.join(keep)
        if classes:
            attrs['class'] = ' '.join(dict.fromkeys(classes))
        return attrs

    def clean_href(self, value):
        """A link to this same page is an in-page anchor."""
        base = os.path.basename(self.page_file)
        m = re.match(r'^(?:[^"#]*/)?' + re.escape(base) + r'#(.+)$', value)
        if m:
            return '#' + m.group(1)
        return value

    # -- parser callbacks ------------------------------------------------

    def handle_starttag(self, tag, attrs):
        attrs = self.attr_dict(attrs)
        classes = set(attrs.get('class', '').split())

        if self.skip_depth:
            if tag == self.skip_tag and tag not in VOID:
                self.skip_depth += 1
            return

        # Drop the old inline "Contents" list; the right-hand TOC replaces it.
        if self.drop_list and tag == 'ul':
            self.skip_depth = 1
            self.skip_tag = 'ul'
            self.drop_list = False
            return

        # The variant toggle and heading anchors belong to the shell; drop any
        # that a previous build left behind so rebuilding stays idempotent.
        if classes & {'variant-toggle', 'heading-anchor', 'page-nav'}:
            self.skip_depth = 1
            self.skip_tag = tag
            return

        if tag == 'div':
            if classes & DROP_CLASSES:
                self.skip_depth = 1
                self.skip_tag = 'div'
                return
            if classes and classes <= UNWRAP_CLASSES:
                # Keep the anchor id — inbound links depend on it — by moving it
                # onto the heading that follows.
                if attrs.get('id'):
                    self.pending_id = attrs['id']
                self.stack.append(('div', False))
                return

        if re.fullmatch(r'h[1-6]', tag):
            new_level = self.next_heading_level(int(tag[1]))
            hid = attrs.get('id') or self.pending_id
            self.pending_id = None
            self.heading = {'level': new_level, 'id': hid, 'buf': [],
                            'attrs': attrs}
            return

        if tag == 'img':
            attrs = self.clean_image(attrs)
        if tag == 'a' and 'href' in attrs:
            attrs['href'] = self.clean_href(attrs['href'])
        if tag == 'table':
            self.emit('<div class="table-scroll">')

        self.emit(f'<{tag}{self.render_attrs(attrs)}>')
        if tag not in VOID:
            self.stack.append((tag, True))

    def handle_startendtag(self, tag, attrs):
        if self.skip_depth:
            return
        attrs = self.attr_dict(attrs)
        if tag == 'img':
            attrs = self.clean_image(attrs)
        if tag == 'a' and 'href' in attrs:
            attrs['href'] = self.clean_href(attrs['href'])
        self.emit(f'<{tag}{self.render_attrs(attrs)}>')

    def handle_endtag(self, tag):
        if self.skip_depth:
            if tag == self.skip_tag:
                self.skip_depth -= 1
                if not self.skip_depth:
                    self.skip_tag = None
            return

        if self.heading is not None and re.fullmatch(r'h[1-6]', tag):
            self.close_heading()
            return

        if self.stack and self.stack[-1][0] == tag:
            _, emitted = self.stack.pop()
            if emitted:
                self.emit(f'</{tag}>')
                if tag == 'table':
                    self.emit('</div>')
            return
        # Unbalanced close for a tag we unwrapped: ignore it.
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                for _ in range(len(self.stack) - 1 - i):
                    name, emitted = self.stack.pop()
                    if emitted:
                        self.emit(f'</{name}>')
                _, emitted = self.stack.pop()
                if emitted:
                    self.emit(f'</{tag}>')
                return

    def close_heading(self):
        h = self.heading
        self.heading = None
        inner = ''.join(h['buf'])
        text = re.sub(r'<[^>]+>', '', inner)
        text = html.unescape(text).strip()

        if h['level'] != 1 and text.lower() == 'contents':
            self.drop_list = True       # also drop the list that follows
            return

        level = h['level']
        attrs = dict(h['attrs'])
        attrs.pop('id', None)
        attrs.pop('class', None)

        if level == 1:
            self.out.append(f'<h1{self.render_attrs(attrs)}>{inner}</h1>')
            return

        hid = self.unique_id(h['id'] or slugify(text))
        attrs['id'] = hid
        anchor = (f'<a class="heading-anchor" href="#{hid}" '
                  f'aria-label="Link to this section">#</a>')
        self.out.append(
            f'<h{level}{self.render_attrs(attrs)}>{inner}{anchor}</h{level}>')
        self.headings.append((level, hid, text))

    def handle_data(self, data):
        if self.drop_list and data.strip():
            self.drop_list = False
        self.emit(data)

    def handle_entityref(self, name):
        self.emit(f'&{name};')

    def handle_charref(self, name):
        self.emit(f'&#{name};')

    def handle_comment(self, data):
        pass

    def close_all(self):
        while self.stack:
            name, emitted = self.stack.pop()
            if emitted:
                self.out.append(f'</{name}>')
        return ''.join(self.out)


def div_end(src, start):
    """Offset just past the </div> that closes the <div ...> opening at `start`."""
    depth = 0
    for m in re.finditer(r'<div\b|</div>', src[start:]):
        depth += 1 if m.group(0).startswith('<div') else -1
        if depth == 0:
            return start + m.end()
    return -1


EXPAND = re.compile(r'<div class="expandcontrol[^"]*"[^>]*'
                    r'data-collapse-target="#([^"]+)"[^>]*>')


def convert_disclosures(body):
    """Replace the old Bootstrap-style show/hide pair with native <details>.

    The original markup relied on a script and stylesheet that these pages never
    loaded, so the toggle did nothing and the panel was always open.
    """
    while True:
        m = EXPAND.search(body)
        if not m:
            return body
        control_end = div_end(body, m.start())
        if control_end == -1:
            return body
        label_html = body[m.end():control_end - len('</div>')]
        label = re.sub(r'<[^>]+>', '', label_html)
        label = re.sub(r'^\s*(Show|Hide)\s*', '', label).strip() or 'Details'

        panel = re.match(r'\s*<div class="collapse[^"]*"[^>]*>',
                         body[control_end:])
        if not panel:
            return body[:m.start()] + body[control_end:]
        panel_start = control_end + panel.start()
        panel_end = div_end(body, panel_start)
        inner = body[panel_start + panel.end() - panel.start():
                     panel_end - len('</div>')]
        body = (body[:m.start()]
                + f'<details class="disclosure" id="{m.group(1)}">'
                + f'<summary>{html.escape(label[0].upper() + label[1:])}'
                + '</summary>' + inner + '</details>'
                + body[panel_end:])


MAIN_OPEN = re.compile(r'<main[^>]*class="doc-content"[^>]*>')


def extract_body(src, label=''):
    m = MAIN_OPEN.search(src)
    if not m:
        raise ValueError(f'no <main class="doc-content"> in {label}')
    end = src.find('</main>', m.end())
    return src[m.end():end]


LEGACY_TABLE_CLASSES = ('table-bordered', 'table-hover', 'table-condensed',
                        'table-striped', 'span2', 'btn-large', 'btn-kl')


def strip_legacy(body):
    """Remove markup that depended on stylesheets these pages never loaded."""
    # Font Awesome placeholders with no icon font behind them.
    body = re.sub(r'<i class="fa[^"]*"\s*/?>\s*</i>', '', body)
    body = re.sub(r'<i class="fa[^"]*"\s*/>', '', body)
    # Bootstrap table/button modifiers with no rules behind them. Rewrite the
    # class attribute as a whole so surrounding text is never touched.
    def clean(match):
        kept = [c for c in match.group(1).split()
                if c not in LEGACY_TABLE_CLASSES]
        return f'class="{" ".join(kept)}"' if kept else ''

    return re.sub(r'class="([^"]*)"', clean, body)


def normalise(page_file, body):
    body = strip_legacy(body)
    body = convert_disclosures(body)
    parser = Normaliser(page_file)
    parser.feed(body)
    parser.close()
    content = parser.close_all()
    content = re.sub(r'\n{3,}', '\n\n', content).strip()
    return content, parser.headings


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------

SHELL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="{description}">
<link rel="icon" href="{root}assets/nexus-mark.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Exo+2:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=block">
<script>(function(){{var t;try{{t=localStorage.getItem('nexus-docs-theme')}}catch(e){{}}if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t);if(location.protocol!=='file:'){{var s=document.createElement('style');s.textContent='@media (prefers-reduced-motion: no-preference){{@view-transition{{navigation:auto}}}}';document.head.appendChild(s)}}}})()</script>
<link rel="stylesheet" href="{root}assets/doc.css">
</head>
<body data-root="{root}">
<a class="skip-link" href="#content">Skip to content</a>
<header class="site">
  <div class="logo">
    <a href="{root}site/index.html">
      <img class="logo-light" src="{root}assets/nexus-logo.png" alt="Graph Nexus" width="173" height="22"><img class="logo-dark" src="{root}assets/nexus-logo-white.png" alt="Graph Nexus" width="173" height="22">
    </a>
  </div>
  <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="doc-nav" aria-label="Documentation menu">
    <span aria-hidden="true">☰</span><span class="nav-toggle-label" aria-hidden="true">Docs</span>
  </button>
  <div class="doc-search header-search" role="search">
    <label class="sr-only" for="doc-search-input">Search documentation</label>
    <input id="doc-search-input" type="search" placeholder="Search guides and API  /" autocomplete="off">
    <ul class="search-results" role="listbox" aria-label="Search results"></ul>
  </div>
  <nav aria-label="Documentation">
    <a href="{root}site/index.html">Home</a>
    <a href="{root}graph-nexus/index.html" class="current">Documentation</a>
    <a class="gh-star" href="https://github.com/dark-kazansky/graph-nexus" target="_blank" rel="noopener" aria-label="Graph Nexus on GitHub (opens in a new tab)"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a>
  </nav>
  <div class="toggle-switch">
    <label class="switch-label">
      <input type="checkbox" class="checkbox" aria-label="Dark mode">
      <span class="slider" aria-hidden="true"></span>
    </label>
  </div>
</header>
<div class="doc-layout">
<nav class="doc-nav" id="doc-nav" aria-label="Graph Nexus documentation">
{sidebar}
</nav>
<main class="doc-content" id="content">
{toggle}{content}
{page_nav}
</main>
<aside class="doc-toc" aria-label="On this page">
{toc}
</aside>
</div>
<footer class="site">
  <p>Graph Nexus</p>
  <p class="legal">© 2026 Graph Nexus. All rights reserved.</p>
</footer>
<script src="{root}assets/search-index.js"></script>
<script src="{root}assets/docs.js"></script>
</body>
</html>
"""


def page_path(product, variant, href):
    parts = [product['dir']]
    if variant:
        parts.append(variant)
    parts.append(href)
    return '/'.join(parts)


def page_available(product, variant, page):
    return (exists(product, variant, page['href'])
            or bool(page.get('sharedVariant')
                    and exists(product, page['sharedVariant'], page['href'])))


def effective_variant(product, variant, page):
    """Resolve pages shared from one canonical variant."""
    if exists(product, variant, page['href']):
        return variant
    shared = page.get('sharedVariant')
    if shared and exists(product, shared, page['href']):
        return shared
    return None


def exists(product, variant, href):
    return os.path.exists(os.path.join(ROOT, page_path(product, variant, href)))


def render_sidebar(manifest, product, variant, page_href, root):
    """One sidebar for the whole site: Nexus and Timeline groups in a single list."""
    parts = []
    for other in manifest['products']:
        # Timeline pages come in plain JS and React flavours; keep the reader's flavour.
        other_variant = variant if variant in (other.get('variants') or []) else (
            (other.get('variants') or [None])[0])
        here = other is product
        for group in other['groups']:
            pages = [p for p in group['pages']
                     if page_available(other, other_variant, p)]
            if not pages:
                continue
            is_open = here and page_href in [p['href'] for p in pages]
            parts.append(
                f'<details class="doc-nav-group"{" open" if is_open else ""}>')
            parts.append(f'<summary>{html.escape(group["title"])}</summary><ul>')
            for page in pages:
                target_variant = effective_variant(other, other_variant, page)
                rel = root + page_path(other, target_variant, page['href'])
                current = (' class="current" aria-current="page"'
                           if here and page['href'] == page_href else '')
                parts.append(
                    f'<li><a href="{rel}"{current}>{html.escape(page["title"])}</a></li>')
            parts.append('</ul></details>')
    return '\n'.join(parts)


def render_toc(headings):
    tops = [h for h in headings if h[0] <= 3]
    if len(tops) < 2:
        return ''
    rows = ['<h2>On this page</h2>', '<ul>']
    for level, hid, text in tops:
        rows.append(
            f'<li class="lvl-{level}"><a href="#{hid}">{html.escape(text)}</a></li>')
    rows.append('</ul>')
    return '\n'.join(rows)


def render_page_nav(prev_entry, next_entry, root):
    """Entries are (product, variant, page) from one sequence spanning Nexus and Timeline."""
    if not prev_entry and not next_entry:
        return ''
    parts = ['<nav class="page-nav" aria-label="Previous and next page">']
    for entry, cls, word in ((prev_entry, 'prev', 'Previous'), (next_entry, 'next', 'Next')):
        if not entry:
            continue
        product, variant, page = entry
        href = root + page_path(product, effective_variant(product, variant, page), page['href'])
        parts.append(f'<a class="{cls}" href="{href}"><span class="dir">{word}</span>'
                     f'<span class="label">{html.escape(page["title"])}</span></a>')
    parts.append('</nav>')
    return '\n'.join(parts)


def render_toggle(product, variant, page_href, root):
    """Plain JS / React switch, shown only where both flavours exist."""
    if not variant:
        return ''
    others = [v for v in product['variants'] if exists(product, v, page_href)]
    if len(others) < 2:
        return ''
    labels = product.get('variantLabels', {})
    links = []
    for v in product['variants']:
        if v not in others:
            continue
        cls = ' class="current" aria-current="true"' if v == variant else ''
        href = root + page_path(product, v, page_href)
        links.append(f'<a href="{href}"{cls}>{html.escape(labels.get(v, v))}</a>')
    return ('<div class="variant-toggle" role="group" aria-label="Code variant">'
            f'{"".join(links)}</div>\n')


def first_paragraph(content):
    m = re.search(r'<p[^>]*>(.*?)</p>', content, re.S)
    if not m:
        return ''
    text = html.unescape(re.sub(r'<[^>]+>', '', m.group(1)))
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:155]


def plain_text(content, limit=1200):
    text = re.sub(r'<(script|style|pre)\b.*?</\1>', ' ', content, flags=re.S)
    text = html.unescape(re.sub(r'<[^>]+>', ' ', text))
    return re.sub(r'\s+', ' ', text).strip()[:limit]


def sequence(manifest, variant):
    """Reading order across the whole site: every product, in nav.json order.
    Variant-less pages are joined to the first Timeline flavour."""
    seq = []
    for product in manifest['products']:
        variants = product.get('variants') or [None]
        v = variant if variant in variants else variants[0]
        seq += [(product, v, p) for g in product['groups'] for p in g['pages']
                if page_available(product, v, p)]
    return seq


def neighbours(seq, product, page):
    i = next(k for k, (pr, _, pg) in enumerate(seq) if pr is product and pg is page)
    return (seq[i - 1] if i else None, seq[i + 1] if i + 1 < len(seq) else None)


def main():
    check = '--check' in sys.argv
    manifest = json.load(open(os.path.join(ROOT, 'tools/nav.json'),
                              encoding='utf-8'))
    index_entries = []
    changed = []

    for product in manifest['products']:
        for variant in product.get('variants') or [None]:
            flat = [(g, p) for g in product['groups'] for p in g['pages']
                    if page_available(product, variant, p)]
            seq = sequence(manifest, variant)
            primary = not variant or variant == (product.get('variants') or [None])[0]

            for i, (group, page) in enumerate(flat):
                # Shared pages participate in this variant's sidebar and
                # previous/next sequence, but are emitted only by their owner.
                if variant is not None and effective_variant(product, variant, page) != variant:
                    continue
                rel_path = page_path(product, variant, page['href'])
                # Depth of this page decides how far up the shared assets are.
                root = '../' * rel_path.count('/')
                path = os.path.join(ROOT, rel_path)
                src = open(path, encoding='utf-8').read()
                body = extract_body(src, rel_path)
                content, headings = normalise(page['href'], body)

                h1 = re.search(r'<h1[^>]*>(.*?)</h1>', content, re.S)
                heading_text = (
                    html.unescape(re.sub(r'<[^>]+>', '', h1.group(1))).strip()
                    if h1 else page['title'])
                label = product.get('variantLabels', {}).get(variant)
                # One documentation set: every page is part of Nexus Documentation.
                if heading_text.startswith('Nexus Documentation'):
                    title = heading_text
                else:
                    title = f'{heading_text} — Nexus Documentation'
                if label and f'({label})' not in title:
                    title += f' ({label})'

                page_html = SHELL.format(
                    title=f'{title} | Graph Nexus',
                    description=html.escape(first_paragraph(content), quote=True),
                    root=root,
                    sidebar=render_sidebar(manifest, product, variant, page['href'], root),
                    toggle=render_toggle(product, variant, page['href'], root),
                    content=content,
                    page_nav=render_page_nav(*neighbours(seq, product, page), root),
                    toc=render_toc(headings),
                )

                if page_html != src:
                    changed.append(rel_path)
                    if not check:
                        open(path, 'w', encoding='utf-8').write(page_html)

                # Index one variant only, so results aren't doubled up.
                if not primary:
                    continue
                index_entries.append({
                    't': heading_text,
                    'g': group['title'],
                    'u': rel_path,
                    'x': plain_text(content),
                })
                for level, hid, text in headings:
                    if level == 2:
                        index_entries.append({
                            't': text,
                            'g': heading_text,
                            'u': f'{rel_path}#{hid}',
                        })

    if not check:
        out = os.path.join(ROOT, 'assets/search-index.js')
        with open(out, 'w', encoding='utf-8') as fh:
            fh.write('/* Generated by tools/build_docs.py — do not edit. */\n')
            fh.write('window.NEXUS_SEARCH_INDEX = ')
            json.dump(index_entries, fh, ensure_ascii=False,
                      separators=(',', ':'))
            fh.write(';\n')
        print(f'search index: {len(index_entries)} entries')

    print(f'{len(changed)} page(s) {"would change" if check else "rebuilt"}')


if __name__ == '__main__':
    main()
