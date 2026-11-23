import GraphNexus from 'graph-nexus';

// A checkout platform drawn as a service map. Every node is one Nexus node:
// the cards, status pills, metric rows and CPU bars are all node labels.
const icon = name => GraphNexus.getFontIcon(`fa-solid ${name}`);

export const palette = {
  ink: '#1f1a17',
  grey: '#6b6560',
  line: '#e9dbd4',
  card: '#ffffff',
  tile: '#1f1a17',
  link: '#cdbfb8',
  status: {
    healthy: { label: 'Healthy', fg: '#0f7a53', bg: '#e3f4ec' },
    degraded: { label: 'Degraded', fg: '#b4470c', bg: '#fdecdf' },
    down: { label: 'Down', fg: '#c7141a', bg: '#fde4e4' },
  },
};

const W = 260;
const H = 150;
const BAR = W - 28;

/** A service card: icon tile, name, owner, status pill, two metrics and a CPU bar. */
function service({ id, x, y, name, owner, fa, status, p95, rpm, cpu, metric = 'CPU', external = false }) {
  const s = palette.status[status];
  const barColour = metric !== 'CPU' ? palette.status.down.fg : cpu >= 85 ? palette.status.down.fg : cpu >= 70 ? palette.status.degraded.fg : palette.status.healthy.fg;
  const node = {
    type: 'node',
    id,
    x,
    y,
    w: W,
    h: H,
    c: palette.card,
    b: status === 'healthy' ? palette.line : s.fg,
    bw: status === 'healthy' ? 1.5 : 3,
    bs: external ? 'dashed' : 'solid',
    borderRadius: 14,
    d: { kind: 'service', name, status, p95, rpm, cpu, metric, owner },
    t: [
      // Icon tile
      { fi: { t: icon(fa) }, fs: 20, fc: '#ffffff', fbc: external ? palette.grey : palette.tile, borderRadius: 9,
        minWidth: 40, minHeight: 40, position: { horizontal: 14, vertical: 14 } },
      // Name and owner
      { t: name, fs: 16, fb: true, fc: palette.ink, fbc: 'transparent', position: { horizontal: 66, vertical: 15 } },
      { t: owner, fs: 11, fc: palette.grey, fbc: 'transparent', position: { horizontal: 66, vertical: 37 } },
      // Status pill
      { t: `●  ${s.label}`, fs: 11, fb: true, fc: s.fg, fbc: s.bg, borderRadius: 10, padding: '3 9',
        position: { horizontal: 14, vertical: 66 } },
      // Metrics
      { t: `p95 ${p95} ms`, fs: 12, fc: palette.ink, fbc: 'transparent', position: { horizontal: 14, vertical: 98 } },
      { t: `${rpm} rpm`, fs: 12, fc: palette.ink, fbc: 'transparent', position: { horizontal: 112, vertical: 98 } },
      { t: `${metric} ${cpu}%`, fs: 12, fb: true, fc: barColour, fbc: 'transparent', position: { horizontal: 192, vertical: 98 } },
      // CPU bar: track, then fill
      { fs: 0, fbc: '#f3ebe7', borderRadius: 4, minWidth: BAR, minHeight: 8, padding: 0, margin: 0,
        position: { horizontal: 14, vertical: 124 } },
      { fs: 0, fbc: barColour, borderRadius: 4, minWidth: Math.max(8, Math.round(BAR * cpu / 100)), minHeight: 8, padding: 0, margin: 0,
        position: { horizontal: 14, vertical: 124 } },
    ],
  };
  if (status === 'down') {
    node.g = [{ c: palette.status.down.fg, fi: { t: icon('fa-triangle-exclamation'), c: '#ffffff' }, p: 'ne', e: 1.6, a: true }];
  }
  return node;
}

/** A KPI tile: caption, big value and change against the previous hour. */
function kpi({ id, x, y, caption, value, change, good }) {
  return {
    type: 'node', id, x, y, w: 260, h: 120, c: palette.tile, borderRadius: 14,
    d: { kind: 'kpi', caption, value },
    t: [
      { t: caption, fs: 12, fc: '#d9cbc4', fbc: 'transparent', position: { horizontal: 18, vertical: 16 } },
      { t: value, fs: 40, fb: true, fc: '#ffffff', fbc: 'transparent', position: { horizontal: 16, vertical: 36 } },
      { t: `${good ? '▲' : '▼'} ${change} vs last hour`, fs: 12, fb: true,
        fc: good ? '#5fd3a3' : '#ff8a5c', fbc: 'transparent', position: { horizontal: 18, vertical: 92 } },
    ],
  };
}

/** An incident badge: a pill-shaped node with an icon and a summary. */
function incident({ id, x, y, ref, summary }) {
  return {
    type: 'node', id, x, y, w: 'auto', h: 'auto', c: palette.status.down.fg, borderRadius: 22,
    d: { kind: 'incident', ref, summary },
    t: [
      { fi: { t: icon('fa-bell') }, fs: 16, fc: '#ffffff', fbc: 'transparent', padding: '12 6 12 16' },
      { t: ref, fs: 13, fb: true, fc: '#ffffff', fbc: 'transparent', padding: '12 6', position: { vertical: 'inherit' } },
      { t: summary, fs: 13, fc: '#ffe2d6', fbc: 'transparent', padding: '12 18 12 0', position: { vertical: 'inherit' } },
    ],
  };
}

/** A request path. Width follows traffic; the label shows requests per minute. */
function call(id1, id2, rpm, { hot = false, async = false } = {}) {
  return {
    type: 'link', id: `${id1}>${id2}`, id1, id2, a2: true,
    w: 1 + Math.min(6, rpm / 900),
    c: hot ? palette.status.degraded.fg : palette.link,
    ls: async ? 'dashed' : 'solid',
    flow: hot ? { velocity: 4 } : false,
    t: async ? 'async' : `${(rpm / 1000).toFixed(1)}k rpm`,
    fs: 11, fc: hot ? palette.status.degraded.fg : palette.grey, fbc: '#ffffff',
    d: { rpm },
  };
}

// Six services on one request path, so each card is large enough to read.
export const data = {
  type: 'LinkChart',
  items: [
    kpi({ id: 'kpi-success', x: -700, y: -230, caption: 'Checkout success rate', value: '97.4%', change: '0.6%', good: false }),
    kpi({ id: 'kpi-orders', x: -400, y: -230, caption: 'Orders in the last hour', value: '3,182', change: '4.1%', good: true }),
    incident({ id: 'inc-2041', x: 170, y: -230, ref: 'INC 2041', summary: 'Checkout p95 above 800 ms since 14:05' }),

    service({ id: 'web', x: -700, y: 0, name: 'Web storefront', owner: 'web team', fa: 'fa-globe', status: 'healthy', p95: 118, rpm: '4.6k', cpu: 34 }),
    service({ id: 'gateway', x: -350, y: 0, name: 'API gateway', owner: 'platform', fa: 'fa-shield-halved', status: 'healthy', p95: 21, rpm: '4.6k', cpu: 52 }),
    service({ id: 'checkout', x: 0, y: 0, name: 'Checkout', owner: 'payments team', fa: 'fa-cart-shopping', status: 'degraded', p95: 842, rpm: '1.9k', cpu: 78 }),
    service({ id: 'payments', x: 350, y: 0, name: 'Payments', owner: 'payments team', fa: 'fa-credit-card', status: 'degraded', p95: 611, rpm: '1.8k', cpu: 73 }),
    service({ id: 'bank', x: 700, y: 0, name: 'Card network', owner: 'external', fa: 'fa-building-columns', status: 'down', p95: 2930, rpm: '1.8k', cpu: 31, metric: 'Errors', external: true }),
    service({ id: 'orders-db', x: 0, y: 240, name: 'Orders DB', owner: 'data platform', fa: 'fa-database', status: 'healthy', p95: 9, rpm: '1.9k', cpu: 88 }),

    call('web', 'gateway', 4600),
    call('gateway', 'checkout', 1900, { hot: true }),
    call('checkout', 'payments', 1800, { hot: true }),
    call('payments', 'bank', 1800, { hot: true }),
    call('checkout', 'orders-db', 1900),
    { type: 'link', id: 'inc>checkout', id1: 'inc-2041', id2: 'checkout', c: palette.status.down.fg, w: 2, ls: 'dotted' },
  ],
};
