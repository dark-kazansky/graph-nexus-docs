// Screenshot for graph-nexus/timeline/js/getting-started.html, drawn by the local library.
//   node tools/make_chrono_example_image.mjs     (needs the SDK: GRAPH_NEXUS_SDK or a sibling checkout)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { docsRoot, sdkRoot } from './sdk-path.mjs';

const repo = sdkRoot(); // the SDK checkout, served for /src and /Examples
const output = join(docsRoot, 'graph-nexus', 'timeline', 'assets', 'getting-started', 'timeline-example.png');
const types = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };

const server = createServer(async (req, res) => {
  const path = normalize(join(repo, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(repo)) { res.writeHead(403).end(); return; }
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 480 }, deviceScaleFactor: 1.5 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(`${base}/package.json`);
await page.evaluate(() => {
  document.documentElement.innerHTML = '<body style="margin:0;background:#fff"><div id="timeline" style="width:900px;height:480px"></div></body>';
});
await page.addScriptTag({
  type: 'module',
  content: `
    import { createTimeline } from '/src/engine/timeline.js';
    const timeline = createTimeline('timeline');
    timeline.set({
      entities: {
        'Person 1': { label: 'Person 1', color: '#c7141a' },
        'Person 2': { label: 'Person 2', color: '#0a7c8a' },
      },
      events: {
        'Phone call 1': { entityIds: ['Person 1', 'Person 2'], time: new Date(2020, 6, 1, 12, 0) },
        'Phone call 2': { entityIds: ['Person 1', 'Person 2'], time: new Date(2020, 6, 1, 13, 0) },
      },
    });
    timeline.fit();
    window.timelineReady = true;
  `,
});
await page.waitForFunction(() => window.timelineReady, null, { timeout: 30000 });
await page.waitForTimeout(150);
await page.screenshot({ path: output });
await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(output);
