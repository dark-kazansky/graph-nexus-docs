import { createTimeline } from 'graph-nexus';
import { timelineData, markers } from './data.js';

const info = document.getElementById('info');
await document.fonts.load('16px Muli');

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
timeline.set(timelineData);
timeline.markers(markers);
const project = () => timeline.range(new Date(2026, 4, 30), new Date(2026, 5, 22));
project();

const fmt = d => d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// Click a person to focus their work; click a task or hand-off for details.
timeline.on('click', ({ targetType, id }) => {
  if (targetType === 'entity') {
    timeline.focus(timeline.focus()[0] === id ? [] : [id]);
    info.textContent = `${timeline.getEntity(id).label}: tasks and hand-offs.`;
  } else if (targetType === 'event') {
    const ev = timeline.getEvent(id);
    const when = ev.time.start ? `${fmt(ev.time.start)} to ${fmt(ev.time.end)}` : fmt(ev.time);
    info.textContent = `${ev.data.title}, ${when}.`;
  }
});
document.getElementById('fit').addEventListener('click', () => { timeline.focus([]); project(); });

if (new URLSearchParams(location.search).has('debug')) window.__timeline = timeline;
window.ready = true;
