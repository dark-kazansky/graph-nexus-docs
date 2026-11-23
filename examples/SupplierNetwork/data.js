// A fictional electronics maker and its supply chain, four tiers deep. All company
// names are invented. Links point from supplier to buyer; each link is one shipment
// lane, and busy pairs have several lanes (sea, air, road) so they can be aggregated.

export const tiers = [
  { label: 'Assembly', colour: '#9d0b0f', icon: 'fa-industry', e: 2.6 },
  { label: 'Tier 1', colour: '#ec1c24', icon: 'fa-microchip', e: 1.8 },
  { label: 'Tier 2', colour: '#f26f21', icon: 'fa-gears', e: 1.3 },
  { label: 'Raw material', colour: '#f9a26c', icon: 'fa-mountain', e: 1.0 },
];

export const countries = {
  vn: 'Vietnam', cn: 'China', kr: 'South Korea', jp: 'Japan', tw: 'Taiwan', my: 'Malaysia', au: 'Australia', cl: 'Chile',
};

// [id, name, country, tier, buyers]
const companies = [
  ['plant', 'Nexa Devices, Binh Duong', 'vn', 0, []],

  ['pcb', 'Saigon PCB Works', 'vn', 1, ['plant']],
  ['display', 'Han River Displays', 'kr', 1, ['plant']],
  ['battery', 'Kanto Cells', 'jp', 1, ['plant']],
  ['casing', 'Pearl Delta Casings', 'cn', 1, ['plant']],
  ['optics', 'Hsinchu Optics', 'tw', 1, ['plant']],
  ['pack', 'Mekong Packaging', 'vn', 1, ['plant']],

  ['laminate', 'Copper Laminate Co', 'cn', 2, ['pcb']],
  ['solder', 'Penang Solder', 'my', 2, ['pcb', 'display']],
  ['chips', 'Taoyuan Chips', 'tw', 2, ['pcb', 'optics', 'display']],
  ['glass', 'Busan Glass', 'kr', 2, ['display', 'optics']],
  ['drivers', 'Shenzhen Drivers', 'cn', 2, ['display']],
  ['films', 'Osaka Films', 'jp', 2, ['display', 'battery']],
  ['lithium', 'Gansu Lithium Refining', 'cn', 2, ['battery']],
  ['separator', 'Nagoya Separators', 'jp', 2, ['battery']],
  ['cathode', 'Ulsan Cathodes', 'kr', 2, ['battery']],
  ['alloys', 'Dongguan Alloys', 'cn', 2, ['casing']],
  ['moulding', 'Hai Phong Moulding', 'vn', 2, ['casing', 'pack']],
  ['plastics', 'Johor Plastics', 'my', 2, ['casing']],
  ['lenses', 'Tainan Lenses', 'tw', 2, ['optics']],
  ['sensors', 'Suwon Sensors', 'kr', 2, ['optics']],
  ['paper', 'Dong Nai Paper', 'vn', 2, ['pack']],
  ['inks', 'Bac Ninh Inks', 'vn', 2, ['pack']],

  ['copper', 'Atacama Copper', 'cl', 3, ['laminate', 'solder', 'alloys']],
  ['tin', 'Perak Tin', 'my', 3, ['solder']],
  ['silica', 'Quang Nam Silica', 'vn', 3, ['glass', 'chips', 'lenses']],
  ['brine', 'Salar Lithium Brine', 'cl', 3, ['lithium']],
  ['spodumene', 'Pilbara Spodumene', 'au', 3, ['lithium']],
  ['nickel', 'Sulawesi Nickel Trade', 'cn', 3, ['cathode', 'alloys']],
  ['graphite', 'Heilongjiang Graphite', 'cn', 3, ['separator', 'cathode']],
  ['bauxite', 'Weipa Bauxite', 'au', 3, ['alloys']],
  ['resin', 'Map Ta Phut Resin', 'my', 3, ['plastics', 'moulding', 'films']],
  ['pulp', 'Tasmania Pulp', 'au', 3, ['paper']],
  ['rare', 'Bayan Rare Earths', 'cn', 3, ['drivers', 'sensors', 'chips']],
  ['indium', 'Kyushu Indium', 'jp', 3, ['glass', 'films']],

  // Structurally equivalent suppliers (same single buyer): the structural layout groups them.
  ['carton1', 'An Phu Carton', 'vn', 3, ['paper']],
  ['carton2', 'Tan Uyen Carton', 'vn', 3, ['paper']],
  ['carton3', 'Di An Carton', 'vn', 3, ['paper']],
  ['carton4', 'Ben Cat Carton', 'vn', 3, ['paper']],
  ['carton5', 'Thu Dau Mot Carton', 'vn', 3, ['paper']],
  ['cobalt1', 'Ningbo Cobalt Trading', 'cn', 3, ['cathode']],
  ['cobalt2', 'Ganzhou Cobalt Trading', 'cn', 3, ['cathode']],
  ['cobalt3', 'Kalgoorlie Cobalt', 'au', 3, ['cathode']],
  ['cobalt4', 'Kumamoto Cobalt Works', 'jp', 3, ['cathode']],
];

// Lanes per pair: deterministic from the ids, 1 to 3 lanes, each with a transport mode.
const MODES = ['sea', 'air', 'road'];
const laneCount = (a, b) => 1 + ((a.length * 7 + b.length * 3) % 3);

export function chartData(icon) {
  const items = [];
  companies.forEach(([id, name, country, tier]) => {
    const t = tiers[tier];
    items.push({
      type: 'node', id, c: t.colour, e: t.e,
      fi: { t: icon(t.icon), c: '#ffffff' },
      t: { t: name, fs: 12, fc: '#1f1a17', fbc: 'rgba(255,255,255,0.85)', position: 's' },
      d: { name, country, tier, tierLabel: t.label },
    });
  });
  companies.forEach(([id, , , , buyers]) => {
    buyers.forEach(buyer => {
      for (let i = 0; i < laneCount(id, buyer); i++) {
        const mode = MODES[(id.length + i) % 3];
        items.push({
          type: 'link', id: `${id}>${buyer}#${i}`, id1: id, id2: buyer, a2: true,
          c: mode === 'air' ? '#f26f21' : mode === 'road' ? '#b8a69c' : '#d9c8c0',
          w: 1.5, ls: mode === 'air' ? 'dashed' : 'solid',
          d: { mode },
        });
      }
    });
  });
  return { type: 'LinkChart', items };
}
