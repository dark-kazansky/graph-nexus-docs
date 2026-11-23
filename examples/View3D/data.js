// A fictional data centre network, six tiers deep: the internet edge, firewalls,
// core routers, aggregation switches, access switches and servers. Links point
// downstream (towards the servers), so the sequential layout reads top to bottom.

export const tiers = [
  { label: 'Internet', colour: '#1f1a17', icon: 'fa-globe', e: 2.2 },
  { label: 'Firewall', colour: '#9d0b0f', icon: 'fa-shield-halved', e: 1.7 },
  { label: 'Core router', colour: '#c7141a', icon: 'fa-network-wired', e: 1.7 },
  { label: 'Aggregation', colour: '#ec1c24', icon: 'fa-sitemap', e: 1.35 },
  { label: 'Access switch', colour: '#f26f21', icon: 'fa-ethernet', e: 1.1 },
  { label: 'Server', colour: '#f9a26c', icon: 'fa-server', e: 0.85 },
];

export function chartData(icon) {
  const items = [];
  const node = (id, tier, label) => {
    const t = tiers[tier];
    items.push({
      type: 'node', id, e: t.e, c: t.colour,
      fi: { t: icon(t.icon), c: '#ffffff' },
      t: { t: label, fs: 12, fc: '#1f1a17', fbc: 'rgba(255,255,255,0.85)', position: 's' },
      d: { tier, tierLabel: t.label, name: label },
    });
  };
  const link = (a, b, w = 1.5) => items.push({ type: 'link', id: `${a}>${b}`, id1: a, id2: b, a2: true, w, c: '#cdbfb8' });

  node('internet', 0, 'Internet');
  ['fw-a', 'fw-b'].forEach((id, i) => { node(id, 1, `Firewall ${'AB'[i]}`); link('internet', id, 3); });
  ['core-1', 'core-2'].forEach((id, i) => {
    node(id, 2, `Core ${i + 1}`);
    link('fw-a', id, 3); link('fw-b', id, 3);
  });
  for (let a = 1; a <= 4; a++) {
    const agg = `agg-${a}`;
    node(agg, 3, `Aggregation ${a}`);
    link('core-1', agg, 2.5); link('core-2', agg, 2.5);
    for (let s = 1; s <= 3; s++) {
      const acc = `acc-${a}${s}`;
      node(acc, 4, `Rack ${a}${String.fromCharCode(64 + s)}`);
      link(agg, acc, 2);
      for (let v = 1; v <= 3; v++) {
        const srv = `srv-${a}${s}${v}`;
        node(srv, 5, `Server ${a}${String.fromCharCode(64 + s)}${v}`);
        link(acc, srv, 1.2);
      }
    }
  }
  return { type: 'LinkChart', items };
}
