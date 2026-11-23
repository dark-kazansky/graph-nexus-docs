// One month of bank transfers at Red River Imports, a small fictional import company.
// Customers pay into the operating account; the company pays suppliers, rent, tax and payroll,
// and moves spare cash to savings. Each transfer is a timeline event from payer to payee; the
// chart shows one link per pair of accounts, as thick as the money moved between them.

const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute); // November 2026

export const MONTH = { start: at(1, 0), end: at(30, 23) };

export const groups = {
  customer: { label: 'Customers', colour: '#1d4275', order: 0 },
  company: { label: 'Red River Imports', colour: '#c7141a', order: 1 },
  supplier: { label: 'Suppliers', colour: '#e07b1a', order: 2 },
  other: { label: 'Other payees', colour: '#6b6560', order: 3 },
};

export const accounts = {
  bakery: { label: 'Saigon Bakery', group: 'customer', icon: 'fa-store' },
  coffee: { label: 'Hanoi Coffee Co', group: 'customer', icon: 'fa-mug-hot' },
  hotels: { label: 'Mekong Hotels', group: 'customer', icon: 'fa-hotel' },
  spa: { label: 'Lotus Spa', group: 'customer', icon: 'fa-spa' },
  operating: { label: 'Operating account', group: 'company', icon: 'fa-building-columns' },
  payroll: { label: 'Payroll account', group: 'company', icon: 'fa-wallet' },
  savings: { label: 'Savings account', group: 'company', icon: 'fa-piggy-bank' },
  farms: { label: 'Dalat Farms', group: 'supplier', icon: 'fa-seedling' },
  freight: { label: 'Cat Lai Freight', group: 'supplier', icon: 'fa-truck' },
  packaging: { label: 'Binh Duong Packaging', group: 'supplier', icon: 'fa-box' },
  landlord: { label: 'Landlord', group: 'other', icon: 'fa-house' },
  tax: { label: 'Tax office', group: 'other', icon: 'fa-landmark' },
  staff: { label: 'Staff (8 people)', group: 'other', icon: 'fa-users' },
};

// [from, to, day, hour, minute, amount in million VND, note]
// Transfers on one account are at least half a day apart: at the whole month view, starts under
// 8 px apart merge into a summary line until you zoom in.
export const transfers = [
  ['operating', 'landlord', 1, 9, 5, 45, 'November rent'],
  ['bakery', 'operating', 3, 10, 20, 42, 'Invoice 1101'],
  ['operating', 'farms', 4, 9, 40, 60, 'Coffee beans, order 77'],
  ['coffee', 'operating', 5, 11, 15, 88, 'Invoice 1102'],
  ['operating', 'freight', 6, 14, 30, 18, 'Container to Cat Lai'],
  ['farms', 'operating', 7, 10, 0, 3, 'Refund for a damaged crate'],
  ['spa', 'operating', 8, 16, 45, 25, 'Invoice 1103'],
  ['bakery', 'operating', 10, 10, 5, 39, 'Invoice 1104'],
  ['operating', 'packaging', 11, 13, 10, 22, 'Boxes and labels'],
  ['hotels', 'operating', 12, 9, 30, 130, 'Invoice 1105'],
  ['operating', 'freight', 13, 14, 0, 18, 'Container to Cat Lai'],
  ['operating', 'savings', 15, 17, 0, 100, 'Monthly saving'],
  ['bakery', 'operating', 17, 10, 40, 44, 'Invoice 1106'],
  ['operating', 'farms', 18, 9, 15, 64, 'Coffee beans, order 81'],
  ['coffee', 'operating', 19, 11, 50, 91, 'Invoice 1107'],
  ['operating', 'freight', 20, 14, 20, 21, 'Container to Cat Lai'],
  ['operating', 'tax', 21, 11, 0, 64, 'VAT for October'],
  ['spa', 'operating', 22, 15, 30, 27, 'Invoice 1108'],
  ['savings', 'operating', 23, 9, 0, 40, 'Top up before payroll'],
  ['bakery', 'operating', 24, 10, 15, 41, 'Invoice 1109'],
  ['operating', 'packaging', 25, 13, 45, 19, 'Boxes and labels'],
  ['hotels', 'operating', 26, 9, 10, 126, 'Invoice 1110'],
  ['operating', 'freight', 27, 14, 5, 18, 'Container to Cat Lai'],
  ['operating', 'payroll', 28, 10, 0, 180, 'Fund November payroll'],
  ['payroll', 'staff', 30, 9, 0, 176, 'November salaries'],
];

export const money = m => `${m.toLocaleString('en-GB')} M VND`;

export function timelineData() {
  return {
    entityTypes: Object.fromEntries(Object.entries(groups).map(([id, g]) => [id, { color: g.colour, typeLabel: g.label, labelColor: '#1f1a17', order: g.order }])),
    entities: Object.fromEntries(Object.entries(accounts).map(([id, a]) => [id, { label: a.label, type: a.group }])),
    eventTypes: { transfer: { color: 'from', lineWidth: 2.5, showArrows: true } },
    events: Object.fromEntries(transfers.map(([from, to, d, h, m, amount, note], i) => [`t${i}`, {
      entityIds: { from, to }, time: at(d, h, m), type: 'transfer', data: { amount, note },
    }])),
  };
}

export function chartData(icon) {
  // Customers on the left, the company's accounts in the middle, suppliers on the right, other payees below.
  const positions = {
    bakery: [-430, -240], coffee: [-430, -80], hotels: [-430, 80], spa: [-430, 240],
    operating: [0, -40], savings: [0, -260], payroll: [0, 200],
    farms: [430, -200], freight: [430, -40], packaging: [430, 120],
    landlord: [250, 330], tax: [430, 330], staff: [0, 400],
  };
  const items = Object.entries(accounts).map(([id, a]) => ({
    type: 'node', id, x: positions[id][0], y: positions[id][1], e: id === 'operating' ? 1.9 : 1.4, c: groups[a.group].colour,
    fi: { t: icon(a.icon), c: '#ffffff' },
    t: { t: a.label, fs: 15, fb: true, fc: '#1f1a17', fbc: 'rgba(255,255,255,0.9)', position: 's' },
  }));
  const pairs = {};
  transfers.forEach(([from, to, d, h, m, amount]) => {
    const key = `${from}>${to}`;
    pairs[key] = pairs[key] || { from, to, total: 0, times: [] };
    pairs[key].total += amount;
    pairs[key].times.push(+at(d, h, m));
  });
  Object.entries(pairs).forEach(([key, p]) => items.push({
    type: 'link', id: key, id1: p.from, id2: p.to, a2: true,
    w: 1.5 + Math.sqrt(p.total) * 0.7, c: '#d9c8c0',
    t: `${p.total} M`, fs: 13, fb: true, fc: '#6b6560', fbc: '#ffffff',
    d: { times: p.times, total: p.total, count: p.times.length },
  }));
  return { type: 'LinkChart', items };
}
