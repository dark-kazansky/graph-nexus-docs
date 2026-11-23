#!/usr/bin/env python3
"""Copy the SDK's twelve example apps into examples/ so GitHub Pages can host them.

Layout:
  examples/index.html       card page (hand written, not touched here)
  examples/thumbs/          card screenshots (not touched here)
  examples/sdk/             one shared copy of the SDK's src/ and assets/
  examples/<Name>/          each app's own files

In the SDK each app loads the library from node_modules/graph-nexus/ (a symlink to
the SDK). Here that prefix is rewritten to ../sdk/, the only change made to an app.
"""
import os
import re
import shutil

from sdk_path import sdk_root

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'examples')
SKIP_FILES = {'package.json', 'package-lock.json', 'run.sh', '.gitignore', '.DS_Store'}
SKIP_DIRS = {'node_modules', '.agents', '.git'}
TEXT = ('.html', '.css', '.js')
PREFIX = re.compile(r'(?:\./)?node_modules/graph-nexus/')


def rewrite(text):
    return PREFIX.sub('../sdk/', text)


def copy_app(src, dest):
    for base, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            if name in SKIP_FILES or name.endswith('.spec.mjs'):
                continue
            path = os.path.join(base, name)
            target = os.path.join(dest, os.path.relpath(path, src))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if name.endswith(TEXT):
                with open(path, encoding='utf-8') as fh:
                    text = rewrite(fh.read())
                with open(target, 'w', encoding='utf-8') as fh:
                    fh.write(text)
            else:
                shutil.copy2(path, target)


def main():
    sdk = sdk_root(ROOT)
    apps = sorted(d for d in os.listdir(os.path.join(sdk, 'Examples'))
                  if os.path.isfile(os.path.join(sdk, 'Examples', d, 'index.html')))
    for name in apps + ['sdk']:
        shutil.rmtree(os.path.join(OUT, name), ignore_errors=True)
    for part in ('src', 'assets'):
        shutil.copytree(os.path.join(sdk, part), os.path.join(OUT, 'sdk', part),
                        ignore=shutil.ignore_patterns('.DS_Store', 'README.md'))
    for name in apps:
        copy_app(os.path.join(sdk, 'Examples', name), os.path.join(OUT, name))
    print(f'examples: {len(apps)} apps copied from {sdk}')


if __name__ == '__main__':
    assert rewrite('"./node_modules/graph-nexus/src/graph-nexus.js"') == '"../sdk/src/graph-nexus.js"'
    assert rewrite("url('node_modules/graph-nexus/assets/a.ttf')") == "url('../sdk/assets/a.ttf')"
    main()
