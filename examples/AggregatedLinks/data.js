import GraphNexus from 'graph-nexus';

// Supply chain: assembly lines -> storage containers -> store.
// Every link carries its transport type in d.via so the chart can aggregate by it.
const brand = '#c7141a';
const icon = name => GraphNexus.getFontIcon(`fa-solid fa-${name}`);

const nodeTypes = {
  assemblyLine: { icon: 'gears', level: 1 },
  container: { icon: 'box-archive', level: 2 },
  store: { icon: 'store', level: 3 },
};

const transports = {
  road: { icon: 'truck', colour: '#8a7a72' },
  air: { icon: 'plane', colour: '#f26f21' },
  rail: { icon: 'train', colour: '#1d4275' },
};

/** Pill-shaped label under a node or combo. */
export const pillLabel = text => ({
  t: text, position: 's', fbc: brand, fc: 'white', borderRadius: 15, padding: '6 4 4 4',
});

function node(id, text, type) {
  const { icon: name, level } = nodeTypes[type];
  return { type: 'node', id, c: 'white', b: brand, d: { level }, fi: { c: brand, t: icon(name) }, t: [pillLabel(text)] };
}

let linkCount = 0;
function link(from, to, via) {
  const { icon: name, colour } = transports[via];
  return {
    type: 'link', id: `${from}-${to}-${++linkCount}`, id1: from, id2: to,
    c: colour, w: 2, a2: true, d: { via },
    g: [{ c: 'white', b: colour, fi: { c: colour, t: icon(name) } }],
  };
}

function supplyChain() {
  const items = [
    node('assemblyLine1', 'Assembly Line 1', 'assemblyLine'),
    node('assemblyLine2', 'Assembly Line 2', 'assemblyLine'),
    node('superstore', 'Store', 'store'),
  ];
  for (let i = 1; i <= 3; i++) {
    const id = `storage1-container-${i}`;
    items.push(node(id, `container-${i}`, 'container'),
      link('assemblyLine1', id, i === 1 ? 'air' : 'road'),
      link(id, 'superstore', i > 1 ? 'rail' : 'road'));
  }
  for (let i = 1; i <= 4; i++) {
    const id = `storage2-container-${i}`;
    items.push(node(id, `container-${i}`, 'container'),
      link('assemblyLine2', id, i > 2 ? 'road' : 'rail'),
      link(id, 'superstore', i > 2 ? 'rail' : 'road'));
  }
  return items;
}

export const data = { type: 'LinkChart', items: supplyChain() };

/** Closed-combo style: a child node's look with a different icon and label. */
function comboStyle(chart, childId, iconName, text) {
  const child = chart.getItem(childId);
  return { c: child.c, b: child.b, d: child.d, fi: { ...child.fi, t: icon(iconName) }, t: [pillLabel(text)] };
}

function comboDef(chart, ids, childId, iconName, label) {
  return {
    ids, open: false, label,
    style: comboStyle(chart, childId, iconName, label),
    openStyle: { c: 'rgba(255,245,240,0.7)', b: brand, bw: 2, bs: 'dashed', t: [{ ...pillLabel(label), margin: 5 }] },
  };
}

/** Groups the assembly lines into a factory and the containers into nested warehouses. */
export async function combineNodes(chart) {
  const storage1 = [];
  const storage2 = [];
  chart.each({ type: 'node' }, ({ id }) => {
    if (id.startsWith('storage1')) storage1.push(id);
    if (id.startsWith('storage2')) storage2.push(id);
  });
  const combo = chart.combo();
  const opts = { select: false, animate: false };

  const [factory] = await combo.combine(
    [comboDef(chart, ['assemblyLine1', 'assemblyLine2'], 'assemblyLine1', 'industry', 'Factory')], opts);
  const warehouses = await combo.combine([
    comboDef(chart, storage1, storage1[0], 'warehouse', 'Warehouse 1'),
    comboDef(chart, storage2, storage2[0], 'warehouse', 'Warehouse 2'),
  ], opts);
  combo.arrange(warehouses, { gridShape: { columns: 1 }, animate: false });
  const [allWarehouses] = await combo.combine(
    [comboDef(chart, warehouses, storage1[0], 'warehouse', 'Warehouses')], opts);
  combo.arrange([factory, allWarehouses], { gridShape: { columns: 1 }, animate: false });
}
