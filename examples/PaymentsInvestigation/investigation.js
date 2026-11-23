import GraphNexus, { createTimeline } from 'graph-nexus';
import { timelineData, chartData, markers, entities, formatVnd } from './data.js';

const info = document.getElementById('info');
const icon = name => GraphNexus.getFontIcon(`fa-solid ${name}`);

await document.fonts.load('900 16px FontAwesomeSolid');
await document.fonts.load('16px Muli');

// ---- timeline ----
const timeline = createTimeline({
  container: 'timeline',
  options: {
    backgroundColor: '#1c1310',
    fontFamily: 'Muli',
    highlightColor: '#3a2a24',
    focus: { backgroundColor: '#4a1d14' },
    scales: { textColor: '#f3ece8', borderColor: '#5a4a44', dateOrder: 'dmy', twelveHourClock: false },
    scaleGuide: { lineColor: '#ff9f43', textColor: '#ffd9a0' },
    events: { heatmapValue: 'amount' },
  },
});
timeline.set(timelineData());
timeline.markers(markers);
// The case window: the first transfer to the day accounts were frozen, with a little margin.
const caseWindow = () => timeline.range(new Date(2026, 2, 1), new Date(2026, 3, 2));
caseWindow();

// ---- chart ----
const chart = await GraphNexus.create({
  container: 'chart',
  options: {
    backColour: '#1c1310',
    fontFamily: 'Muli',
    iconFontFamily: 'FontAwesomeSolid',
    selectionColour: '#ffd9a0',
    navigation: { shown: false },
    overview: { icon: false },
    handMode: true,
  },
});
await chart.load(chartData(icon));
await chart.layout('organic', { animate: false, tightness: 3 });

// Timeline range -> show only money that moved inside the range.
async function syncRange() {
  const { start, end } = timeline.range();
  const s = +start;
  const e = +end;
  const { shown } = await chart.filter(link => link.d.times.some(t => t >= s && t <= e),
    { type: 'link', hideSingletons: true, animate: true, time: 250 });
  const total = shown.links.reduce((sum, id) => sum + chart.getItem(id).d.total, 0);
  if (!chart.selection().length) info.textContent = `${shown.links.length} money flows in view, ${formatVnd(total)} in total.`;
}
timeline.on('range', syncRange);

// Chart selection -> focus those parties in the timeline.
chart.on('selection-change', () => {
  const ids = chart.selection().filter(id => entities[id]);
  timeline.focus(ids);
  if (ids.length === 1) {
    const node = chart.getItem(ids[0]);
    info.textContent = `${node.t.t}: ${node.d.role}, ${formatVnd(node.d.total)} moved in or out.`;
  }
});

// Timeline click on a party -> select it in the chart.
timeline.on('click', ({ targetType, id }) => {
  if (targetType !== 'entity' || !entities[id]) return;
  chart.selection([id]);
  chart.zoom('selection', { animate: true, time: 300 });
  timeline.focus([id]);
});

document.getElementById('fit').addEventListener('click', () => {
  chart.selection([]);
  timeline.focus([]);
  caseWindow();
});

await syncRange();
await chart.zoom('fit');
if (new URLSearchParams(location.search).has('debug')) { window.__chart = chart; window.__timeline = timeline; }
window.ready = true;
