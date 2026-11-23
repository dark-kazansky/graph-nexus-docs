import GraphNexus, { createTimeline } from 'graph-nexus';
import { timelineData, chartData, people, WEEK } from './data.js';

const info = document.getElementById('info');
const icon = name => GraphNexus.getFontIcon(`fa-solid ${name}`);
await Promise.all(['900 16px FontAwesomeSolid', '16px Muli', 'bold 16px Muli'].map(f => document.fonts.load(f)));

// ---- timeline: one row per person, one arrow per message ----
const timeline = createTimeline({
  container: 'timeline',
  options: {
    backgroundColor: '#ffffff',
    fontFamily: 'Muli',
    highlightColor: '#fdeee7',
    focus: { backgroundColor: '#fde4e4' },
    scales: { textColor: '#1f1a17', borderColor: '#e9dbd4', dateOrder: 'dmy', twelveHourClock: false },
    scaleGuide: { lineColor: '#c7141a', textColor: '#c7141a' },
    entities: { standardRowHeight: 34 },
  },
});
timeline.set(timelineData());
const week = () => timeline.range(WEEK.start, WEEK.end);
week();

// ---- chart: who talked to whom, link width = number of messages ----
const chart = await GraphNexus.create({
  container: 'chart',
  options: {
    backColour: '#ffffff', fontFamily: 'Muli', iconFontFamily: 'FontAwesomeSolid',
    selectionColour: '#1f1a17', navigation: { shown: false }, overview: { icon: false }, handMode: true,
  },
});
await chart.load(chartData(icon));
await chart.zoom('fit');

// Timeline range -> chart shows only the pairs who messaged inside it.
async function syncRange() {
  const { start, end } = timeline.range();
  const s = +start;
  const e = +end;
  const { shown } = await chart.filter(link => link.d.times.some(t => t >= s && t <= e),
    { type: 'link', hideSingletons: true, animate: true, time: 300 });
  if (!chart.selection().length) {
    const n = shown.links.reduce((sum, id) => sum + chart.getItem(id).d.times.filter(t => t >= s && t <= e).length, 0);
    info.textContent = `${n} messages between ${shown.nodes.length} people in view.`;
  }
}
timeline.on('range', syncRange);

// Chart selection -> focus those people in the timeline.
chart.on('selection-change', () => {
  const ids = chart.selection().filter(id => people[id]);
  timeline.focus(ids);
  if (ids.length === 1) info.textContent = `${people[ids[0]].label}'s messages this week.`;
});
// Timeline click on a person -> select them in the chart.
timeline.on('click', ({ targetType, id }) => {
  if (targetType !== 'entity' || !people[id]) return;
  chart.selection([id]);
  timeline.focus([id]);
  info.textContent = `${people[id].label}'s messages this week.`;
});

document.getElementById('fit').addEventListener('click', () => {
  chart.selection([]);
  timeline.focus([]);
  week();
  // Setting the range from code fires no 'range' event, so refresh the chart filter here.
  syncRange();
});

await syncRange();
if (new URLSearchParams(location.search).has('debug')) { window.__chart = chart; window.__timeline = timeline; }
window.ready = true;
