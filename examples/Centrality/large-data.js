/**
 * Large synthetic dataset for the Centrality demo: ~10k accounts with random
 * transfer links, 5% of them with no links at all.
 *
 * Generated from a fixed seed, so every load builds the same graph (no 2MB
 * data file in the repo). Same item shape as small-data.js.
 */

/** Small seeded PRNG (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Avery', 'Quinn',
  'Drew', 'Parker', 'Reese', 'Rowan', 'Skyler', 'Emerson', 'Finley', 'Hayden', 'Kendall', 'Logan'];
const LAST = ['Nguyen', 'Smith', 'Tran', 'Garcia', 'Le', 'Brown', 'Pham', 'Jones', 'Hoang', 'Miller',
  'Vu', 'Davis', 'Dang', 'Wilson', 'Bui', 'Moore', 'Do', 'Clark', 'Ho', 'Lewis'];

/**
 * @param {object} [opts]
 *   nodes       number of nodes (default 10000)
 *   orphanRate  share of nodes with no links (default 0.05)
 *   extraLinks  extra random links per linked node, on top of one per node (default 0.6)
 *   seed        PRNG seed (default 42)
 */
export function buildLargeData({ nodes = 10000, orphanRate = 0.05, extraLinks = 0.6, seed = 42 } = {}) {
  const random = seeded(seed);
  const pick = n => Math.floor(random() * n);
  const node = '#ffa726';
  const items = [];

  const ids = Array.from({ length: nodes }, (_, i) => `p${i}`);
  ids.forEach((id, i) => {
    items.push({
      type: 'node',
      id,
      t: { t: `${FIRST[pick(FIRST.length)]} ${LAST[pick(LAST.length)]}`, fs: 'auto', textWrap: 'normal' },
      d: { email: `${id}@example.com`, index: i },
      fbc: 'rgba(0,0,0,0)', fc: 'white', c: node, b: node,
    });
  });

  // Shuffle, then the first 5% are orphans and the rest get links.
  const order = ids.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const orphans = Math.round(nodes * orphanRate);
  const linked = order.slice(orphans);

  const seen = new Set();
  const addLink = (a, b) => {
    if (a === b || seen.has(`${a}-${b}`)) return;
    seen.add(`${a}-${b}`);
    items.push({
      type: 'link',
      id: `${a}-${b}`,
      id1: a,
      id2: b,
      d: { count: 1 + pick(400) },
      a2: true,
      c: '#c5d2e6',
      w: 4,
    });
  };

  // One link per node to a random earlier node keeps every linked node
  // connected (one big component, no accidental extra orphans) ...
  for (let i = 1; i < linked.length; i++) {
    const [a, b] = random() < 0.5 ? [linked[i], linked[pick(i)]] : [linked[pick(i)], linked[i]];
    addLink(a, b);
  }
  // ... then random extra links between any linked nodes.
  const extra = Math.round(linked.length * extraLinks);
  for (let k = 0; k < extra; k++) addLink(linked[pick(linked.length)], linked[pick(linked.length)]);

  return { type: 'LinkChart', items };
}
