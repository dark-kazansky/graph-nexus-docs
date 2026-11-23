import { createTimeline } from 'graph-nexus';
import { timelineData, markers } from './data.js';

const info = document.getElementById('info');

const timeline = createTimeline({
  container: 'timeline',
  options: {
    backgroundColor: '#1c1310',
    fontFamily: 'Muli',
    highlightColor: '#3a2a24',
    focus: { backgroundColor: '#4a1d14' },
    scales: { textColor: '#f3ece8', borderColor: '#5a4a44', dateOrder: 'dmy', twelveHourClock: false },
    scaleGuide: { lineColor: '#ff9f43', textColor: '#ffd9a0' },
    entities: { standardRowHeight: 30 },
    timeSeriesCharts: { position: 'bottom', sizePercent: 22 },
  },
});
timeline.set(timelineData);
timeline.markers(markers);
timeline.fit();

const fmt = d => d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Click a vessel to focus its rotation; click a call to see its details.
timeline.on('click', ({ targetType, id }) => {
  if (targetType === 'entity') {
    const e = timeline.getEntity(id);
    timeline.focus(timeline.focus()[0] === id ? [] : [id]);
    info.textContent = e.data && e.data.route ? `${e.label}: ${e.data.route}` : e.label;
  } else if (targetType === 'event') {
    const ev = timeline.getEvent(id);
    const vessel = timeline.getEntity(ev.entityIds.from).label;
    const port = timeline.getEntity(ev.entityIds.to).label;
    info.textContent = `${vessel} at ${port}, ${fmt(ev.time.start)} to ${fmt(ev.time.end)}, ${ev.data.teu} TEU${ev.data.delayed ? ', delayed by the typhoon' : ''}`;
  }
});

document.getElementById('fit').addEventListener('click', () => timeline.fit());

if (new URLSearchParams(location.search).has('debug')) window.__timeline = timeline;
window.ready = true;
