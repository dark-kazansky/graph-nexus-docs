import { createTimeline } from 'graph-nexus';
import { timelineData, markers, WEEK } from './data.js';

const info = document.getElementById('info');
await Promise.all(['16px Muli', 'bold 16px Muli'].map(f => document.fonts.load(f)));

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
    timeSeriesCharts: { position: 'bottom', sizePercent: 22 },
  },
});
timeline.set(timelineData);
timeline.markers(markers);
const week = () => timeline.range(WEEK.start, WEEK.end);
// Open on the night it went wrong: Thursday afternoon to Friday morning.
timeline.range(new Date(2026, 10, 19, 16), new Date(2026, 10, 20, 11));

const fmt = d => d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const minutes = (a, b) => Math.round((b - a) / 60000);
const span = (a, b) => { const m = minutes(a, b); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

// Click a service to focus it; click an event for its details.
timeline.on('click', ({ targetType, id }) => {
  if (targetType === 'entity') {
    const all = Object.values(timelineData.events).filter(ev => (Array.isArray(ev.entityIds) ? ev.entityIds : Object.values(ev.entityIds)).includes(id));
    const count = type => all.filter(ev => ev.type === type).length;
    timeline.focus(timeline.focus()[0] === id ? [] : [id]);
    info.textContent = `${timeline.getEntity(id).label}: ${count('deploy')} deploys, ${count('incident')} incidents, ${count('maintenance')} maintenance windows this week.`;
  } else if (targetType === 'event') {
    const ev = timeline.getEvent(id);
    const ids = Array.isArray(ev.entityIds) ? ev.entityIds : [ev.entityIds.from, ev.entityIds.to];
    const where = ids.map(e => timeline.getEntity(e).label).join(' to ');
    const when = ev.time.start ? `${fmt(ev.time.start)} to ${fmt(ev.time.end)} (${span(ev.time.start, ev.time.end)})` : fmt(ev.time);
    info.textContent = `${ev.data.kind} on ${where}: ${ev.data.title}, ${when}.`;
  }
});

document.getElementById('fit').addEventListener('click', week);

if (new URLSearchParams(location.search).has('debug')) window.__timeline = timeline;
window.ready = true;
