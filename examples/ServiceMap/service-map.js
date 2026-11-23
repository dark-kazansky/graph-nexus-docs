import GraphNexus from 'graph-nexus';
import { data } from './data.js';

const details = document.getElementById('details');

function describe(id) {
  const item = id && chart.getItem(id);
  if (!item || item.type !== 'node') {
    details.innerHTML = '<p class="hint">Select a service to see its health and the paths it depends on.</p>';
    return;
  }
  const d = item.d || {};
  if (d.kind === 'service') {
    const deps = chart.graph().neighbours(id, { direction: 'from' }).nodes;
    details.innerHTML = `
      <h2>${d.name}</h2>
      <p class="owner">Owned by ${d.owner}</p>
      <dl>
        <dt>Status</dt><dd class="status-${d.status}">${d.status}</dd>
        <dt>p95 latency</dt><dd>${d.p95} ms</dd>
        <dt>Traffic</dt><dd>${d.rpm} rpm</dd>
        <dt>${d.metric}</dt><dd>${d.cpu}%</dd>
      </dl>
      <p class="owner">${deps.length ? `Calls ${deps.length} service${deps.length > 1 ? 's' : ''}.` : 'No downstream calls.'}</p>`;
  } else {
    details.innerHTML = `<h2>${d.ref || d.caption}</h2><p class="owner">${d.summary || d.value}</p>`;
  }
}

// Selecting a service keeps it and its direct neighbours in front.
function focus(id) {
  if (!id) { chart.foreground(() => true); return; }
  const near = new Set([id, ...chart.graph().neighbours(id).nodes]);
  chart.foreground(node => near.has(node.id), { type: 'node' });
}

await document.fonts.load('900 16px FontAwesomeSolid');
await document.fonts.load('16px Muli');
await document.fonts.load('bold 16px Muli');

const chart = await GraphNexus.create({
  container: 'chart',
  options: {
    backColour: '#fbf7f5',
    fontFamily: 'Muli',
    iconFontFamily: 'FontAwesomeSolid',
    selectionColour: '#f26f21',
    navigation: { shown: false },
    overview: { icon: false },
    handMode: true,
  },
});
await chart.load(data);
await chart.zoom('fit');

chart.on('selection-change', () => {
  const id = chart.selection()[0];
  focus(id);
  describe(id);
});
describe(null);

if (new URLSearchParams(location.search).has('debug')) window.__chart = chart;
window.ready = true;
