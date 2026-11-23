// Six weeks of container port calls along the Vietnamese coast, generated from
// fixed rotations so the data is identical on every load (no randomness).
// Each port call is a timeline event joining a vessel row to a port row.

const HOUR = 3600 * 1000;
const START = new Date(2026, 7, 3, 6, 0).getTime(); // 3 Aug 2026, 06:00 local
const END = new Date(2026, 8, 13, 0, 0).getTime(); // 13 Sep 2026

export const ports = {
  hph: 'Hai Phong',
  dad: 'Da Nang',
  qnh: 'Quy Nhon',
  cmp: 'Cai Mep',
  sgn: 'Cat Lai',
};

// Sailing time in hours between ports.
const sail = {
  'hph-dad': 30, 'dad-qnh': 16, 'qnh-cmp': 26, 'cmp-sgn': 5, 'hph-qnh': 44,
  'dad-cmp': 40, 'hph-cmp': 66, 'dad-sgn': 44, 'qnh-sgn': 30, 'hph-sgn': 70,
};
const sailHours = (a, b) => sail[`${a}-${b}`] || sail[`${b}-${a}`];

const fleets = {
  north: { label: 'Northern loop', colour: '#ff7a59' },
  south: { label: 'Southern shuttle', colour: '#ffb23f' },
  feeder: { label: 'Feeder', colour: '#5fc9b8' },
};

const vessels = [
  { id: 'song-hong', name: 'MV Song Hong', fleet: 'north', route: ['hph', 'dad', 'qnh', 'cmp'], offset: 0 },
  { id: 'lam-son', name: 'MV Lam Son', fleet: 'north', route: ['hph', 'qnh', 'cmp', 'dad'], offset: 50 },
  { id: 'ha-long', name: 'MV Ha Long Star', fleet: 'north', route: ['cmp', 'qnh', 'dad', 'hph'], offset: 20 },
  { id: 'mekong', name: 'MV Mekong Pearl', fleet: 'south', route: ['cmp', 'sgn', 'qnh'], offset: 8 },
  { id: 'phu-quoc', name: 'MV Phu Quoc', fleet: 'south', route: ['sgn', 'cmp', 'dad'], offset: 30 },
  { id: 'con-dao', name: 'MV Con Dao', fleet: 'feeder', route: ['cmp', 'sgn'], offset: 4 },
  { id: 'ben-thanh', name: 'MV Ben Thanh', fleet: 'feeder', route: ['sgn', 'cmp'], offset: 16 },
];

// Typhoon window: northern ports close and calls there run long.
export const typhoon = { start: new Date(2026, 7, 17, 0).getTime(), end: new Date(2026, 7, 19, 12).getTime() };
const northern = new Set(['hph', 'dad']);

/** Deterministic dwell time in hours: 18 to 41 depending on vessel, port and call number. */
const dwellHours = (vi, port, n) => 18 + ((vi * 7 + port.charCodeAt(0) * 3 + n * 11) % 24);

function buildEvents() {
  const events = {};
  vessels.forEach((v, vi) => {
    let t = START + v.offset * HOUR;
    let n = 0;
    while (t < END) {
      const port = v.route[n % v.route.length];
      let dwell = dwellHours(vi, port, n);
      const overlapsStorm = t < typhoon.end && t + dwell * HOUR > typhoon.start;
      const delayed = overlapsStorm && northern.has(port);
      if (delayed) dwell += 30;
      const end = Math.min(t + dwell * HOUR, END);
      events[`${v.id}-${n}`] = {
        entityIds: { from: v.id, to: port },
        time: { start: new Date(t), end: new Date(end) },
        type: delayed ? 'delayed' : 'call',
        data: { teu: 400 + ((vi * 131 + n * 97) % 1100), delayed },
      };
      const next = v.route[(n + 1) % v.route.length];
      t = end + sailHours(port, next) * HOUR;
      n += 1;
    }
  });
  return events;
}

/** Daily congestion index for Cai Mep (vessels waiting at anchor), peaking after the storm. */
function congestion() {
  const points = [];
  for (let t = START, d = 0; t <= END; t += 24 * HOUR, d += 1) {
    const afterStorm = t > typhoon.end ? Math.max(0, 9 - (t - typhoon.end) / (24 * HOUR)) : 0;
    const weekly = (d % 7 === 0 || d % 7 === 1) ? 2 : 0;
    points.push({ time: new Date(t), value: 3 + weekly + Math.round(afterStorm * 10) / 10 + (d % 3) });
  }
  return points;
}

export const timelineData = {
  entityTypes: {
    ...Object.fromEntries(Object.entries(fleets).map(([id, f], i) => [id, { color: f.colour, typeLabel: f.label, labelColor: '#f3ece8', order: i }])),
    port: { color: '#9aa7b1', typeLabel: 'Ports', labelColor: '#f3ece8', order: 9 },
  },
  entities: {
    ...Object.fromEntries(vessels.map(v => [v.id, { label: v.name, type: v.fleet, data: { route: v.route.map(p => ports[p]).join(' → ') } }])),
    ...Object.fromEntries(Object.entries(ports).map(([id, name]) => [id, { label: name, type: 'port' }])),
  },
  eventTypes: {
    call: { color: 'from', lineWidth: 3, showArrows: false },
    delayed: { color: '#ff4d4f', lineWidth: 4, showArrows: false },
  },
  events: buildEvents(),
  timeSeriesCharts: {
    congestion: { label: 'Cai Mep congestion (ships waiting)', color: '#ff9f43', labelColor: '#f3ece8', fillAreaAlpha: 0.35, data: congestion() },
  },
};

export const markers = [
  { label: 'Typhoon warning', time: { start: new Date(typhoon.start), end: new Date(typhoon.end) }, color: 'rgba(255, 77, 79, 0.18)', labelColor: '#ffb3b3' },
  { label: 'Cai Mep crane upgrade', time: new Date(2026, 7, 26, 8), color: '#ffb23f', labelColor: '#ffd9a0' },
  { label: 'Quarter close', time: new Date(2026, 8, 1, 0), color: '#9aa7b1', labelColor: '#d6dde2' },
];
