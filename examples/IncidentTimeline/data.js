// One production week of an online shop: deploys, incidents, planned maintenance and the pages
// that one failing service sent to another. Fixed data, identical on every load.
// Most events sit on a single service row; only pages join two rows, so the chart stays readable.
const at = (day, hour, minute = 0) => new Date(2026, 10, 16 + day, hour, minute); // day 0 = Mon 16 Nov 2026

export const WEEK = { start: at(0, 0), end: at(7, 0) };

const groups = {
  customer: { label: 'Customer facing', order: 0 },
  core: { label: 'Core services', order: 1 },
  data: { label: 'Data', order: 2 },
};

export const services = {
  web: { label: 'Web shop', group: 'customer' },
  app: { label: 'Mobile app API', group: 'customer' },
  checkout: { label: 'Checkout', group: 'core' },
  payments: { label: 'Payments', group: 'core' },
  search: { label: 'Search', group: 'core' },
  stock: { label: 'Inventory', group: 'core' },
  ordersdb: { label: 'Orders DB', group: 'data' },
  cache: { label: 'Redis cache', group: 'data' },
};

// [service, day, hour, minute, version]
const deploys = [
  ['web', 0, 10, 15, '7.3.0'], ['search', 0, 15, 40, '2.8.1'], ['app', 1, 11, 5, '5.12.0'],
  ['stock', 1, 16, 30, '3.4.2'], ['web', 2, 10, 50, '7.3.1'], ['payments', 2, 14, 20, '9.1.0'],
  ['search', 2, 17, 10, '2.8.2'], ['checkout', 3, 18, 0, '4.2.0'], ['app', 3, 11, 45, '5.12.1'],
  ['checkout', 3, 23, 15, '4.1.3 rollback'], ['web', 4, 8, 30, '7.4.0'], ['cache', 5, 2, 40, '7.2.4'],
];

// [id, service, start, end, title, severity]
const incidents = [
  ['inc-search', 'search', at(1, 14, 10), at(1, 15, 5), 'Search slower than 2 s', 3],
  ['inc-db', 'ordersdb', at(3, 21, 30), at(3, 23, 10), 'Disk full on the primary', 1],
  ['inc-checkout', 'checkout', at(3, 21, 53), at(3, 23, 5), 'Orders fail to save', 1],
  ['inc-payments', 'payments', at(4, 9, 0), at(4, 9, 40), 'Card provider timeouts', 2],
  ['inc-cache', 'cache', at(5, 3, 0), at(5, 3, 25), 'Cache node restarted', 3],
];

// [service, start, end, title]
const maintenance = [
  ['stock', at(2, 1, 0), at(2, 2, 30), 'Search index rebuild'],
  ['ordersdb', at(6, 2, 0), at(6, 4, 0), 'Planned failover test'],
];

// [from, to, time, note]: an alert from one service paging the team that owns another.
// Events on one row start at least ~11 minutes apart: closer starts merge into a summary mark
// until you zoom in (the timeline joins starts under 8 px apart).
const pages = [
  ['ordersdb', 'checkout', at(3, 21, 41), 'Write errors reached Checkout'],
  ['checkout', 'web', at(3, 22, 5), 'Order page shows errors'],
  ['payments', 'checkout', at(4, 9, 13), 'Payment step timing out'],
  ['search', 'web', at(1, 14, 28), 'Search page slow'],
];

export const colours = { deploy: '#1d4275', incident: '#c7141a', maintenance: '#9a8f88', page: '#f26f21' };

function events() {
  const out = {};
  deploys.forEach(([svc, d, h, m, version], i) => {
    out[`deploy-${i}`] = { entityIds: [svc], time: at(d, h, m), type: 'deploy', data: { kind: 'Deploy', title: `Version ${version}` } };
  });
  incidents.forEach(([id, svc, start, end, title, sev]) => {
    out[id] = { entityIds: [svc], time: { start, end }, type: 'incident', data: { kind: `Incident, severity ${sev}`, title } };
  });
  maintenance.forEach(([svc, start, end, title], i) => {
    out[`maint-${i}`] = { entityIds: [svc], time: { start, end }, type: 'maintenance', data: { kind: 'Planned maintenance', title } };
  });
  pages.forEach(([from, to, time, note], i) => {
    out[`page-${i}`] = { entityIds: { from, to }, time, type: 'page', data: { kind: 'Page', title: note } };
  });
  return out;
}

/** Hourly checkout error rate in %, with a spike during each incident. */
function errorRate() {
  const points = [];
  for (let t = +WEEK.start; t <= +WEEK.end; t += 3600e3) {
    const hour = new Date(t).getHours();
    let value = 0.2 + (hour >= 9 && hour <= 21 ? 0.15 : 0) + ((t / 3600e3) % 5) * 0.02;
    incidents.forEach(([, , start, end, , sev]) => { if (t >= +start - 1800e3 && t <= +end) value += [0, 6.5, 2.4, 0.9][sev]; });
    points.push({ time: new Date(t), value: Math.round(value * 100) / 100 });
  }
  return points;
}

export const timelineData = {
  entityTypes: Object.fromEntries(Object.entries(groups).map(([id, g]) => [id, { color: '#9a8f88', typeLabel: g.label, labelColor: '#1f1a17', order: g.order }])),
  entities: Object.fromEntries(Object.entries(services).map(([id, s]) => [id, { label: s.label, type: s.group }])),
  eventTypes: {
    deploy: { color: colours.deploy, lineWidth: 2 },
    incident: { color: colours.incident, lineWidth: 3 },
    maintenance: { color: colours.maintenance, lineWidth: 3 },
    page: { color: colours.page, lineWidth: 2, showArrows: true },
  },
  events: events(),
  timeSeriesCharts: {
    errors: { label: 'Checkout error rate (%)', color: '#c7141a', labelColor: '#1f1a17', fillAreaAlpha: 0.15, data: errorRate() },
  },
};

export const markers = [
  { label: 'Release 4.2', time: at(3, 18, 0), color: '#1d4275', labelColor: '#1d4275' },
  { label: 'INC-1042: orders down', time: { start: at(3, 21, 30), end: at(3, 23, 10) }, color: 'rgba(199, 20, 26, 0.12)', labelColor: '#c7141a' },
  { label: 'Black Friday sale', time: at(4, 9, 0), color: '#f26f21', labelColor: '#c2410c' },
];
