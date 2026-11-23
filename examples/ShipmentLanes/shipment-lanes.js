import GraphNexus from 'graph-nexus';
import { chartData, regions, modes, shipmentCount } from './data.js';

const icon = name => GraphNexus.getFontIcon(`fa-solid ${name}`);
const status = document.getElementById('status');
const say = text => { status.textContent = text; };

await Promise.all(['900 16px FontAwesomeSolid', '16px Muli', 'bold 16px Muli'].map(f => document.fonts.load(f)));

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

// Style every aggregate link: thickness and a label from the number of shipments it stands for.
// When split by mode, road runs straight and sea and air arc to either side. The arc grows with the
// link's length, so the three labels stay apart when the chart zooms out (offsets are world units).
const modeLinks = new Map(); // aggregate link id -> { side, id1, id2 }

function modeOffset({ side, id1, id2 }) {
  const [a, b] = chart.getItem([id1, id2]);
  const length = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  return side * Math.min(200, Math.max(120, length * 0.18));
}

// Recompute the arcs once nodes have moved (grouping, opening a region).
function spreadModes() {
  const props = [...modeLinks].map(([id, link]) => ({ id, off: modeOffset(link) }));
  if (props.length) chart.setProperties(props);
}

chart.on('link-aggregation', ({ id, id1, id2, links, change, aggregateByValue }) => {
  if (change === 'deleted') { modeLinks.delete(id); return; }
  const n = links.length;
  const label = { fs: 15, fb: true, fbc: '#ffffff' };
  if (aggregateByValue) {
    const m = modes[aggregateByValue];
    const link = { side: m.side, id1, id2 };
    modeLinks.set(id, link);
    chart.setProperties({ id, c: m.colour, ls: m.dash, off: modeOffset(link), w: 1.5 + n, t: `${n} ${m.label}`, fc: m.colour, ...label });
  } else {
    modeLinks.delete(id);
    chart.setProperties({ id, c: '#c7141a', ls: 'solid', off: 0, w: 1.5 + n * 0.9, t: `${n} shipments`, fc: '#c7141a', ...label });
  }
});

await chart.load(chartData(icon));
await chart.zoom('fit');

const state = { merge: false, byMode: false, group: false };

async function applyAggregation() {
  const opt = state.merge ? (state.byMode ? { aggregateBy: 'mode' } : true) : false;
  await chart.options({ aggregateLinks: opt });
}

async function merge(on) {
  state.merge = on;
  await applyAggregation();
  say(on ? `${shipmentCount} shipments merged into one link per route, labelled with the count.`
    : `${shipmentCount} shipments, one link each.`);
}

async function byMode(on) {
  state.byMode = on;
  if (on && !state.merge) { state.merge = true; document.querySelector('[data-toggle="merge"]').setAttribute('aria-pressed', 'true'); }
  await applyAggregation();
  say(on ? 'Each route now has one merged link per transport mode: road, sea and air.' : 'One merged link per route.');
}

async function group(on) {
  const combo = chart.combo();
  state.group = on;
  if (!on) {
    const ids = [];
    chart.each({ type: 'node' }, n => { if (combo.isCombo(n.id)) ids.push(n.id); });
    await combo.uncombine(ids, { animate: true, time: 600, full: true });
    spreadModes();
    await chart.zoom('fit', { animate: true, time: 400 });
    say('Sites shown individually.');
    return;
  }
  const byRegion = {};
  chart.each({ type: 'node' }, n => { if (n.d && n.d.region) (byRegion[n.d.region] = byRegion[n.d.region] || []).push(n.id); });
  const defs = Object.entries(byRegion).map(([r, ids]) => ({
    ids,
    label: regions[r].label,
    style: {
      c: regions[r].colour, e: 2.2, fi: { t: icon('fa-map-location-dot'), c: '#ffffff' },
      t: { t: `${regions[r].label} · ${ids.length} sites`, fs: 17, fb: true, fc: '#1f1a17', fbc: 'rgba(255,255,255,0.9)', position: 's' },
    },
    openStyle: { c: 'rgba(255,245,240,0.7)', b: regions[r].colour, bw: 2, bs: 'dashed',
      t: { t: regions[r].label, fs: 14, fb: true, fc: regions[r].colour } },
  }));
  await combo.combine(defs, { animate: true, time: 700, select: false, arrange: { name: 'grid', gridShape: { columns: 1 }, tightness: 0 } });
  spreadModes();
  await chart.zoom('fit', { animate: true, time: 400 });
  say('Grouped by region. Links between regions merge too. Double click a region to open it.');
}

chart.on('double-click', ({ id, preventDefault }) => {
  const combo = chart.combo();
  if (id && combo.isCombo(id)) {
    const done = combo.isOpen(id) ? combo.close(id, { animate: true }) : combo.open(id, { animate: true });
    done.then(() => { spreadModes(); return chart.zoom('fit', { animate: true, time: 400 }); });
    preventDefault();
  }
});

const toggles = { merge, byMode, group };
document.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', String(on));
  await toggles[b.dataset.toggle](on);
}));

say(`${shipmentCount} shipments this week, one link each. Busy routes carry several parallel links.`);
window.demo = { chart, merge, byMode, group };
if (new URLSearchParams(location.search).has('debug')) window.__chart = chart;
window.ready = true;
