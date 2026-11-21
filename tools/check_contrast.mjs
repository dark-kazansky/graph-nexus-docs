// Computed-colour contrast audit (WCAG 2.2 AA) in light and dark mode.
//   node tools/check_contrast.mjs [--all]
// Samples one page per section by default; --all checks every page. Text drawn over
// gradients or images is skipped and counted, because a single colour cannot be derived.
import { chromium } from 'playwright';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pages = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'tools' || name === 'chrono-graph-nexus') continue; // tools; redirect stubs
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.html')) pages.push(full);
  }
})(root);
const all = process.argv.includes('--all');
const sample = all ? pages : pages.filter((p, i) => /site\/index|graph-nexus\/index|timeline\/js\/(docs|getting-started|scales|api)|timeline\/react\/api|basics\/chart-basics|features\/3d-view|api\.html|installing\/upgrading/.test(p));

const browser = await chromium.launch();
let failures = 0; let skipped = 0; let checked = 0;
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1300, height: 900 } });
  const page = await context.newPage();
  for (const file of sample) {
    await page.goto(pathToFileURL(file).href);
    const result = await page.evaluate(() => {
      const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
      const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
      const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
      const out = []; let skipped = 0; let checked = 0;
      const seen = new Set();
      document.querySelectorAll('body *').forEach(el => {
        if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || +style.opacity === 0) return;
        const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height) return;
        let bg = { r: 255, g: 255, b: 255, a: 1 }; const layers = []; let blocked = false;
        for (let n = el; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.backgroundImage !== 'none') { blocked = true; break; }
          const c = parse(s.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; }
        }
        if (blocked || style.webkitTextFillColor === 'rgba(0, 0, 0, 0)' || style.color === 'rgba(0, 0, 0, 0)') { skipped++; return; }
        const canvas = parse(getComputedStyle(document.documentElement).backgroundColor);
        bg = layers.length && layers[layers.length - 1].a === 1 ? layers.pop() : (canvas && canvas.a ? canvas : (matchMedia('(prefers-color-scheme: dark)').matches ? { r: 10, g: 8, b: 24, a: 1 } : bg));
        while (layers.length) bg = over(layers.pop(), bg);
        const fg = over(parse(style.color), bg);
        const l1 = lum(fg); const l2 = lum(bg); const ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
        const size = parseFloat(style.fontSize); const bold = +style.fontWeight >= 700;
        const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
        checked++;
        if (ratio < need) {
          const key = `${el.tagName.toLowerCase()}.${el.className}|${style.color}|${bg.r | 0},${bg.g | 0},${bg.b | 0}`;
          if (!seen.has(key)) { seen.add(key); out.push({ key, ratio: +ratio.toFixed(2), need, text: el.textContent.trim().slice(0, 40) }); }
        }
      });
      return { out, skipped, checked };
    });
    skipped += result.skipped; checked += result.checked;
    result.out.forEach(f => { failures++; console.log(`[${scheme}] ${relative(root, file)}: ${f.ratio} < ${f.need}  ${f.key}  "${f.text}"`); });
  }
  await context.close();
}
await browser.close();
console.log(`checked ${checked} text elements on ${sample.length} pages x 2 schemes, ${skipped} skipped (gradient/image), ${failures} failing`);
process.exit(failures ? 1 : 0);
