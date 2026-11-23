import GraphNexus, { createTimeline } from 'graph-nexus';
import { timelineData, chartData, accounts, transfers, money, MONTH } from './data.js';

const info = document.getElementById('info');
const icon = name => GraphNexus.getFontIcon(`fa-solid ${name}`);
await Promise.all(['900 16px FontAwesomeSolid', '16px Muli', 'bold 16px Muli'].map(f => document.fonts.load(f)));

// ---- timeline: one row per account, one arrow per transfer, payer to payee ----
const timeline = createTimeline({
  container: 'timeline',
  options: {
    backgroundColor: '#ffffff',
    fontFamily: 'Muli',
    highlightColor: '#fdeee7',
    focus: { backgroundColor: '#fde4e4' },
    scales: { textColor: '#1f1a17', borderColor: '#e9dbd4', dateOrder: 'dmy', twelveHourClock: false },
    scaleGuide: { lineColor: '#c7141a', textColor: '#c7141a' },
    entities: { standardRowHeight: 32 },
  },
});
timeline.set(timelineData());
const month = () => timeline.range(MONTH.start, MONTH.end);
month();

// ---- chart: who paid whom, link width = money moved ----
const chart = await GraphNexus.create({
  container: 'chart',
  options: {
    backColour: '#ffffff', fontFamily: 'Muli', iconFontFamily: 'FontAwesomeSolid',
    selectionColour: '#1f1a17', navigation: { shown: false }, overview: { icon: false }, handMode: true,
  },
});
await chart.load(chartData(icon));
await chart.zoom('fit');

const fmtDay = t => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Timeline range -> chart shows only the accounts that moved money inside it.
async function syncRange() {
  const { start, end } = timeline.range();
  const s = +start;
  const e = +end;
  const { shown } = await chart.filter(link => link.d.times.some(t => t >= s && t <= e),
    { type: 'link', hideSingletons: true, animate: true, time: 300 });
  if (!chart.selection().length) {
    const inView = transfers.filter(([, , d, h, m]) => { const t = +new Date(2026, 10, d, h, m); return t >= s && t <= e; });
    const total = inView.reduce((sum, tr) => sum + tr[5], 0);
    info.textContent = `${inView.length} transfers worth ${money(total)} between ${shown.nodes.length} accounts in view.`;
  }
}
timeline.on('range', syncRange);

/** Select an account in the chart and focus it in the timeline, with a one line summary. */
function showAccount(id) {
  chart.selection([id]);
  timeline.focus([id]);
  const paidIn = transfers.filter(t => t[1] === id).reduce((sum, t) => sum + t[5], 0);
  const paidOut = transfers.filter(t => t[0] === id).reduce((sum, t) => sum + t[5], 0);
  info.textContent = `${accounts[id].label}: received ${money(paidIn)}, paid out ${money(paidOut)} in November.`;
}

chart.on('selection-change', () => {
  const ids = chart.selection().filter(id => accounts[id]);
  if (ids.length === 1) showAccount(ids[0]);
  else timeline.focus(ids);
});

timeline.on('click', ({ targetType, id }) => {
  if (targetType === 'entity' && accounts[id]) showAccount(id);
  else if (targetType === 'event') {
    const ev = timeline.getEvent(id);
    info.textContent = `${accounts[ev.entityIds.from].label} paid ${accounts[ev.entityIds.to].label} ${money(ev.data.amount)} on ${fmtDay(ev.time)}: ${ev.data.note}.`;
  }
});

// Find an account by name.
const search = document.getElementById('search');
document.getElementById('accounts').innerHTML = Object.values(accounts).map(a => `<option value="${a.label}"></option>`).join('');
search.addEventListener('change', () => {
  const id = Object.keys(accounts).find(k => accounts[k].label.toLowerCase() === search.value.trim().toLowerCase());
  if (id) showAccount(id);
});

document.getElementById('fit').addEventListener('click', () => {
  chart.selection([]);
  timeline.focus([]);
  search.value = '';
  month();
  // Setting the range from code fires no 'range' event, so refresh the chart filter here.
  syncRange();
});

await syncRange();
if (new URLSearchParams(location.search).has('debug')) { window.__chart = chart; window.__timeline = timeline; }
window.ready = true;
