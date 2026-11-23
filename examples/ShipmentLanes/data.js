// One week of shipments between nine sites of a fictional distributor, in three
// regions of Vietnam. Each link is a single shipment, so busy routes carry several
// parallel links; that is what link aggregation is for.

// North sits in the middle: every inter-region route starts there, so with Central
// on the left and South on the right no two routes cross.
export const regions = {
  central: { label: 'Central', colour: '#ec1c24', x: -460 },
  north: { label: 'North', colour: '#9d0b0f', x: 0 },
  south: { label: 'South', colour: '#f26f21', x: 460 },
};

export const modes = {
  road: { label: 'road', colour: '#8a7a72', dash: 'solid', side: 0 },
  sea: { label: 'sea', colour: '#1d4275', dash: 'solid', side: -1 },
  air: { label: 'air', colour: '#f26f21', dash: 'dashed', side: 1 },
};

// [id, name, region, icon, y]
const sites = [
  ['hp-factory', 'Hai Phong factory', 'north', 'fa-industry', -230],
  ['hp-port', 'Hai Phong port', 'north', 'fa-anchor', 0],
  ['hn-dc', 'Ha Noi DC', 'north', 'fa-warehouse', 230],
  ['dn-port', 'Da Nang port', 'central', 'fa-anchor', -230],
  ['dn-dc', 'Da Nang DC', 'central', 'fa-warehouse', 230],
  ['hue-store', 'Hue store', 'central', 'fa-store', 430],
  ['cm-port', 'Cai Mep port', 'south', 'fa-anchor', -140],
  ['bd-dc', 'Binh Duong DC', 'south', 'fa-warehouse', 120],
  ['sg-store', 'Saigon store', 'south', 'fa-store', 360],
];

// [from, to, { mode: count }]
const routes = [
  ['hp-factory', 'hp-port', { road: 4 }],
  ['hp-port', 'hn-dc', { road: 3 }],
  ['hp-port', 'dn-port', { sea: 3, air: 1 }],
  ['hp-port', 'cm-port', { sea: 4, air: 2 }],
  ['hn-dc', 'dn-dc', { road: 1, air: 1 }],
  ['dn-port', 'dn-dc', { road: 2 }],
  ['dn-dc', 'hue-store', { road: 2 }],
  ['cm-port', 'bd-dc', { road: 3 }],
  ['bd-dc', 'sg-store', { road: 3, air: 1 }],
];

export function chartData(icon) {
  const items = sites.map(([id, name, region, fa, y]) => ({
    type: 'node', id, x: regions[region].x, y, e: 1.4,
    c: regions[region].colour, fi: { t: icon(fa), c: '#ffffff' },
    t: { t: name, fs: 16, fc: '#1f1a17', fbc: 'rgba(255,255,255,0.9)', position: 's' },
    d: { region, name },
  }));
  routes.forEach(([from, to, byMode]) => {
    // Fan parallel shipments out with 'off' so each one is visible.
    const lanes = Object.entries(byMode).flatMap(([mode, n]) => Array.from({ length: n }, () => mode));
    lanes.forEach((mode, i) => {
      const m = modes[mode];
      items.push({
        type: 'link', id: `${from}>${to}#${i}`, id1: from, id2: to, a2: true,
        c: m.colour, ls: m.dash, w: 1.5, off: (i - (lanes.length - 1) / 2) * 14,
        d: { mode },
      });
    });
  });
  return { type: 'LinkChart', items };
}

export const shipmentCount = routes.reduce((sum, [, , byMode]) => sum + Object.values(byMode).reduce((a, b) => a + b, 0), 0);
