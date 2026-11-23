// One launch week of messages between six colleagues at a fictional company.
// Each message is a timeline event between two people; the chart shows one link
// per pair, as thick as the number of messages they exchanged.

const at = (day, hour, minute = 0) => new Date(2026, 6, 6 + day, hour, minute); // Mon 6 Jul 2026

export const people = {
  lan: { label: 'Lan', role: 'Product manager', colour: '#9d0b0f', icon: 'fa-user-tie' },
  huy: { label: 'Huy', role: 'Designer', colour: '#ec1c24', icon: 'fa-pen-ruler' },
  trang: { label: 'Trang', role: 'Engineer', colour: '#f26f21', icon: 'fa-code' },
  phuc: { label: 'Phuc', role: 'Engineer', colour: '#f26f21', icon: 'fa-code' },
  mai: { label: 'Mai', role: 'Support', colour: '#1d4275', icon: 'fa-headset' },
  khoa: { label: 'Khoa', role: 'Sales', colour: '#1d4275', icon: 'fa-briefcase' },
};

// [from, to, day (0 = Monday), hour]
const messages = [
  ['lan', 'huy', 0, 9], ['lan', 'trang', 0, 10], ['lan', 'phuc', 0, 11], ['lan', 'mai', 0, 14], ['lan', 'khoa', 0, 16],
  ['huy', 'trang', 1, 9], ['trang', 'huy', 1, 13], ['huy', 'trang', 1, 17], ['huy', 'lan', 1, 15],
  ['trang', 'phuc', 2, 9], ['phuc', 'trang', 2, 12], ['trang', 'phuc', 2, 15], ['phuc', 'trang', 2, 18], ['trang', 'lan', 2, 11],
  ['mai', 'phuc', 3, 9], ['mai', 'phuc', 3, 13], ['phuc', 'mai', 3, 16], ['khoa', 'lan', 3, 11], ['lan', 'khoa', 3, 15],
  ['khoa', 'mai', 3, 18],
  ['lan', 'huy', 4, 9], ['lan', 'trang', 4, 10], ['lan', 'phuc', 4, 11], ['lan', 'mai', 4, 13], ['lan', 'khoa', 4, 14],
  ['phuc', 'lan', 4, 16],
];

export const WEEK = { start: at(0, 7), end: at(4, 20) };

export function timelineData() {
  return {
    entityTypes: { person: { color: '#c7141a', labelColor: '#1f1a17', typeLabel: false } },
    entities: Object.fromEntries(Object.entries(people).map(([id, p]) => [id, { label: p.label, type: 'person', color: p.colour }])),
    eventTypes: { message: { color: 'from', lineWidth: 2.5, showArrows: true } },
    events: Object.fromEntries(messages.map(([from, to, d, h], i) => [`m${i}`, {
      entityIds: { from, to }, time: at(d, h), type: 'message',
    }])),
  };
}

export function chartData(icon) {
  const pairs = {};
  messages.forEach(([from, to, d, h]) => {
    const key = from < to ? `${from}|${to}` : `${to}|${from}`;
    pairs[key] = pairs[key] || { a: key.split('|')[0], b: key.split('|')[1], times: [] };
    pairs[key].times.push(+at(d, h));
  });
  const positions = { lan: [0, 0], huy: [-260, -170], trang: [0, -260], phuc: [260, -170], mai: [220, 190], khoa: [-220, 190] };
  const items = Object.entries(people).map(([id, p]) => ({
    type: 'node', id, x: positions[id][0], y: positions[id][1], e: 1.5, c: p.colour,
    fi: { t: icon(p.icon), c: '#ffffff' },
    t: { t: `${p.label} · ${p.role}`, fs: 15, fb: true, fc: '#1f1a17', fbc: 'rgba(255,255,255,0.9)', position: 's' },
  }));
  Object.entries(pairs).forEach(([key, pr]) => items.push({
    type: 'link', id: key, id1: pr.a, id2: pr.b, w: 1.5 + pr.times.length * 1.2, c: '#d9c8c0',
    t: `${pr.times.length}`, fs: 14, fb: true, fc: '#6b6560', fbc: '#ffffff',
    d: { times: pr.times },
  }));
  return { type: 'LinkChart', items };
}
