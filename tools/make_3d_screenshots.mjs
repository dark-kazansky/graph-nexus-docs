// Screenshots for features/3d-view.html, drawn by the real library.
//   node tools/make_3d_screenshots.mjs     (needs the SDK: GRAPH_NEXUS_SDK or a sibling checkout)
// Serves the SDK checkout on a free port, draws each scene in headless Chromium, and writes
// PNGs to graph-nexus/assets/features/3d-*.png.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { docsRoot, sdkRoot } from './sdk-path.mjs';

const repo = sdkRoot(); // the SDK checkout, served for /src and /Examples
const out = join(docsRoot, 'graph-nexus', 'assets', 'features');
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1.5 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`${base}/package.json`);
await page.evaluate(() => {
  document.documentElement.innerHTML = '<body style="margin:0;background:#fff"><div id="c" style="width:900px;height:560px"></div></body>';
});
await page.addScriptTag({
  type: 'module',
  content: `
    import GraphNexus from '/src/graph-nexus.js';
    import { data, colours } from '/Examples/Centrality/enron-data.js';
    GraphNexus.mode('canvas');
    window.chart = await GraphNexus.create({ container: 'c', options: {
      arrows: 'normal', minZoom: 1e-6, navigation: { shown: false }, overview: { icon: false }, logo: { u: '' },
    } });
    // The Enron network as the Centrality demo draws it, sized and coloured by degree.
    window.enron = async () => {
      await chart.load(JSON.parse(JSON.stringify(data)));
      const deg = chart.graph().degrees();
      const max = Math.max(...Object.values(deg));
      const band = v => (v > 0.75 ? colours.bands[2] : v > 0.5 ? colours.bands[1] : v > 0.25 ? colours.bands[0] : colours.node);
      const props = Object.entries(deg).map(([id, d]) => ({ id, e: Math.max(1, (d / max) * 5), c: band(d / max), b: band(d / max) }));
      chart.each({ type: 'link' }, l => props.push({ id: l.id, c: colours.link }));
      await chart.setProperties(props);
    };
    window.ready = true;
  `,
});
await page.waitForFunction(() => window.ready, null, { timeout: 30000 });

async function shot(name, scene) {
  await page.evaluate(scene);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(out, `3d-${name}.png`) });
  console.log(`3d-${name}.png`);
}

// 2D, for comparison.
await shot('enron-2d', async () => {
  await enron();
  await chart.layout('organic', { consistent: true, animate: false, tightness: 4 });
});

// The same network in 3D, and turned round to the side.
await shot('enron-3d', async () => {
  await chart.options({ view3d: true });
  chart.camera({ yaw: 0.6, pitch: -0.35 });
  await chart.layout('organic', { consistent: true, animate: false, tightness: 4 });
});
await shot('enron-side', async () => {
  chart.camera({ yaw: chart.camera().yaw + 1.4 });
});

// Fog: the far side fades.
await shot('fog', async () => {
  chart.camera({ yaw: 0.6, pitch: -0.35 });
  await chart.options({ view3d: { fog: true } });
  await chart.zoom('fit', { animate: false });
});

// Arrowheads are cones; links start at the disc rim.
await shot('arrows', async () => {
  const items = [{ type: 'node', id: 'hub', x: 0, y: 0, z: 0, e: 2.2, c: '#ef5350', t: 'Hub' }];
  const spots = [[260, -40, -260], [-250, 60, 240], [40, -260, 120], [-60, 240, -200], [230, 170, 300], [-220, -170, -320], [10, 30, -520]];
  spots.forEach(([x, y, z], i) => {
    items.push({ type: 'node', id: `n${i}`, x, y, z, c: '#ffa726', t: `Node ${i + 1}` });
    items.push({ type: 'link', id: `l${i}`, id1: i % 2 ? 'hub' : `n${i}`, id2: i % 2 ? `n${i}` : 'hub', a2: true, c: '#78909c', w: 2 });
  });
  await chart.load({ type: 'LinkChart', items });
  await chart.options({ view3d: true });
  chart.camera({ yaw: 0.5, pitch: -0.3, focal: 1500 });
  await chart.zoom('fit', { animate: false });
});

// Optional sphere shading.
await shot('shading', async () => {
  await enron();
  await chart.options({ view3d: { shading: true } });
  chart.camera({ yaw: 0.6, pitch: -0.35 });
  await chart.layout('organic', { consistent: true, animate: false, tightness: 4 });
});

await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
