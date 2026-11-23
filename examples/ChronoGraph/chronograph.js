import GraphNexus, { createTimeline } from 'graph-nexus';

const getJSON = (f) => fetch(`data/${f}`).then((r) => r.json());

const [timelineData, chartData, labels] = await Promise.all([
  getJSON('phones-timeline-data.json'),
  getJSON('phones-chart-data.json'),
  getJSON('entity-label-data.json'),
]);

// The dataset has 10 self-calls (same id twice); the timeline rejects duplicate entityIds.
// Each call is shown at the moment it started, as a dot like the other timelines, rather than
// as a bar over its few minutes; the chart still filters on the full call times.
Object.values(timelineData.events).forEach((ev) => {
  ev.entityIds = [...new Set(ev.entityIds)];
  ev.time = new Date(ev.time.start);
});
delete timelineData.eventTypes.default.fontIcon;

const timeline = createTimeline('kg');
timeline.set(timelineData);
timeline.fit();

const chart = await GraphNexus.create({ container: 'kl', options: { backColour: '#2d383f' } });
await chart.load(chartData);
await chart.zoom('fit');

// Timeline range -> show only chart links with a call inside the range.
async function syncRange() {
  const { start, end } = timeline.range();
  const s = +start;
  const e = +end;
  await chart.filter(
    (link) => link.dt.some(({ dt1, dt2 }) => dt1 <= e && dt2 >= s),
    { type: 'link', hideSingletons: true, animate: false },
  );
}
timeline.on('range', syncRange);

// Chart selection -> focus those people in the timeline.
function focusPeople(ids) {
  timeline.focus(ids.filter((id) => timelineData.entities[id]));
}
chart.on('selection-change', () => focusPeople(chart.selection()));

function selectPerson(id) {
  chart.selection([id]);
  chart.zoom('selection', { animate: true, time: 300 });
  focusPeople([id]);
}

// Timeline click on a person -> select in chart.
timeline.on('click', ({ targetType, id }) => {
  if (targetType === 'entity') selectPerson(id);
});

// Search box.
const input = document.getElementById('searchInput');
document.getElementById('searchList').innerHTML = Object.keys(labels)
  .sort()
  .map((name) => `<option value="${name}"></option>`)
  .join('');
input.addEventListener('change', () => {
  if (labels[input.value]) selectPerson(labels[input.value]);
});

await syncRange();
