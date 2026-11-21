// Animated feature GIFs for the home page (site/index.html), recorded from the demos in
// Examples/ with the real library.
//   node tools/make_landing_gifs.mjs [scene ...]     (needs the SDK: GRAPH_NEXUS_SDK or a sibling checkout; needs ffmpeg)
// Serves the SDK checkout on a free port, plays each scene in headless Chromium with real
// clicks and wheel zooms, captures frames as it goes, and encodes them at real-time speed
// to site/assets/<scene>.gif. The hero also gets a still hero.jpg for og:image.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { docsRoot, sdkRoot } from './sdk-path.mjs';

const repo = sdkRoot(); // the SDK checkout, served for /src and /Examples
const out = join(docsRoot, 'site', 'assets');
await mkdir(out, { recursive: true });
const types = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

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
const errors = [];
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- helpers used inside scenes ----------
async function clickNode(page, id, { double = false } = {}) {
  const pt = await page.evaluate(id => {
    const chart = window.demo ? window.demo.chart : window.__chart;
    const n = chart.getItem(id);
    return chart.viewCoordinates(n.x, n.y);
  }, id);
  const box = await page.locator('#chart canvas').first().boundingBox();
  const x = box.x + pt.x;
  const y = box.y + pt.y;
  await page.mouse.move(x, y, { steps: 8 });
  if (double) await page.mouse.dblclick(x, y); else await page.mouse.click(x, y);
}
async function dragNode(page, id, dx, dy) {
  const pt = await page.evaluate(id => {
    const chart = window.demo ? window.demo.chart : window.__chart;
    const n = chart.getItem(id);
    return chart.viewCoordinates(n.x, n.y);
  }, id);
  const box = await page.locator('#chart canvas').first().boundingBox();
  await page.mouse.move(box.x + pt.x, box.y + pt.y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.move(box.x + pt.x + dx, box.y + pt.y + dy, { steps: 14 });
  await page.mouse.up();
}
async function clickBlank(page) {
  const box = await page.locator('#chart canvas').first().boundingBox();
  await page.mouse.click(box.x + 12, box.y + 12);
}
async function wheel(page, selector, fx, steps, delta = -300) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * 0.45, { steps: 6 });
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, delta); await wait(140); }
}

// ---------- scenes ----------
// width/height: viewport; clip: the element to record, the app's main content only (no panels).
// A scene either plays live (play: captured as it happens) or renders
// exact frames (frames: e.g. one full 3D turn, so the GIF loops without a jump).
// 50 fps is the smoothest a GIF can play: delays are in 1/100 s, and browsers slow
// anything under 2/100 s down to 1/10 s.
const FPS = 50;
const scenes = {
  hero: {
    // 60 fps MP4: the page runs on Playwright's fake clock and every frame is captured
    // at an exact 1/60 s step, so capture speed does not limit smoothness. Recorded at
    // 2x and kept 1600 px wide so it stays sharp on high-density screens.
    url: 'SupplierNetwork/index.html', width: 1640, height: 800, clip: '#chart', scale: 2, video: { fps: 60, width: 1600 },
    async setup(page) {
      // Start from a grid so the layout visibly untangles the network.
      await page.evaluate(() => {
        const ids = []; demo.chart.each({ type: 'node' }, n => ids.push(n.id));
        return demo.chart.arrange('grid', ids, { animate: false, fit: true });
      });
    },
    duration: 8,
    // [seconds, action]. Actions start page work without waiting for it: the fake clock
    // only moves between frames, so awaiting an animation here would never finish.
    timeline: [
      [0.5, page => page.evaluate(() => { demo.chart.layout('organic', { animate: true, time: 1600, tightness: 4, fit: true }); })],
      [2.8, page => page.evaluate(() => { demo.sizeBy(true); })],
      [4.4, page => clickNode(page, 'chips')],
      [6.6, page => clickBlank(page)],
    ],
  },
  layouts: {
    url: 'SupplierNetwork/index.html', width: 1400, height: 630, clip: '#chart', gifWidth: 720,
    async play(page) {
      await wait(600);
      for (const name of ['Organic', 'Hierarchy', 'Sequential', 'Radial', 'Lens', 'Structural']) {
        await page.getByRole('button', { name, exact: true }).click();
        await wait(1900);
      }
      // Tweak only tidies: drag a supplier out of place first, then let tweak settle it.
      await page.getByRole('button', { name: 'Organic', exact: true }).click();
      await wait(1400);
      await dragNode(page, 'chips', 160, 90);
      await clickBlank(page);              // deselect so nothing is faded
      await wait(600);
      await page.getByRole('button', { name: 'Tweak', exact: true }).click();
      await wait(1800);
    },
  },
  combos: {
    url: 'ShipmentLanes/index.html', width: 1400, height: 640, clip: '#chart',
    async play(page) {
      await wait(1500);                                   // nine sites, one link per shipment
      await page.getByRole('button', { name: 'Group by region' }).click();
      await wait(2400);                                   // three region combos
      await page.getByRole('button', { name: 'Merge parallel links' }).click();
      await wait(2800);                                   // one link per pair, labelled with the count
    },
  },
  'view-3d': {
    url: 'SupplierNetwork/index.html', width: 1400, height: 630, clip: '#chart', gifWidth: 720,
    async setup(page) {
      await page.evaluate(async () => { await demo.view3d(true); demo.stopSpin(); });
      await wait(1200);
    },
    // Exactly one turn: frame k shows yaw0 + 2πk/N, so the last frame leads into the first.
    async frames(page, shot) {
      const N = 240; // 4.8 s at 50 fps
      const yaw0 = await page.evaluate(() => demo.chart.camera().yaw);
      for (let k = 0; k < N; k++) {
        await page.evaluate(yaw => new Promise(r => { demo.chart.camera({ yaw }); requestAnimationFrame(() => requestAnimationFrame(r)); }), yaw0 + (Math.PI * 2 * k) / N);
        await shot();
      }
    },
  },
  'node-styles': {
    url: 'ServiceMap/index.html?debug', width: 1400, height: 624, clip: '#chart',
    async setup(page) { await page.evaluate(() => window.__chart.zoom('fit')); },
    async play(page) {
      await wait(800);
      await clickNode(page, 'checkout');
      await wait(2000);
      await clickNode(page, 'bank');
      await wait(2000);
      await clickBlank(page);
      await wait(900);
    },
  },
  timeline: {
    url: 'ProjectTimeline/index.html', width: 1280, height: 790, clip: '#timeline', // about 16:9, like the card
    async play(page) {
      await wait(1200);
      await page.mouse.click(...await rowPoint(page, 'an'));   // focus one person's work
      await wait(2000);
      await page.click('#fit');
      await wait(800);
      await wheel(page, '#timeline', 0.47, 4);                  // zoom into the hand-off week
      await wait(1800);
      await page.click('#fit');
      await wait(1200);
    },
  },
  'timeline-graph': {
    url: 'TeamMessages/index.html?debug', width: 1360, height: 840, clip: '.views', // about 16:9, like the card
    async play(page) {
      await wait(1200);
      await wheel(page, '#timeline', 0.52, 5);                  // zoom into Wednesday
      await wait(2000);
      await page.click('#fit');
      await wait(1200);
      await clickNode(page, 'phuc');
      await wait(2200);
    },
  },
};

// Screen point of a timeline row label, by entity id.
async function rowPoint(page, id) {
  const pos = await page.evaluate(id => window.__timeline.getEntityPosition(id), id);
  const box = await page.locator('#timeline').boundingBox();
  return [box.x + pos.x1 + 30, box.y + (pos.y1 + pos.y2) / 2];
}

// ---------- recorder ----------
// Flat chart graphics need no dithering; it only inflates the file.
const PALETTE = 'split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle';

async function record(name, scene) {
  const page = await browser.newPage({ viewport: { width: scene.width, height: scene.height }, deviceScaleFactor: scene.scale || 1 });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  const sep = scene.url.includes('?') ? '&' : '?';
  const url = `${base}/Examples/${scene.url}${scene.url.includes('debug') ? '' : `${sep}debug`}`;
  // Pumps the fake clock until `test` holds (timeline scenes only).
  const pump = async (test, limit = 600) => {
    for (let i = 0; i < limit && !(await page.evaluate(test).catch(() => false)); i++) await page.clock.runFor(50);
  };
  if (scene.timeline) {
    await page.clock.install();
    await page.goto(url);
    await pump(() => window.ready === true);
    if (scene.setup) await scene.setup(page);
    await page.clock.runFor(800);
  } else {
    await page.goto(url);
    await page.waitForFunction(() => window.ready, null, { timeout: 20000 });
    await wait(800);
    if (scene.setup) { await scene.setup(page); await wait(300); }
  }

  const box = await page.locator(scene.clip).boundingBox();
  const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
  const dir = await mkdtemp(join(tmpdir(), `gif-${name}-`));
  const frames = [];
  const gif = join(out, `${name}.gif`);

  if (scene.timeline) {
    // One frame per exact 1/fps step of page time, then H.264 for smooth playback.
    const fps = scene.video.fps;
    const total = Math.round(scene.duration * fps);
    const due = scene.timeline.slice();
    for (let k = 0; k < total; k++) {
      while (due.length && due[0][0] * fps <= k) await due.shift()[1](page);
      await page.clock.runFor(1000 / fps);
      const file = join(dir, `f${String(frames.length).padStart(4, '0')}.png`);
      await page.screenshot({ path: file, clip });
      frames.push({ file });
    }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'f%04d.png'),
      '-vf', `scale=${scene.video.width}:-2:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(out, `${name}.mp4`)]);
  } else if (scene.frames) {
    // Exact frames at a fixed rate.
    await scene.frames(page, async () => {
      const file = join(dir, `f${String(frames.length).padStart(4, '0')}.png`);
      await page.screenshot({ path: file, clip });
      frames.push({ file });
    });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, 'f%04d.png'),
      '-vf', `scale=${scene.gifWidth || 800}:-1:flags=lanczos,${PALETTE}`, '-loop', '0', gif]);
  } else {
    // Live: capture JPEGs back to back while the scene plays,
    // stamping each with its real time so playback speed matches.
    const cdp = await page.context().newCDPSession(page);
    let done = false;
    const capture = (async () => {
      while (!done) {
        const t = Date.now();
        const { data } = await cdp.send('Page.captureScreenshot', {
          format: 'jpeg', quality: 92, optimizeForSpeed: true, clip: { ...clip, scale: scene.scale || 1 },
        });
        frames.push({ file: join(dir, `f${String(frames.length).padStart(4, '0')}.jpg`), t: t / 1000, data });
        // No pause: capture as fast as the browser allows (about 30 ms a frame).
      }
    })();
    await scene.play(page);
    done = true;
    await capture;
    await Promise.all(frames.map(f => writeFile(f.file, Buffer.from(f.data, 'base64'))));
    const lines = frames.map((f, i) => {
      const next = frames[i + 1] ? frames[i + 1].t : f.t + 1.2; // hold the last frame a moment
      return `file '${f.file}'\nduration ${Math.max(0.001, next - f.t).toFixed(3)}`;
    });
    lines.push(`file '${frames[frames.length - 1].file}'`);
    const list = join(dir, 'list.txt');
    await writeFile(list, lines.join('\n'));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', `fps=${scene.fps || FPS},scale=${scene.gifWidth || 800}:-1:flags=lanczos,${PALETTE}`,
      '-loop', '0', gif]);
  }
  if (name === 'hero') {
    // Still of the last frame for og:image (social previews cannot animate).
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', frames[frames.length - 1].file,
      '-q:v', '3', join(out, 'hero.jpg')]);
  }
  await page.close();
  await rm(dir, { recursive: true });
  console.log(`${name}.${scene.timeline ? 'mp4' : 'gif'}  ${frames.length} frames`);
}

const wanted = process.argv.slice(2);
for (const [name, scene] of Object.entries(scenes)) {
  if (!wanted.length || wanted.includes(name)) await record(name, scene);
}
await browser.close();
server.close();
if (errors.length) { console.error('page errors:\n' + errors.join('\n')); process.exit(1); }
