import GraphNexus from 'graph-nexus';
import { chartData, countries, tiers } from './data.js';

const icon = name => GraphNexus.getFontIcon(`fa-solid ${name}`);
const status = document.getElementById('status');
const say = text => { status.textContent = text; };

await Promise.all(['900 16px FontAwesomeSolid', '16px Muli', 'bold 16px Muli'].map(f => document.fonts.load(f)));

GraphNexus.paths({ images: '../sdk/assets/' });
const chart = await GraphNexus.create({
  container: 'chart',
  options: {
    backColour: '#ffffff',
    fontFamily: 'Muli',
    iconFontFamily: 'FontAwesomeSolid',
    selectionColour: '#1f1a17',
    navigation: { shown: false },
    overview: { icon: false },
    handMode: true,
    combos: { shape: 'rectangle' },
  },
});
await chart.load(chartData(icon));
await chart.layout('organic', { animate: false, tightness: 4 });

// ---------- layouts ----------
const badge = document.getElementById('layoutBadge');
const run = (name, opts) => {
  badge.textContent = `${name[0].toUpperCase()}${name.slice(1)} layout`;
  badge.hidden = false;
  return chart.layout(name, { animate: true, time: 900, fit: true, ...opts });
};
const layouts = {
  organic: () => run('organic', { tightness: 4 }),
  // Hierarchy: a tree under the plant. Sequential: the flow of goods along link direction.
  hierarchy: () => run('hierarchy', { top: 'plant', tightness: 1 }),
  sequential: () => run('sequential', { orientation: 'down', tightness: 1 }),
  radial: () => run('radial', { top: 'plant' }),
  lens: () => run('lens'),
  structural: () => run('structural'),
  // Tweak keeps the current picture and only resolves overlaps, e.g. after dragging nodes.
  tweak: () => run('tweak'),
};

// ---------- size by betweenness centrality ----------
async function sizeBy(on) {
  if (!on) {
    const props = [];
    chart.each({ type: 'node' }, n => { if (n.d && n.d.tier !== undefined) props.push({ id: n.id, e: tiers[n.d.tier].e }); });
    await chart.animateProperties(props, { time: 600 });
    say('Node size shows the tier.');
    return;
  }
  const scores = await chart.graph().betweenness({ directed: false });
  const max = Math.max(...Object.values(scores)) || 1;
  const props = Object.entries(scores).map(([id, v]) => ({ id, e: 0.8 + Math.sqrt(v / max) * 1.9 }));
  await chart.animateProperties(props, { time: 600 });
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(1, 4).map(([id]) => chart.getItem(id).d.name);
  say(`Sized by betweenness. Biggest chokepoints after the plant: ${top.join(', ')}.`);
}

// ---------- group by country ----------
let grouped = false;
async function groupByCountry(on) {
  const combo = chart.combo();
  if (!on) {
    const ids = [];
    chart.each({ type: 'node' }, n => { if (combo.isCombo(n.id)) ids.push(n.id); });
    await combo.uncombine(ids, { animate: true, time: 600, full: true });
    await chart.layout('organic', { animate: true, time: 700, tightness: 4 });
    grouped = false;
    say('Companies shown individually.');
    return;
  }
  const byCountry = {};
  chart.each({ type: 'node' }, n => { if (n.d && n.d.country) (byCountry[n.d.country] = byCountry[n.d.country] || []).push(n.id); });
  const defs = Object.entries(byCountry).map(([cc, ids]) => ({
    ids,
    label: `${countries[cc]} (${ids.length})`,
    style: { c: '#fff5f0', b: '#f26f21', bw: 2, u: `flags/4x3/${cc}.svg`, e: 0.9 + Math.sqrt(ids.length) * 0.3,
      t: { t: `${countries[cc]} · ${ids.length}`, fs: 13, fb: true, fc: '#1f1a17', fbc: 'rgba(255,255,255,0.9)', position: 's' } },
    openStyle: { c: 'rgba(255,245,240,0.6)', b: '#f26f21', bw: 1.5, bs: 'dashed' },
    d: { country: cc },
  }));
  await combo.combine(defs, { animate: true, time: 700, select: false, arrange: 'concentric' });
  await chart.layout('organic', { animate: true, time: 700, tightness: 1, fit: true });
  grouped = true;
  say('Grouped by country. Double click a country to open it.');
}

// ---------- aggregate parallel lanes ----------
async function aggregate(on) {
  await chart.options({ aggregateLinks: on ? { aggregateBy: 'mode' } : false });
  say(on ? 'Parallel lanes merged by transport mode.' : 'Every shipment lane drawn separately.');
}
chart.on('link-aggregation', ({ id, links, change }) => {
  if (change === 'deleted' || !links || !links.length) return;
  const first = chart.getItem(links[0]);
  chart.setProperties({ id, w: 1.5 + links.length * 1.2, t: `${links.length} ${first.d.mode}`, fs: 11, fc: '#6b6560', fbc: '#ffffff', c: first.c, ls: first.ls });
});

// ---------- 3D ----------
let spin = null;
async function view3d(on) {
  if (spin) { clearInterval(spin); spin = null; }
  // Plain 3D: flat node colours, no fog or sphere shading.
  await chart.options({ view3d: on ? { fog: false, shading: false } : false });
  await chart.layout('organic', { animate: true, time: 900, tightness: 4, fit: true });
  if (on) {
    chart.camera({ pitch: -0.35 });
    spin = setInterval(() => chart.camera({ yaw: chart.camera().yaw + 0.012 }), 30);
    say('3D view. Drag to orbit; the camera turns slowly on its own.');
  } else {
    say('Back to 2D.');
  }
}

// ---------- selection: show a company's direct trading partners ----------
chart.on('selection-change', () => {
  const id = chart.selection()[0];
  if (!id || grouped) { chart.foreground(() => true); return; }
  const near = new Set([id, ...chart.graph().neighbours(id).nodes]);
  chart.foreground(n => near.has(n.id), { type: 'node' });
  const n = chart.getItem(id);
  if (n.d) say(`${n.d.name}: ${n.d.tierLabel}, ${countries[n.d.country]}. ${near.size - 1} direct trading partners.`);
});
chart.on('double-click', ({ id, preventDefault }) => {
  const combo = chart.combo();
  if (id && combo.isCombo(id)) {
    const toggle = combo.isOpen(id) ? combo.close(id, { animate: true }) : combo.open(id, { animate: true });
    // Re-lay out so an opened combo pushes its neighbours aside instead of covering them.
    toggle.then(() => chart.layout('organic', { animate: true, time: 700, tightness: 0, fit: true }));
    preventDefault();
  }
});

// ---------- controls ----------
function pressed(group, button) {
  document.querySelectorAll(`[data-group="${group}"]`).forEach(b => b.setAttribute('aria-pressed', String(b === button)));
}
document.querySelectorAll('[data-layout]').forEach(b => b.addEventListener('click', async () => {
  pressed('layout', b);
  await layouts[b.dataset.layout]();
  say(`${b.textContent} layout.`);
}));
const toggles = { size: sizeBy, group: groupByCountry, aggregate, view3d };
document.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', String(on));
  await toggles[b.dataset.toggle](on);
}));

await chart.zoom('fit');
say('Click a company to see its trading partners, or try the controls.');

// Exposed for the screenshot and test scripts.
const stopSpin = () => { if (spin) { clearInterval(spin); spin = null; } };
window.demo = { chart, layouts, sizeBy, groupByCountry, aggregate, view3d, stopSpin };
if (new URLSearchParams(location.search).has('debug')) window.__chart = chart;
window.ready = true;
