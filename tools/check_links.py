#!/usr/bin/env python3
"""Verify every internal link and asset reference resolves, and that every
in-page anchor target exists. Exits non-zero when something is broken."""
import os
import re
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = re.compile(r'(?:href|src)="([^"]+)"')
ID = re.compile(r'\sid="([^"]+)"')
SKIP = ('http://', 'https://', 'mailto:', 'data:', 'javascript:', 'tel:')


def pages():
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in ('.git', 'tools', '.deepeval')]
        for name in files:
            if name.endswith('.html'):
                yield os.path.join(base, name)


def main():
    ids = {}
    for path in pages():
        ids[path] = set(ID.findall(open(path, encoding='utf-8').read()))

    broken = []
    for path in pages():
        src = open(path, encoding='utf-8').read()
        # Code samples contain markup that only looks like links.
        src = re.sub(r'<(pre|code)\b.*?</\1>', ' ', src, flags=re.S)
        here = os.path.dirname(path)
        for ref in set(REF.findall(src)):
            if ref.startswith(SKIP) or not ref.strip():
                continue
            target, _, fragment = ref.partition('#')
            target = urllib.parse.unquote(target)
            if target:
                dest = os.path.normpath(os.path.join(here, target))
                if not os.path.exists(dest):
                    broken.append((path, ref, 'missing file'))
                    continue
            else:
                dest = path
            if fragment and dest.endswith('.html'):
                if fragment not in ids.get(dest, set()):
                    broken.append((path, ref, 'missing anchor'))

    for path, ref, why in sorted(broken):
        print(f'{os.path.relpath(path, ROOT)}: {ref}  [{why}]')
    total = len(list(pages()))
    print(f'checked {total} pages, {len(broken)} broken reference(s)')
    return 1 if broken else 0


if __name__ == '__main__':
    sys.exit(main())
