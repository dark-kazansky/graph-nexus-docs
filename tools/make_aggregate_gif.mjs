// Animated example for features/aggregate-links.html, drawn by the real library.
//   node tools/make_aggregate_gif.mjs     (needs the SDK: GRAPH_NEXUS_SDK or a sibling checkout; needs ffmpeg)
// Serves the SDK checkout on a free port, toggles aggregateLinks in headless Chromium, and
// writes graph-nexus/assets/features/aggregate-links.gif.
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { docsRoot, sdkRoot } from './sdk-path.mjs';

const repo = sdkRoot(); // the SDK checkout, served for /src and /Examples
const out = join(docsRoot, 'graph-nexus', 'assets', 'features', 'aggregate-links.gif');
const types = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };

const server = createServer(async (req, res) => {
  const path = normalize(join(repo, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(repo)) { res.writeHead(403).end(); return; }
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const W = 560, H = 360;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`${base}/package.json`);
await page.evaluate(([w, h]) => {
  document.documentElement.innerHTML = `<body style="margin:0;background:#fff"><div id="c" style="width:${w}px;height:${h}px"></div></body>`;
}, [W, H]);
await page.addScriptTag({
  type: 'module',
  content: `
    import GraphNexus from '/src/graph-nexus.js';
    GraphNexus.mode('canvas');
    window.chart = await GraphNexus.create({ container: 'c', options: {
      arrows: 'normal', navigation: { shown: false }, overview: { icon: false }, logo: { u: '' },
    } });
    // A small email network: several messages between the same pairs of people.
    const people = ['Ann', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay'];
    const pos = [[-180, -60], [0, -120], [180, -60], [180, 90], [0, 140], [-180, 90]];
    const pairs = [[0, 1, 4], [1, 0, 2], [1, 2, 3], [2, 3, 5], [3, 4, 2], [4, 5, 3], [5, 0, 2], [1, 4, 3], [0, 3, 1]];
    const items = people.map((t, i) => ({ type: 'node', id: t, t, x: pos[i][0], y: pos[i][1], c: '#2f7ab9', b: '#1f5a8c', fs: 14 }));
    // Parallel links share a path, so fan each pair's links out with 'off' (sign flips with
    // direction, so links both ways between a pair fan across one shared spread).
    const total = {}, seen = {};
    const key = (a, b) => Math.min(a, b) + ':' + Math.max(a, b);
    pairs.forEach(([a, b, n]) => { total[key(a, b)] = (total[key(a, b)] || 0) + n; });
    pairs.forEach(([a, b, n]) => {
      const k0 = key(a, b);
      for (let k = 0; k < n; k++) {
        const i = seen[k0] = (seen[k0] || 0) + 1;
        const off = (i - 1 - (total[k0] - 1) / 2) * 16 * (a < b ? 1 : -1);
        items.push({ type: 'link', id: people[a] + '-' + people[b] + '-' + k, id1: people[a], id2: people[b], a2: true, c: '#8a96a3', w: 2, off });
      }
    });
    await chart.load({ type: 'LinkChart', items });
    await chart.zoom('fit', { animate: false });
    window.ready = true;
  `,
});
await page.waitForFunction(() => window.ready, null, { timeout: 30000 });

const dir = await mkdtemp(join(tmpdir(), 'agg-gif-'));
let frame = 0;
// Hold each state for `count` frames (the gif runs at 10 fps).
async function hold(count) {
  await page.waitForTimeout(100);
  const shot = await page.screenshot();
  for (let i = 0; i < count; i++) {
    await import('node:fs/promises').then(fs => fs.writeFile(join(dir, `f${String(frame++).padStart(4, '0')}.png`), shot));
  }
}

await hold(20); // individual links
// An aggregate link copies its first child's props, 'off' included, so straighten the
// children first or the aggregate would inherit that child's bend.
await page.evaluate(async () => {
  const props = [];
  chart.each({ type: 'link' }, l => props.push({ id: l.id, off: null }));
  await chart.setProperties(props);
  await chart.options({ aggregateLinks: true });
});
await hold(20); // aggregated

if (errors.length) { console.error(errors); process.exitCode = 1; }
await browser.close();
server.close();

execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '10', '-i', join(dir, 'f%04d.png'),
  '-vf', 'split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none', '-loop', '0', out]);
await rm(dir, { recursive: true });
console.log(out);
