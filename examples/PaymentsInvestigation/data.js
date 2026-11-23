// A fictional money-laundering case: cash is broken into small deposits by two
// money mules, layered through three shell companies, then cashed out through a
// crypto exchange and an offshore importer. Every name here is invented.
// Amounts are in millions of VND. The data is built from fixed rules, so it is
// the same on every load.

const DAY = 24 * 3600 * 1000;
export const START = new Date(2026, 2, 2, 9, 0).getTime(); // 2 Mar 2026
const at = (day, hour = 10, minute = 0) => new Date(START + day * DAY + (hour - 9) * 3600 * 1000 + minute * 60000);

export const roles = {
  subject: { label: 'Subject', colour: '#ff4d4f', icon: 'fa-user-secret' },
  mule: { label: 'Money mules', colour: '#ff9f43', icon: 'fa-user' },
  person: { label: 'Associates', colour: '#f3c27a', icon: 'fa-user' },
  shell: { label: 'Shell companies', colour: '#e8618c', icon: 'fa-building' },
  exit: { label: 'Cash out', colour: '#6b8cc0', icon: 'fa-coins' },
};

export const entities = {
  khoa: { label: 'Tran Minh Khoa', role: 'subject' },
  ha: { label: 'Le Thu Ha', role: 'person' },
  bao: { label: 'Pham Quoc Bao', role: 'person' },
  an: { label: 'Vu Duc An', role: 'mule' },
  tam: { label: 'Do Thanh Tam', role: 'mule' },
  linh: { label: 'Ngo Hai Linh', role: 'mule' },
  saoviet: { label: 'Sao Mai Trading', role: 'shell' },
  hoanglong: { label: 'Hoang Phat Logistics', role: 'shell' },
  lotus: { label: 'Blue Lotus Holdings', role: 'shell' },
  coin: { label: 'Kestrel Coin Exchange', role: 'exit', icon: 'fa-coins' },
  reef: { label: 'Coral Reef Imports (offshore)', role: 'exit', icon: 'fa-globe' },
  gold: { label: 'Kim Thanh Gold Shop', role: 'exit', icon: 'fa-gem' },
};

// Each rule repeats a transfer on a set of days: [from, to, amount, days, hour].
const rules = [
  // Structuring: mules deposit just under the 300m reporting threshold, almost daily.
  ['an', 'saoviet', 285, [3, 4, 5, 8, 9, 10, 11, 12, 15, 16, 17], 11],
  ['tam', 'saoviet', 290, [4, 5, 9, 10, 11, 15, 16, 17], 14],
  ['linh', 'hoanglong', 275, [8, 9, 10, 12, 15, 16, 17, 18], 10],
  // The subject feeds the mules in cash-sized chunks.
  ['khoa', 'an', 900, [2, 7, 14], 9],
  ['khoa', 'tam', 750, [3, 8, 14], 9],
  ['khoa', 'linh', 800, [7, 14], 9],
  // Layering between shells.
  ['saoviet', 'lotus', 1450, [6, 13, 19], 16],
  ['hoanglong', 'lotus', 1100, [11, 18], 16],
  ['saoviet', 'hoanglong', 400, [12], 15],
  // Cash out.
  ['lotus', 'coin', 1200, [13, 20, 22], 17],
  ['lotus', 'reef', 1600, [20, 23], 17],
  ['hoanglong', 'gold', 380, [19, 21], 13],
  // Ordinary household traffic, for contrast.
  ['ha', 'khoa', 42, [0, 7, 14, 21], 19],
  ['khoa', 'bao', 25, [5, 12, 19, 26], 20],
  ['bao', 'ha', 18, [1, 9, 16, 24], 18],
];

export const transfers = [];
rules.forEach(([from, to, amount, days, hour], r) => {
  days.forEach((d, i) => {
    // Vary amounts slightly so repeated transfers are not identical.
    const value = amount + ((r * 13 + i * 7) % 9) - 4;
    transfers.push({ id: `${from}-${to}-${d}`, from, to, amount: value, time: at(d, hour, (r * 11 + i * 17) % 60) });
  });
});

export const markers = [
  { label: 'Blue Lotus account opened', time: at(5, 9), color: '#e8618c', labelColor: '#ffc2d6' },
  { label: 'Structuring alert', time: at(17, 15), color: '#ff9f43', labelColor: '#ffd9a0' },
  { label: 'Accounts frozen', time: at(24, 9), color: '#ff4d4f', labelColor: '#ffb3b3' },
];

/** Timeline: one row per party, grouped by role; each transfer joins two rows. */
export function timelineData() {
  return {
    entityTypes: Object.fromEntries(Object.entries(roles).map(([id, r], i) => [id, { color: r.colour, typeLabel: r.label, labelColor: '#f3ece8', order: i }])),
    entities: Object.fromEntries(Object.entries(entities).map(([id, e]) => [id, { label: e.label, type: e.role }])),
    eventTypes: { transfer: { color: 'from', lineWidth: 2, showArrows: true } },
    events: Object.fromEntries(transfers.map(t => [t.id, {
      entityIds: { from: t.from, to: t.to }, time: t.time, type: 'transfer', data: { amount: t.amount },
    }])),
  };
}

const formatVnd = m => (m >= 1000 ? `${(m / 1000).toFixed(1)}B ₫` : `${Math.round(m)}M ₫`);

/** Chart: one node per party, one link per direction carrying the total and every transfer time. */
export function chartData(icon) {
  const totals = {};
  const links = {};
  transfers.forEach(t => {
    totals[t.from] = (totals[t.from] || 0) + t.amount;
    totals[t.to] = (totals[t.to] || 0) + t.amount;
    const key = `${t.from}>${t.to}`;
    links[key] = links[key] || { from: t.from, to: t.to, total: 0, times: [] };
    links[key].total += t.amount;
    links[key].times.push(+t.time);
  });
  const max = Math.max(...Object.values(totals));
  const items = Object.entries(entities).map(([id, e]) => {
    const r = roles[e.role];
    return {
      type: 'node', id, c: r.colour, e: 1 + Math.sqrt(totals[id] / max) * 2.2,
      fi: { t: icon(e.icon || r.icon), c: '#1c1310' },
      t: { t: e.label, fc: '#f3ece8', fbc: 'rgba(28,19,16,0.75)', fs: 13, position: 's' },
      ...(e.role === 'subject' ? { ha0: { c: '#ff4d4f', r: 38, w: 6 } } : {}),
      d: { role: r.label, total: totals[id] },
    };
  });
  Object.entries(links).forEach(([key, l]) => {
    items.push({
      type: 'link', id: key, id1: l.from, id2: l.to, a2: true,
      w: 1 + Math.sqrt(l.total / 4800) * 6,
      c: roles[entities[l.from].role].colour,
      t: formatVnd(l.total), fc: '#f3ece8', fbc: 'rgba(28,19,16,0.85)', fs: 11,
      d: { times: l.times, total: l.total, count: l.times.length },
    });
  });
  return { type: 'LinkChart', items };
}

export { formatVnd };
