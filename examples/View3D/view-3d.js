import GraphNexus from 'graph-nexus';
import { chartData } from './data.js';

const icon = name => GraphNexus.getFontIcon(`fa-solid ${name}`);
const status = document.getElementById('status');
const badge = document.getElementById('layoutBadge');
const say = text => { status.textContent = text; };

await Promise.all(['900 16px FontAwesomeSolid', '16px Muli', 'bold 16px Muli'].map(f => document.fonts.load(f)));

// view3d on from the start: drag to orbit, wheel to zoom.
const view = { fog: false, shading: false };
const chart = await GraphNexus.create({
  container: 'chart',
  options: {
    backColour: '#ffffff',
    fontFamily: 'Muli',
    iconFontFamily: 'FontAwesomeSolid',
    selectionColour: '#1f1a17',
    navigation: { shown: false },
    overview: { icon: false },
    view3d: { ...view },
  },
});
await chart.load(chartData(icon));

// ---------- layouts: with view3d on, every layout has depth ----------
const describe = {
  organic: 'Organic: a force layout in three dimensions.',
  hierarchy: 'Hierarchy as a cone tree: each tier is a ring around the vertical axis, under the internet.',
  sequential: 'Sequential: the same cone tree, ordered by link direction from the internet down to the servers.',
  radial: 'Radial: each tier is a sphere around the internet node.',
  lens: 'Lens: spheres by number of connections, best connected in the middle.',
  structural: 'Structural: servers in the same rack share neighbours, so each rack is placed as one block.',
};
const options = {
  organic: { tightness: 4 },
  hierarchy: { top: 'internet' },
  sequential: { orientation: 'down' },
  radial: { top: 'internet' },
  lens: {},
  structural: {},
};
async function layout(name) {
  badge.textContent = `${name[0].toUpperCase()}${name.slice(1)} layout`;
  say(describe[name]);
  await chart.layout(name, { animate: true, time: 900, fit: true, ...options[name] });
}

// ---------- camera ----------
let spin = null;
function rotate(on) {
  if (spin) { clearInterval(spin); spin = null; }
  if (on) spin = setInterval(() => chart.camera({ yaw: chart.camera().yaw + 0.01 }), 30);
}
function resetCamera() {
  chart.camera({ yaw: 0.6, pitch: -0.6 }, { animate: true, time: 600 });
  chart.zoom('fit', { animate: true, time: 600 });
}

// ---------- look ----------
async function setLook(key, on) {
  view[key] = on;
  await chart.options({ view3d: { ...view } });
}

// ---------- selection: a device and its direct links ----------
chart.on('selection-change', () => {
  const id = chart.selection()[0];
  if (!id) { chart.foreground(() => true); return; }
  const near = new Set([id, ...chart.graph().neighbours(id).nodes]);
  chart.foreground(n => near.has(n.id), { type: 'node' });
  const n = chart.getItem(id);
  if (n.d) say(`${n.d.name}: ${n.d.tierLabel}, ${near.size - 1} direct links.`);
});

// ---------- controls ----------
document.querySelectorAll('[data-layout]').forEach(b => b.addEventListener('click', async () => {
  document.querySelectorAll('[data-layout]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  await layout(b.dataset.layout);
}));
document.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', String(on));
  if (b.dataset.toggle === 'rotate') rotate(on);
  else await setLook(b.dataset.toggle, on);
}));
document.getElementById('reset').addEventListener('click', resetCamera);

chart.camera({ yaw: 0.6, pitch: -0.6 });
await layout('organic');
rotate(true);

const stopSpin = () => rotate(false);
window.demo = { chart, layout, rotate, setLook, resetCamera, stopSpin };
if (new URLSearchParams(location.search).has('debug')) window.__chart = chart;
window.ready = true;
