/**
 * SCAFFOLD layouts and arrangements for the Graph Nexus chart.
 *
 * Original code, written from textbook methods (Fruchterman-Reingold forces,
 * BFS / longest-path layering with barycentre ordering, ring placement). It is
 * NOT derived from the vendor build in `references/` or from `test.js`.
 *
 *
 * Every layout mutates `x`/`y` on the node objects it is given and skips
 * nodes flagged `hi` (hidden). Callers that want animation pass clones and
 * tween to the result.
 */


/** Node body radius at `e: 1`, measured against the reference demo (54px across at zoom 1). */
import { forceStepsWasm } from './wasmCore.js';

export const DEFAULT_NODE_RADIUS = 27;
/** Default border width; drawn outside the body and scaled with `e`, like the body. */
export const DEFAULT_BORDER_WIDTH = 4;

/** Full extent of a node: body plus its outside border. */
const radiusOf = node => (node.e || 1) * (DEFAULT_NODE_RADIUS + (node.b ? (node.bw ?? DEFAULT_BORDER_WIDTH) : 0));
/**
 * Radius of the disc that holds a node and its outside labels (compass position,
 * e.g. 's'), estimated from text length and font size. Ring layouts space by this
 * so a label never runs into the next node.
 */
const footprintOf = node => {
  const r = radiusOf(node);
  const labels = [].concat(node.t || []).map(l => (typeof l === 'string' ? { t: l } : l))
    .filter(l => l && l.t != null && typeof l.position === 'string');
  if (!labels.length) return r;
  const size = l => (l.fs > 0 ? l.fs : node.fs > 0 ? node.fs : 14);
  const wide = Math.max(...labels.map(l => String(l.t).length * size(l) * 0.56 + 8));
  const tall = labels.reduce((sum, l) => sum + size(l) * 1.4, 0);
  return Math.max(r + tall, wide / 2);
};

/** Small seeded PRNG (mulberry32) so `consistent: true` repeats a layout exactly. */
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Visible node ids and the deduplicated, undirected edges between them. */
function visibleGraph(nodes, links) {
  const ids = Object.keys(nodes).filter(id => !nodes[id].hi);
  const live = new Set(ids);
  const edges = Object.values(links)
    .filter(l => !l.hi && live.has(l.id1) && live.has(l.id2) && l.id1 !== l.id2)
    .map(l => [l.id1, l.id2, l]);
  const adj = new Map(ids.map(id => [id, new Set()]));
  edges.forEach(([a, b]) => { adj.get(a).add(b); adj.get(b).add(a); });
  return { ids, edges, adj };
}

/** Connected components, largest first. */
function components(ids, adj) {
  const seen = new Set();
  const out = [];
  ids.forEach(start => {
    if (seen.has(start)) return;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop();
      comp.push(id);
      adj.get(id).forEach(n => { if (!seen.has(n)) { seen.add(n); stack.push(n); } });
    }
    out.push(comp);
  });
  return out.sort((p, q) => q.length - p.length);
}

function recentre(nodes, ids) {
  let cx = 0; let cy = 0;
  ids.forEach(id => { cx += nodes[id].x; cy += nodes[id].y; });
  cx /= ids.length; cy /= ids.length;
  ids.forEach(id => { nodes[id].x -= cx; nodes[id].y -= cy; });
}

/**
 * Smallest circle (approximately) enclosing a component's node discs, by
 * Badoiu-Clarkson iteration: repeatedly step toward the farthest disc.
 */
function enclosingCircle(nodes, ids) {
  let cx = 0; let cy = 0;
  ids.forEach(id => { cx += nodes[id].x; cy += nodes[id].y; });
  cx /= ids.length; cy /= ids.length;
  const reach = id => Math.hypot(nodes[id].x - cx, nodes[id].y - cy) + radiusOf(nodes[id]);
  // ponytail: fixed 400 steps converges to well under a world unit for demo
  // graphs; Welzl's algorithm is the exact upgrade.
  for (let k = 1; k <= 400 && ids.length > 1; k++) {
    let far = ids[0];
    ids.forEach(id => { if (reach(id) > reach(far)) far = id; });
    cx += (nodes[far].x - cx) / (k + 1);
    cy += (nodes[far].y - cy) / (k + 1);
  }
  return { cx, cy, r: Math.max(...ids.map(reach)) };
}

/** Padding around a packed circle: 12% of its radius, between 20 and 200. */
const packPadding = r => Math.min(200, Math.max(20, 0.12 * r));

/**
 * Packs components the way the reference demo's output is arranged (measured,
 * not copied): the largest component's enclosing circle in the middle; every
 * other component on a ring around it, each padded circle touching the
 * padded main circle; the first satellite on the right and the rest
 * alternating below/above it, each touching its neighbour on that side.
 * Finally the whole drawing's bounding box is centred on `centre`.
 */
/**
 * Shelf packing: components (largest first) fill rows of a roughly square
 * area. 'aligned' tops each row's components; 'rectangle' centres them.
 */
function packRect(nodes, comps, centre = { x: 0, y: 0 }, aligned = false) {
  if (comps.length === 0) return;
  const gap = DEFAULT_NODE_RADIUS * 2;
  const boxes = comps.map(ids => {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    ids.forEach(id => {
      const n = nodes[id]; const r = radiusOf(n);
      minX = Math.min(minX, n.x - r); maxX = Math.max(maxX, n.x + r);
      minY = Math.min(minY, n.y - r); maxY = Math.max(maxY, n.y + r);
    });
    return { ids, minX, minY, w: maxX - minX, h: maxY - minY };
  }).sort((a, b) => b.w * b.h - a.w * a.h);
  const area = boxes.reduce((sum, b) => sum + (b.w + gap) * (b.h + gap), 0);
  const rowWidth = Math.max(boxes[0].w, Math.sqrt(area) * 1.2);
  let x = 0; let y = 0; let rowH = 0;
  const rows = [[]];
  boxes.forEach(b => {
    if (x > 0 && x + b.w > rowWidth) { x = 0; y += rowH + gap; rowH = 0; rows.push([]); }
    b.tx = x; b.ty = y;
    rows[rows.length - 1].push(b);
    x += b.w + gap;
    rowH = Math.max(rowH, b.h);
  });
  rows.forEach(row => {
    const h = Math.max(...row.map(b => b.h));
    row.forEach(b => { if (!aligned) b.ty += (h - b.h) / 2; });
  });
  const totalW = Math.max(...boxes.map(b => b.tx + b.w));
  const totalH = Math.max(...boxes.map(b => b.ty + b.h));
  boxes.forEach(b => {
    const dx = centre.x - totalW / 2 + b.tx - b.minX;
    const dy = centre.y - totalH / 2 + b.ty - b.minY;
    b.ids.forEach(id => { nodes[id].x += dx; nodes[id].y += dy; });
  });
}

/** Applies the `packing` option to laid-out components. */
function packComponents(nodes, comps, centre, packing) {
  if (packing === 'none') return;
  if (packing === 'rectangle' || packing === 'aligned') packRect(nodes, comps, centre, packing === 'aligned');
  else packOnArc(nodes, comps, centre);
}

function packOnArc(nodes, comps, centre = { x: 0, y: 0 }) {
  if (comps.length === 0) return;
  const circles = comps.map(ids => ({ ids, ...enclosingCircle(nodes, ids) }));
  const moveTo = (c, x, y) => c.ids.forEach(id => { nodes[id].x += x - c.cx; nodes[id].y += y - c.cy; });
  const [main, ...rest] = circles;
  moveTo(main, 0, 0);
  const ringR = main.r + packPadding(main.r);
  const last = {};
  let up = 0; let down = 0;
  rest.forEach((c, k) => {
    const rp = c.r + packPadding(c.r);
    const d = ringR + rp;
    let angle = 0;
    if (k === 0) last.up = last.down = { rp, d };
    else {
      const side = k % 2 === 1 ? 'down' : 'up';
      const prev = last[side];
      // Angle at which this circle's centre is (rp + prev.rp) from the previous one.
      const want = rp + prev.rp;
      const cos = (d * d + prev.d * prev.d - want * want) / (2 * d * prev.d);
      const step = Math.acos(Math.max(-1, Math.min(1, cos)));
      if (side === 'down') { down += step; angle = down; } else { up -= step; angle = up; }
      last[side] = { rp, d };
    }
    moveTo(c, Math.cos(angle) * d, Math.sin(angle) * d);
  });
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  comps.flat().forEach(id => {
    const n = nodes[id]; const r = radiusOf(n);
    minX = Math.min(minX, n.x - r); maxX = Math.max(maxX, n.x + r);
    minY = Math.min(minY, n.y - r); maxY = Math.max(maxY, n.y + r);
  });
  const dx = centre.x - (minX + maxX) / 2;
  const dy = centre.y - (minY + maxY) / 2;
  comps.flat().forEach(id => { nodes[id].x += dx; nodes[id].y += dy; });
}

/** Centre of the bounding box of `ids` before a layout moves them. */
function boxCentre(nodes, ids) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  ids.forEach(id => {
    const n = nodes[id]; const x = n.x || 0; const y = n.y || 0; const r = radiusOf(n);
    minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r);
  });
  return ids.length ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : { x: 0, y: 0 };
}

/* ---------------------------------------------------------------------------
 * Force-directed (organic / tweak)
 * ------------------------------------------------------------------------- */

/**
 * @param {object} opts
 *   iterations  steps to run (default 300)
 *   adaptive    keep current positions and move them gently (tweak / adaptive)
 *   fixed       ids that must not move
 *   random      PRNG, for `consistent`
 *   tightness   0-10, default 5; higher packs closer
 */
const BH_THRESHOLD = 400;
const BH_THETA = 0.9;

/**
 * Barnes-Hut repulsion: a quadtree of node positions; distant cells act as one
 * body (count, mean radius) when cell size / distance < theta. Accumulates
 * into `disp` the same force law as the exact loop: (ra + rb + gap)^2 / d.
 */
function barnesHut(nodes, ids, radius, gap, disp, random) {
  // Flat typed arrays (no per-cell objects or string lookups in the hot loop).
  const n = ids.length;
  const xs = new Float64Array(n); const ys = new Float64Array(n); const rad = new Float64Array(n);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = nodes[ids[i]];
    xs[i] = v.x; ys[i] = v.y; rad[i] = radius(ids[i]);
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
  }
  const cap = n * 8 + 16;
  let cx0 = new Float64Array(cap); let cy0 = new Float64Array(cap); let cs = new Float64Array(cap);
  let cnt = new Int32Array(cap); let mx = new Float64Array(cap); let my = new Float64Array(cap);
  let rs = new Float64Array(cap); let kid = new Int32Array(cap).fill(-1); let leaf = new Int32Array(cap).fill(-1);
  let cells = 1;
  const grow = () => {
    const more = (a, fill) => { const b = new a.constructor(a.length * 2); if (fill !== undefined) b.fill(fill); b.set(a); return b; };
    cx0 = more(cx0); cy0 = more(cy0); cs = more(cs); cnt = more(cnt); mx = more(mx); my = more(my);
    rs = more(rs); kid = more(kid, -1); leaf = more(leaf, -1);
  };
  cx0[0] = minX; cy0[0] = minY; cs[0] = Math.max(maxX - minX, maxY - minY, 1) * 1.0001;
  const childFor = (c, i) => {
    const h = cs[c] / 2;
    return kid[c] + (xs[i] >= cx0[c] + h ? 1 : 0) + (ys[i] >= cy0[c] + h ? 2 : 0);
  };
  const split = (c) => {
    if (cells + 4 > cx0.length) grow();
    kid[c] = cells;
    const h = cs[c] / 2;
    for (let q = 0; q < 4; q++) {
      const k = cells++;
      cx0[k] = cx0[c] + (q & 1) * h; cy0[k] = cy0[c] + (q >> 1) * h; cs[k] = h;
      cnt[k] = 0; mx[k] = 0; my[k] = 0; rs[k] = 0; kid[k] = -1; leaf[k] = -1;
    }
  };
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let depth = 0; ; depth++) {
      mx[c] = (mx[c] * cnt[c] + xs[i]) / (cnt[c] + 1);
      my[c] = (my[c] * cnt[c] + ys[i]) / (cnt[c] + 1);
      rs[c] += rad[i];
      cnt[c]++;
      if (cnt[c] === 1) { leaf[c] = i; break; }
      if (depth > 40) break; // coincident points stay lumped in one leaf
      if (kid[c] < 0) {
        split(c);
        const old = leaf[c];
        if (old >= 0) {
          leaf[c] = -1;
          const k = childFor(c, old);
          mx[k] = xs[old]; my[k] = ys[old]; rs[k] = rad[old]; cnt[k] = 1; leaf[k] = old;
        }
      }
      c = childFor(c, i);
    }
  }
  const theta2 = BH_THETA * BH_THETA;
  const stack = new Int32Array(cells + 8);
  for (let i = 0; i < n; i++) {
    const vx = xs[i]; const vy = ys[i]; const rv = rad[i];
    let fx = 0; let fy = 0;
    let top = 0;
    stack[top++] = 0;
    while (top > 0) {
      const c = stack[--top];
      const count = cnt[c];
      if (count === 0 || (count === 1 && leaf[c] === i)) continue;
      let dx = vx - mx[c];
      let dy = vy - my[c];
      let distSq = dx * dx + dy * dy;
      if (kid[c] >= 0 && cs[c] * cs[c] > theta2 * distSq) {
        const k = kid[c];
        stack[top++] = k; stack[top++] = k + 1; stack[top++] = k + 2; stack[top++] = k + 3;
        continue;
      }
      if (distSq < 0.01) { dx = random() - 0.5; dy = random() - 0.5; distSq = 0.01; }
      const dist = Math.sqrt(distSq);
      const kk = rv + rs[c] / count + gap;
      const force = ((kk * kk) / dist) * count;
      fx += (dx / dist) * force;
      fy += (dy / dist) * force;
    }
    const d = disp[ids[i]];
    d.x += fx; d.y += fy;
  }
}

/** Spatial hash: returns i -> indices of nodes in the same or adjacent cells. */
function gridNeighbours(nodes, ids, cell) {
  const grid = new Map();
  const key = (gx, gy) => `${gx},${gy}`;
  ids.forEach((id, i) => {
    const k = key(Math.floor(nodes[id].x / cell), Math.floor(nodes[id].y / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  return i => {
    const gx = Math.floor(nodes[ids[i]].x / cell);
    const gy = Math.floor(nodes[ids[i]].y / cell);
    const out = [];
    for (let x = gx - 1; x <= gx + 1; x++) for (let y = gy - 1; y <= gy + 1; y++) out.push(...(grid.get(key(x, y)) || []));
    return out;
  };
}

export function forceLayout(nodes, links, opts = {}) {
  const { ids, edges, adj } = visibleGraph(nodes, links);
  if (ids.length === 0) return;
  // The drawing stays centred where it was, as in the reference.
  const centre = boxCentre(nodes, ids);
  const comps = components(ids, adj);
  comps.forEach(comp => {
    const set = new Set(comp);
    (opts.dimensions === 3 ? forceComponent3D : forceComponent)(nodes, comp, edges.filter(([a]) => set.has(a)), opts);
  });
  if (opts.fixed && opts.fixed.length) return;
  // Adaptive runs keep each component's own arrangement but still re-pack the
  // components, translating them whole, so a grown cluster cannot swallow the
  // arc of small components beside it.
  if (opts.packing === 'none') return;
  if (opts.dimensions === 3) { packSphere(nodes, comps, centre); return; }
  if (opts.adaptive) comps.forEach(comp => recentre(nodes, comp));
  packComponents(nodes, comps, centre, opts.packing === 'adaptive' ? 'circle' : opts.packing);
}

/** Components above this size settle in at most LARGE_ITERATIONS steps (same quality, measured). */
const LARGE_COMPONENT = 2000;
const LARGE_ITERATIONS = 100;

function forceComponent(nodes, ids, edges, opts) {
  const n = ids.length;
  const random = opts.random || Math.random;
  const fixed = new Set(opts.fixed || []);
  const iterations = n > LARGE_COMPONENT ? Math.min(opts.iterations || 300, LARGE_ITERATIONS) : opts.iterations || 300;
  if (n === 1) {
    const only = nodes[ids[0]];
    const placed = Number.isFinite(only.x) && Number.isFinite(only.y);
    // Adaptive runs keep a placed singleton where it is, but must still place an unplaced one.
    if (!fixed.has(ids[0]) && (!opts.adaptive || !placed)) { only.x = 0; only.y = 0; }
    return;
  }

  const tight = Math.min(10, Math.max(0, opts.tightness ?? 5));
  const gap = DEFAULT_NODE_RADIUS * (1 + (10 - tight) * 0.4);
  const k = DEFAULT_NODE_RADIUS * 2 + gap;
  const r = id => radiusOf(nodes[id]);

  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const span = cols * k;
  ids.forEach((id, i) => {
    const node = nodes[id];
    const unplaced = !Number.isFinite(node.x) || !Number.isFinite(node.y) || (node.x === 0 && node.y === 0);
    if (unplaced && (!opts.adaptive || !fixed.has(id))) {
      node.x = (i % cols) * k - span / 2 + (random() - 0.5) * k * 0.5;
      node.y = Math.floor(i / cols) * k - span / 2 + (random() - 0.5) * k * 0.5;
    }
  });

  // Gravity and gap are calibrated so the Enron demo matches the reference's
  // scale: median / 90th-percentile link length and cluster radius
  // 244 / 441 / 1548 against 243 / 430 / 1545.
  const gravity = 0.0075;
  let temperature = span * (opts.adaptive ? 0.02 : 0.1);
  const minTemp = k * 0.01;
  const cooling = (temperature - minTemp) / (iterations + 1);
  // Adaptive runs pull toward where the component already is, not the origin.
  let gx = 0; let gy = 0;
  if (opts.adaptive) { ids.forEach(id => { gx += nodes[id].x; gy += nodes[id].y; }); gx /= n; gy /= n; }

  // Exact pairwise repulsion for small components (the calibrated path);
  // Barnes-Hut (quadtree, theta 0.9) above BH_THRESHOLD nodes.
  const useTree = n > BH_THRESHOLD;
  // The iterations run in the WebAssembly core when available (same results; see wasmCore.js).
  const viaWasm = forceStepsWasm({ dims: 2, nodes, ids, edges, radius: r, fixed, iterations, gap, k, gravity, temperature, minTemp, cooling, gx, gy, useTree, random });
  if (!viaWasm) for (let step = 0; step < iterations; step++) {
    const disp = {};
    ids.forEach(id => { disp[id] = { x: 0, y: 0 }; });
    if (useTree) barnesHut(nodes, ids, r, gap, disp, random);
    else for (let a = 0; a < n; a++) {
      const va = nodes[ids[a]];
      for (let b = a + 1; b < n; b++) {
        const vb = nodes[ids[b]];
        let dx = va.x - vb.x;
        let dy = va.y - vb.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 0.01) { dx = random() - 0.5; dy = random() - 0.5; distSq = 0.01; }
        const dist = Math.sqrt(distSq);
        const kk = r(ids[a]) + r(ids[b]) + gap;
        const force = (kk * kk) / dist;
        disp[ids[a]].x += (dx / dist) * force; disp[ids[a]].y += (dy / dist) * force;
        disp[ids[b]].x -= (dx / dist) * force; disp[ids[b]].y -= (dy / dist) * force;
      }
    }
    edges.forEach(([id1, id2]) => {
      const v1 = nodes[id1];
      const v2 = nodes[id2];
      const dx = v1.x - v2.x;
      const dy = v1.y - v2.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / (r(id1) + r(id2) + gap);
      disp[id1].x -= (dx / dist) * force; disp[id1].y -= (dy / dist) * force;
      disp[id2].x += (dx / dist) * force; disp[id2].y += (dy / dist) * force;
    });
    ids.forEach(id => {
      if (fixed.has(id)) return;
      const node = nodes[id];
      const d = disp[id];
      d.x -= (node.x - gx) * gravity * k;
      d.y -= (node.y - gy) * gravity * k;
      const len = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      node.x += (d.x / len) * Math.min(len, temperature);
      node.y += (d.y / len) * Math.min(len, temperature);
    });
    temperature = Math.max(temperature - cooling, minTemp);
  }

  // Springs can still pull big hubs into each other; push overlapping pairs apart.
  // Large components only compare nodes in neighbouring grid cells.
  const maxR = Math.max(...ids.map(r));
  for (let pass = 0; pass < 20; pass++) {
    let moved = false;
    const near = useTree ? gridNeighbours(nodes, ids, maxR * 2 + DEFAULT_NODE_RADIUS * 0.4) : null;
    for (let a = 0; a < n; a++) {
      const va = nodes[ids[a]];
      const others = near ? near(a) : null;
      for (let bi = others ? 0 : a + 1, end = others ? others.length : n; bi < end; bi++) {
        const b = others ? others[bi] : bi;
        if (b <= a) continue;
        const vb = nodes[ids[b]];
        const min = r(ids[a]) + r(ids[b]) + DEFAULT_NODE_RADIUS * 0.4;
        const dx = vb.x - va.x;
        const dy = vb.y - va.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        if (dist >= min) continue;
        const push = (min - dist) / 2;
        if (!fixed.has(ids[a])) { va.x -= (dx / dist) * push; va.y -= (dy / dist) * push; }
        if (!fixed.has(ids[b])) { vb.x += (dx / dist) * push; vb.y += (dy / dist) * push; }
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (!opts.adaptive && fixed.size === 0) recentre(nodes, ids);
}

/* ---------------------------------------------------------------------------
 * 3D force-directed (organic / tweak with dimensions: 3)
 *
 * Same force law, constants and cooling as forceComponent, with z carried
 * through. Kept separate so the calibrated 2D path (and its random sequence
 * under `consistent`) is untouched.
 * ------------------------------------------------------------------------- */

/**
 * Barnes-Hut repulsion in 3D: an octree of node positions; a cell acts as one
 * body when its size / distance < theta. Same force law as barnesHut.
 */
function barnesHut3D(nodes, ids, radius, gap, disp, random) {
  const n = ids.length;
  const xs = new Float64Array(n); const ys = new Float64Array(n); const zs = new Float64Array(n); const rad = new Float64Array(n);
  let loX = Infinity; let loY = Infinity; let loZ = Infinity; let hiX = -Infinity; let hiY = -Infinity; let hiZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = nodes[ids[i]];
    xs[i] = v.x; ys[i] = v.y; zs[i] = v.z; rad[i] = radius(ids[i]);
    if (v.x < loX) loX = v.x; if (v.x > hiX) hiX = v.x;
    if (v.y < loY) loY = v.y; if (v.y > hiY) hiY = v.y;
    if (v.z < loZ) loZ = v.z; if (v.z > hiZ) hiZ = v.z;
  }
  // Cells in flat typed arrays (struct of arrays), grown by doubling: origin (ox, oy, oz),
  // size, count, mean position, radius sum, first child, leaf node.
  let cap = 0; let used = 0;
  let ox; let oy; let oz; let cs; let cnt; let mx; let my; let mz; let rs; let kid; let leaf;
  const grow = need => {
    const next = Math.max(need, cap * 2, 64);
    const f = old => { const a = new Float64Array(next); if (old) a.set(old); return a; };
    const k = old => { const a = new Int32Array(next); if (old) a.set(old); return a; };
    ox = f(ox); oy = f(oy); oz = f(oz); cs = f(cs); cnt = f(cnt); mx = f(mx); my = f(my); mz = f(mz); rs = f(rs);
    kid = k(kid); leaf = k(leaf);
    cap = next;
  };
  grow(8 * n + 8);
  const cell = (x, y, z, size) => {
    if (used >= cap) grow(used + 1);
    const c = used++;
    ox[c] = x; oy[c] = y; oz[c] = z; cs[c] = size;
    cnt[c] = 0; mx[c] = 0; my[c] = 0; mz[c] = 0; rs[c] = 0; kid[c] = -1; leaf[c] = -1;
    return c;
  };
  cell(loX, loY, loZ, Math.max(hiX - loX, hiY - loY, hiZ - loZ, 1) * 1.0001);
  const childFor = (c, i) => {
    const h = cs[c] / 2;
    return kid[c] + (xs[i] >= ox[c] + h ? 1 : 0) + (ys[i] >= oy[c] + h ? 2 : 0) + (zs[i] >= oz[c] + h ? 4 : 0);
  };
  const split = c => {
    const h = cs[c] / 2;
    const x = ox[c]; const y = oy[c]; const z = oz[c];
    kid[c] = used;
    for (let q = 0; q < 8; q++) cell(x + (q & 1) * h, y + ((q >> 1) & 1) * h, z + (q >> 2) * h, h);
  };
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let depth = 0; ; depth++) {
      const k = cnt[c];
      mx[c] = (mx[c] * k + xs[i]) / (k + 1);
      my[c] = (my[c] * k + ys[i]) / (k + 1);
      mz[c] = (mz[c] * k + zs[i]) / (k + 1);
      rs[c] += rad[i];
      cnt[c] = k + 1;
      if (k + 1 === 1) { leaf[c] = i; break; }
      if (depth > 40) break; // coincident points stay lumped in one leaf
      if (kid[c] < 0) {
        split(c);
        const old = leaf[c];
        if (old >= 0) {
          leaf[c] = -1;
          const K = childFor(c, old);
          mx[K] = xs[old]; my[K] = ys[old]; mz[K] = zs[old]; rs[K] = rad[old]; cnt[K] = 1; leaf[K] = old;
        }
      }
      c = childFor(c, i);
    }
  }
  const theta2 = BH_THETA * BH_THETA;
  let stack = new Int32Array(64);
  for (let i = 0; i < n; i++) {
    let fx = 0; let fy = 0; let fz = 0;
    let top = 0;
    stack[top++] = 0;
    while (top) {
      const c = stack[--top];
      if (cnt[c] === 0 || (cnt[c] === 1 && leaf[c] === i)) continue;
      let dx = xs[i] - mx[c]; let dy = ys[i] - my[c]; let dz = zs[i] - mz[c];
      let distSq = dx * dx + dy * dy + dz * dz;
      if (kid[c] >= 0 && cs[c] * cs[c] > theta2 * distSq) {
        if (top + 8 > stack.length) { const next = new Int32Array(stack.length * 2); next.set(stack); stack = next; }
        for (let q = 0; q < 8; q++) stack[top++] = kid[c] + q;
        continue;
      }
      if (distSq < 0.01) { dx = random() - 0.5; dy = random() - 0.5; dz = random() - 0.5; distSq = 0.01; }
      const dist = Math.sqrt(distSq);
      const kk = rad[i] + rs[c] / cnt[c] + gap;
      const force = ((kk * kk) / dist) * cnt[c];
      fx += (dx / dist) * force; fy += (dy / dist) * force; fz += (dz / dist) * force;
    }
    const d = disp[ids[i]];
    d.x += fx; d.y += fy; d.z += fz;
  }
}

function forceComponent3D(nodes, ids, edges, opts) {
  const n = ids.length;
  const random = opts.random || Math.random;
  const fixed = new Set(opts.fixed || []);
  const iterations = n > LARGE_COMPONENT ? Math.min(opts.iterations || 300, LARGE_ITERATIONS) : opts.iterations || 300;
  if (n === 1) {
    const only = nodes[ids[0]];
    const placed = Number.isFinite(only.x) && Number.isFinite(only.y);
    if (!fixed.has(ids[0]) && (!opts.adaptive || !placed)) { only.x = 0; only.y = 0; only.z = 0; }
    else if (!Number.isFinite(only.z)) only.z = 0;
    return;
  }

  const tight = Math.min(10, Math.max(0, opts.tightness ?? 5));
  const gap = DEFAULT_NODE_RADIUS * (1 + (10 - tight) * 0.4);
  const k = DEFAULT_NODE_RADIUS * 2 + gap;
  const r = id => radiusOf(nodes[id]);

  // Start unplaced nodes on a jittered cube grid. Placed 2D nodes get a small
  // random z so the run can lift them out of the plane.
  const cols = Math.max(1, Math.ceil(Math.cbrt(n)));
  const span = cols * k;
  ids.forEach((id, i) => {
    const node = node3(nodes[id]);
    const unplaced = !Number.isFinite(node.x) || !Number.isFinite(node.y) || (node.x === 0 && node.y === 0 && node.z === 0);
    if (unplaced && (!opts.adaptive || !fixed.has(id))) {
      node.x = (i % cols) * k - span / 2 + (random() - 0.5) * k * 0.5;
      node.y = (Math.floor(i / cols) % cols) * k - span / 2 + (random() - 0.5) * k * 0.5;
      node.z = Math.floor(i / (cols * cols)) * k - span / 2 + (random() - 0.5) * k * 0.5;
    } else if (node.flat && !fixed.has(id)) node.z = (random() - 0.5) * k;
    delete node.flat;
  });

  const gravity = 0.0075;
  let temperature = span * (opts.adaptive ? 0.02 : 0.1);
  const minTemp = k * 0.01;
  const cooling = (temperature - minTemp) / (iterations + 1);
  let gx = 0; let gy = 0; let gz = 0;
  if (opts.adaptive) { ids.forEach(id => { gx += nodes[id].x; gy += nodes[id].y; gz += nodes[id].z; }); gx /= n; gy /= n; gz /= n; }

  const useTree = n > BH_THRESHOLD;
  const viaWasm = forceStepsWasm({ dims: 3, nodes, ids, edges, radius: r, fixed, iterations, gap, k, gravity, temperature, minTemp, cooling, gx, gy, gz, useTree, random });
  if (!viaWasm) for (let step = 0; step < iterations; step++) {
    const disp = {};
    ids.forEach(id => { disp[id] = { x: 0, y: 0, z: 0 }; });
    if (useTree) barnesHut3D(nodes, ids, r, gap, disp, random);
    else for (let a = 0; a < n; a++) {
      const va = nodes[ids[a]];
      for (let b = a + 1; b < n; b++) {
        const vb = nodes[ids[b]];
        let dx = va.x - vb.x; let dy = va.y - vb.y; let dz = va.z - vb.z;
        let distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < 0.01) { dx = random() - 0.5; dy = random() - 0.5; dz = random() - 0.5; distSq = 0.01; }
        const dist = Math.sqrt(distSq);
        const kk = r(ids[a]) + r(ids[b]) + gap;
        const f = (kk * kk) / dist / dist;
        const da = disp[ids[a]]; const db = disp[ids[b]];
        da.x += dx * f; da.y += dy * f; da.z += dz * f;
        db.x -= dx * f; db.y -= dy * f; db.z -= dz * f;
      }
    }
    edges.forEach(([id1, id2]) => {
      const v1 = nodes[id1]; const v2 = nodes[id2];
      const dx = v1.x - v2.x; const dy = v1.y - v2.y; const dz = v1.z - v2.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      const f = dist / (r(id1) + r(id2) + gap); // (dist^2 / k) / dist
      const d1 = disp[id1]; const d2 = disp[id2];
      d1.x -= dx * f; d1.y -= dy * f; d1.z -= dz * f;
      d2.x += dx * f; d2.y += dy * f; d2.z += dz * f;
    });
    ids.forEach(id => {
      if (fixed.has(id)) return;
      const node = nodes[id];
      const d = disp[id];
      d.x -= (node.x - gx) * gravity * k;
      d.y -= (node.y - gy) * gravity * k;
      d.z -= (node.z - gz) * gravity * k;
      const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z) || 0.01;
      const move = Math.min(len, temperature) / len;
      node.x += d.x * move; node.y += d.y * move; node.z += d.z * move;
    });
    temperature = Math.max(temperature - cooling, minTemp);
  }

  // Push overlapping spheres apart; large components only compare nodes in neighbouring grid cells.
  const maxR = Math.max(...ids.map(r));
  for (let pass = 0; pass < 20; pass++) {
    let moved = false;
    const near = useTree ? gridNeighbours3D(nodes, ids, maxR * 2 + DEFAULT_NODE_RADIUS * 0.4) : null;
    for (let a = 0; a < n; a++) {
      const va = nodes[ids[a]];
      const others = near ? near(a) : null;
      for (let bi = others ? 0 : a + 1, end = others ? others.length : n; bi < end; bi++) {
        const b = others ? others[bi] : bi;
        if (b <= a) continue;
        const vb = nodes[ids[b]];
        const min = r(ids[a]) + r(ids[b]) + DEFAULT_NODE_RADIUS * 0.4;
        const dx = vb.x - va.x; const dy = vb.y - va.y; const dz = vb.z - va.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq >= min * min) continue;
        const dist = Math.sqrt(distSq) || 0.01;
        const push = (min - dist) / 2 / dist;
        if (!fixed.has(ids[a])) { va.x -= dx * push; va.y -= dy * push; va.z -= dz * push; }
        if (!fixed.has(ids[b])) { vb.x += dx * push; vb.y += dy * push; vb.z += dz * push; }
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (!opts.adaptive && fixed.size === 0) {
    recentre(nodes, ids);
    let cz = 0;
    ids.forEach(id => { cz += nodes[id].z; });
    cz /= n;
    ids.forEach(id => { nodes[id].z -= cz; });
  }
}

/** 3D spatial hash: returns i -> indices of nodes in the same or adjacent cells. */
function gridNeighbours3D(nodes, ids, cell) {
  const grid = new Map();
  // Keys are `${gx},${gy},${gz}` cell coordinates (the same strings [gx, gy, gz].join() gives).
  ids.forEach((id, i) => {
    const v = nodes[id];
    const k = `${Math.floor(v.x / cell)},${Math.floor(v.y / cell)},${Math.floor(v.z / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  return i => {
    const v = nodes[ids[i]];
    const gx = Math.floor(v.x / cell); const gy = Math.floor(v.y / cell); const gz = Math.floor(v.z / cell);
    const out = [];
    for (let x = gx - 1; x <= gx + 1; x++) for (let y = gy - 1; y <= gy + 1; y++) for (let z = gz - 1; z <= gz + 1; z++) {
      const list = grid.get(`${x},${y},${z}`);
      if (list) out.push(...list);
    }
    return out;
  };
}

/**
 * 3D packing: the largest component centred on `centre` (z 0), every other one on a
 * sphere shell around it, spread by a Fibonacci spiral, so small components surround
 * the main ball in depth instead of forming a flat ring beside it.
 */
function packSphere(nodes, comps, centre) {
  if (!comps.length) return;
  const ball = ids => {
    let cx = 0; let cy = 0; let cz = 0;
    ids.forEach(id => { cx += nodes[id].x; cy += nodes[id].y; cz += nodes[id].z || 0; });
    cx /= ids.length; cy /= ids.length; cz /= ids.length;
    let r = 0;
    ids.forEach(id => { const n = nodes[id]; r = Math.max(r, Math.hypot(n.x - cx, n.y - cy, (n.z || 0) - cz) + radiusOf(n)); });
    return { cx, cy, cz, r };
  };
  const move = (ids, b, x, y, z) => ids.forEach(id => {
    const n = nodes[id];
    n.x += x - b.cx; n.y += y - b.cy; n.z = (n.z || 0) + z - b.cz;
  });
  const [main, ...rest] = comps;
  const core = ball(main);
  move(main, core, centre.x, centre.y, 0);
  if (!rest.length) return;
  const balls = rest.map(ball);
  const pad = DEFAULT_NODE_RADIUS * 2;
  const biggest = Math.max(...balls.map(b => b.r));
  // Far enough to clear the core, and big enough that n satellites of size `biggest` fit on the shell.
  const shell = Math.max(core.r + pad + biggest, Math.sqrt(rest.length) * (2 * biggest + pad) * 0.6);
  const golden = Math.PI * (3 - Math.sqrt(5));
  rest.forEach((comp, i) => {
    const y = 1 - (2 * (i + 0.5)) / rest.length;
    const ring = Math.sqrt(1 - y * y);
    const a = i * golden;
    move(comp, balls[i], centre.x + Math.cos(a) * ring * shell, centre.y + y * shell, Math.sin(a) * ring * shell);
  });
}

/** Gives a node a numeric z (0 when missing), flagging nodes that had none. */
function node3(node) {
  if (!Number.isFinite(node.z)) { node.z = 0; node.flat = true; }
  return node;
}

/* ---------------------------------------------------------------------------
 * Layered (hierarchy / sequential)
 * ------------------------------------------------------------------------- */

/** Undirected BFS levels from `roots`; unreached nodes start from their own root. */
function bfsLevels(comp, adj, roots) {
  const level = new Map();
  const parent = new Map();
  const queue = [];
  const seed = id => { level.set(id, 0); parent.set(id, null); queue.push(id); };
  roots.forEach(seed);
  const drain = () => {
    while (queue.length) {
      const id = queue.shift();
      adj.get(id).forEach(n => {
        if (level.has(n)) return;
        level.set(n, level.get(id) + 1);
        parent.set(n, id);
        queue.push(n);
      });
    }
  };
  drain();
  return { level, parent };
}

/** Longest-path layering over directed edges, cycles broken by DFS order. */
function directedLevels(comp, edges) {
  const set = new Set(comp);
  const out = new Map(comp.map(id => [id, []]));
  const indeg = new Map(comp.map(id => [id, 0]));
  edges.forEach(([a, b, link]) => {
    if (!set.has(a)) return;
    // a1-only links point id2 -> id1; everything else id1 -> id2.
    const [from, to] = link && link.a1 && !link.a2 ? [b, a] : [a, b];
    out.get(from).push(to);
  });
  // Drop back edges so the graph is a DAG.
  const state = new Map();
  const dag = new Map(comp.map(id => [id, []]));
  const visit = id => {
    state.set(id, 1);
    out.get(id).forEach(n => {
      if (state.get(n) === 1) return; // back edge
      dag.get(id).push(n);
      if (!state.has(n)) visit(n);
    });
    state.set(id, 2);
  };
  comp.forEach(id => { if (!state.has(id)) visit(id); });
  dag.forEach(targets => targets.forEach(t => indeg.set(t, indeg.get(t) + 1)));
  const level = new Map();
  const queue = comp.filter(id => indeg.get(id) === 0);
  queue.forEach(id => level.set(id, 0));
  while (queue.length) {
    const id = queue.shift();
    dag.get(id).forEach(n => {
      level.set(n, Math.max(level.get(n) ?? 0, level.get(id) + 1));
      indeg.set(n, indeg.get(n) - 1);
      if (indeg.get(n) === 0) queue.push(n);
    });
  }
  // Longest-path layering stacks every source on level 0, so a source that feeds a
  // deep node gets a long link. Pull each source down to just above its nearest target.
  comp.forEach(id => {
    const targets = dag.get(id);
    if (!targets.length || [...dag.values()].some(t => t.includes(id))) return;
    level.set(id, Math.min(...targets.map(t => level.get(t))) - 1);
  });
  return level;
}

function pickRoots(comp, adj, top) {
  const wanted = comp.filter(id => top.has(id));
  if (wanted.length) return wanted;
  return [comp.reduce((best, id) => (adj.get(id).size > adj.get(best).size ? id : best), comp[0])];
}

/** Barycentre ordering: two down/up sweeps over the layers. */
function orderLayers(layers, adj) {
  const pos = new Map();
  layers.forEach(layer => layer.forEach((id, i) => pos.set(id, i)));
  const sweep = (from, to, step) => {
    for (let l = from; l !== to; l += step) {
      const prev = new Set(layers[l - step] || []);
      const bary = id => {
        const ns = [...adj.get(id)].filter(n => prev.has(n));
        return ns.length ? ns.reduce((s, n) => s + pos.get(n), 0) / ns.length : pos.get(id);
      };
      layers[l].sort((p, q) => bary(p) - bary(q));
      layers[l].forEach((id, i) => pos.set(id, i));
    }
  };
  for (let i = 0; i < 2; i++) {
    sweep(1, layers.length, 1);
    sweep(layers.length - 2, -1, -1);
  }
}

/**
 * Places slots in each layer at `c` (centre) keeping their order and a minimum gap:
 * every slot asks for `want`; a left-to-right pass and a right-to-left pass each
 * enforce the gaps, and the two results are averaged.
 */
function settleLayer(slots, want) {
  if (!slots.length) return;
  const left = [];
  slots.forEach((slot, i) => {
    const min = i ? left[i - 1] + slots[i - 1].w / 2 + slot.w / 2 : -Infinity;
    left.push(Math.max(want[i], min));
  });
  const right = [];
  for (let i = slots.length - 1; i >= 0; i--) {
    const max = i < slots.length - 1 ? right[i + 1] - slots[i + 1].w / 2 - slots[i].w / 2 : Infinity;
    right[i] = Math.min(want[i], max);
  }
  // Average, then one more left-to-right pass so the gaps hold exactly.
  slots.forEach((slot, i) => { slot.c = (left[i] + right[i]) / 2; });
  for (let i = 1; i < slots.length; i++) {
    const min = slots[i - 1].c + slots[i - 1].w / 2 + slots[i].w / 2;
    if (slots[i].c < min) slots[i].c = min;
  }
}

/** Sequential: each slot moves toward the median of its neighbours in the layer above, then below. */
function alignMedians(slotLayers, nbrs) {
  const median = list => {
    const xs = list.map(t => t.c).sort((a, b) => a - b);
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  };
  for (let pass = 0; pass < 6; pass++) {
    const down = pass % 2 === 0;
    const order = down ? slotLayers.map((_, l) => l) : slotLayers.map((_, l) => slotLayers.length - 1 - l);
    order.forEach(l => {
      const slots = slotLayers[l];
      const side = l + (down ? -1 : 1);
      const want = slots.map(slot => {
        const near = nbrs(slot).filter(t => t.l === side);
        return near.length ? median(near) : slot.c;
      });
      settleLayer(slots, want);
    });
  }
}

/**
 * Hierarchy: a tidy tree. Each slot's parent is its first neighbour in an earlier
 * layer; leaves are laid side by side in depth-first order and every parent is
 * centred over its children, so subtrees never interleave.
 */
function tidyTree(slotLayers, nbrs) {
  const all = slotLayers.flat();
  const parent = new Map();
  const kids = new Map(all.map(slot => [slot, []]));
  all.forEach(slot => {
    const up = nbrs(slot).filter(t => t.l < slot.l).sort((a, b) => b.l - a.l || a.c - b.c)[0];
    if (up) { parent.set(slot, up); kids.get(up).push(slot); }
  });
  kids.forEach(list => list.sort((a, b) => a.c - b.c));
  // Contours: per layer, the right edge reached so far, so a subtree can sit
  // closer when its levels do not collide with the previous subtree.
  const edge = new Map();
  const place = slot => {
    const children = kids.get(slot);
    if (children.length) {
      children.forEach(place);
      slot.c = (children[0].c + children[children.length - 1].c) / 2;
      const min = (edge.get(slot.l) ?? -Infinity) + slot.w / 2;
      if (slot.c < min) shift(slot, min - slot.c);
    } else {
      slot.c = (edge.get(slot.l) ?? -Infinity) === -Infinity ? slot.w / 2 : edge.get(slot.l) + slot.w / 2;
    }
    edge.set(slot.l, Math.max(edge.get(slot.l) ?? -Infinity, slot.c + slot.w / 2));
  };
  // Shifts move right only, so each moved slot just raises its layer's contour.
  const shift = (slot, dx) => {
    slot.c += dx;
    edge.set(slot.l, Math.max(edge.get(slot.l) ?? -Infinity, slot.c + slot.w / 2));
    kids.get(slot).forEach(k => shift(k, dx));
  };
  slotLayers.flat().filter(slot => !parent.has(slot)).sort((a, b) => a.l - b.l || a.c - b.c).forEach(place);
}

/**
 * @param {object} opts  top, level, orientation, tightness, directed (sequential)
 */
/**
 * Layered layout for 'hierarchy' and 'sequential'.
 *   orderBy      string | { property, sortBy }: order within a level by d[property]
 *                (descending unless sortBy 'ascending'), after crossing reduction
 *   spacing      'auto' (sizes add up), 'equal' (one step for all), 'stretched'
 *                (every level spread to the widest level's width)
 *   stacking     { arrange: 'grid' }: 4+ same-level nodes with identical
 *                neighbours stack in a grid block
 *   stretch      multiplier for the gap between levels (default 1)
 *   stretchType  'auto' (gap grows with the larger nodes of the two levels) | 'equal'
 *   flatten      hierarchy only: levels as close as the nodes allow
 *   packing      components: 'aligned' (default, side by side), 'rectangle', 'circle', 'none'
 */
export function layeredLayout(nodes, links, opts = {}) {
  const { ids, edges, adj } = visibleGraph(nodes, links);
  if (ids.length === 0) return;
  const top = new Set([].concat(opts.top || []));
  const tight = Math.min(10, Math.max(0, opts.tightness ?? 5));
  const across = DEFAULT_NODE_RADIUS * (2.4 + (10 - tight) * 0.12);
  const baseDown = DEFAULT_NODE_RADIUS * (3 + (10 - tight) * 0.4) * (opts.stretch > 0 ? opts.stretch : 1);
  const orientation = opts.orientation || 'down';
  const order = typeof opts.orderBy === 'string' ? { property: opts.orderBy } : opts.orderBy;
  const spacing = opts.spacing || 'auto';
  const stackGrid = opts.stacking && opts.stacking.arrange === 'grid';
  const centre = boxCentre(nodes, ids);
  const comps = components(ids, adj);
  let offset = 0;

  comps.forEach(comp => {
    let level;
    if (opts.level) {
      const read = id => Number((nodes[id].d || {})[opts.level]);
      level = new Map(comp.map(id => [id, Number.isFinite(read(id)) ? read(id) : 0]));
    } else if (opts.directed) {
      level = directedLevels(comp, edges);
      // `top` nodes start the flow.
      if (top.size) {
        const min = Math.min(...comp.map(id => level.get(id)));
        comp.forEach(id => { if (top.has(id)) level.set(id, min - 1); });
      }
    } else {
      level = bfsLevels(comp, adj, pickRoots(comp, adj, top)).level;
    }
    // Compact level numbers (custom `level` values may be sparse or negative).
    const distinct = [...new Set(comp.map(id => level.get(id) ?? 0))].sort((a, b) => a - b);
    const rank = new Map(distinct.map((v, i) => [v, i]));
    const layers = distinct.map(() => []);
    comp.forEach(id => layers[rank.get(level.get(id) ?? 0)].push(id));
    // Sequential: a link that skips levels gets a chain of placeholder ("dummy")
    // nodes, one per level it crosses, so ordering and placement see it.
    let order2 = adj;
    const dummy = new Set();
    if (opts.directed) {
      order2 = new Map([...adj].map(([k, v]) => [k, new Set(v)]));
      const compSet = new Set(comp);
      const seenPair = new Set();
      edges.forEach(([a0, b0]) => {
        if (!compSet.has(a0) || !compSet.has(b0)) return;
        let ra = rank.get(level.get(a0) ?? 0);
        let rb = rank.get(level.get(b0) ?? 0);
        let [u, v] = [a0, b0];
        if (ra > rb) { [u, v] = [b0, a0]; [ra, rb] = [rb, ra]; }
        const key = `${u}\u0000${v}`;
        if (rb - ra < 2 || seenPair.has(key)) return;
        seenPair.add(key);
        order2.get(u).delete(v); order2.get(v).delete(u);
        let prev = u;
        for (let r = ra + 1; r < rb; r++) {
          const d = `\u0000d${dummy.size}`;
          dummy.add(d);
          order2.set(d, new Set([prev]));
          order2.get(prev).add(d);
          layers[r].push(d);
          prev = d;
        }
        order2.get(prev).add(v); order2.get(v).add(prev);
      });
    }
    orderLayers(layers, order2);
    if (order && order.property) {
      const dir = order.sortBy === 'ascending' ? 1 : -1;
      const key = id => (nodes[id].d || {})[order.property];
      layers.forEach(layer => layer.sort((p, q) => {
        const a = key(p); const b = key(q);
        if (a === b) return 0;
        if (a === undefined) return 1;
        if (b === undefined) return -1;
        return (a < b ? -1 : 1) * dir;
      }));
    }

    // Slots: single nodes, or grid blocks of stacked siblings.
    const slotsOf = layer => {
      if (!stackGrid) return layer.map(id => ({ ids: [id], dummy: dummy.has(id) }));
      const groups = new Map();
      layer.forEach(id => {
        if (dummy.has(id)) return;
        const key = [...adj.get(id)].sort().join('\u0000') + (order && order.property ? `|${(nodes[id].d || {})[order.property]}` : '');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(id);
      });
      const seen = new Set();
      const slots = [];
      layer.forEach(id => {
        if (seen.has(id)) return;
        if (dummy.has(id)) { seen.add(id); slots.push({ ids: [id], dummy: true }); return; }
        const key = [...groups.entries()].find(([, members]) => members.includes(id))[1];
        if (key.length >= 4) { key.forEach(m => seen.add(m)); slots.push({ ids: key }); } else { seen.add(id); slots.push({ ids: [id] }); }
      });
      return slots;
    };
    const maxSize = Math.max(...comp.map(id => radiusOf(nodes[id]) * 2));
    const nodeStep = id => (dummy.has(id) ? across * 0.5
      : (spacing === 'equal' ? maxSize : radiusOf(nodes[id]) * 2) + across - DEFAULT_NODE_RADIUS * 2);
    const sizeOf = id => (dummy.has(id) ? 0 : radiusOf(nodes[id]) * 2);
    const slotLayers = layers.map(slotsOf);
    slotLayers.forEach(slots => slots.forEach(slot => {
      const cols = Math.ceil(Math.sqrt(slot.ids.length));
      slot.cols = cols;
      slot.rows = Math.ceil(slot.ids.length / cols);
      const cell = Math.max(...slot.ids.map(nodeStep));
      slot.cell = cell;
      slot.w = cols * cell;
      slot.depth = slot.rows * cell;
    }));
    const layerWidth = slots => slots.reduce((sum, slot) => sum + slot.w, 0);
    const width = Math.max(...slotLayers.map(layerWidth));
    // Level positions along the depth axis.
    const depthOf = slots => Math.max(...slots.map(slot => (slot.rows - 1) * slot.cell + Math.max(...slot.ids.map(sizeOf))));
    const levelPos = [];
    let pos = 0;
    slotLayers.forEach((slots, l) => {
      if (l > 0) {
        const prev = slotLayers[l - 1];
        let gap = baseDown;
        if (opts.flatten) gap = (depthOf(prev) + depthOf(slots)) / 2 + DEFAULT_NODE_RADIUS * (0.6 + (10 - tight) * 0.08);
        else if (opts.stretchType === 'auto') gap = Math.max(baseDown, (depthOf(prev) + depthOf(slots)) / 2 + DEFAULT_NODE_RADIUS);
        pos += gap;
      }
      levelPos.push(pos);
      pos += depthOf(slots) - Math.max(...slots.map(slot => Math.max(...slot.ids.map(sizeOf))));
    });

    // Across-axis centre of every slot. Start packed and centred (this is also the
    // 'stretched' result), then refine: hierarchy as a tidy tree, sequential by
    // pulling each slot toward its neighbours' median without breaking the order.
    slotLayers.forEach(slots => {
      const w = layerWidth(slots);
      const stretchGap = spacing === 'stretched' && slots.length > 1 ? (width - w) / (slots.length - 1) : 0;
      let cursor = spacing === 'stretched' && slots.length > 1 ? 0 : (width - w) / 2;
      slots.forEach(slot => { slot.c = cursor + slot.w / 2; cursor += slot.w + stretchGap; });
    });
    if (spacing !== 'stretched') {
      const slotOf = new Map();
      slotLayers.forEach((slots, l) => slots.forEach(slot => { slot.l = l; slot.ids.forEach(id => slotOf.set(id, slot)); }));
      const nbrs = slot => {
        const out = new Set();
        slot.ids.forEach(id => order2.get(id).forEach(n => { const t = slotOf.get(n); if (t && t !== slot) out.add(t); }));
        return [...out];
      };
      if (opts.directed) alignMedians(slotLayers, nbrs);
      else tidyTree(slotLayers, nbrs);
    }
    const minC = Math.min(...slotLayers.flat().map(slot => slot.c - slot.w / 2));
    const usedW = Math.max(...slotLayers.flat().map(slot => slot.c + slot.w / 2)) - minC;

    slotLayers.forEach((slots, l) => {
      slots.forEach(slot => {
        if (slot.dummy) return;
        const cursor = offset + slot.c - slot.w / 2 - minC;
        slot.ids.forEach((id, i) => {
          const a = cursor + ((i % slot.cols) + 0.5) * slot.cell;
          const b = levelPos[l] + Math.floor(i / slot.cols) * slot.cell;
          const node = nodes[id];
          if (orientation === 'down') { node.x = a; node.y = b; }
          else if (orientation === 'up') { node.x = a; node.y = -b; }
          else if (orientation === 'right') { node.x = b; node.y = a; }
          else { node.x = -b; node.y = a; }
        });
      });
    });
    offset += usedW + across;
  });
  if (opts.packing && opts.packing !== 'aligned') {
    comps.forEach(comp => recentre(nodes, comp));
    packComponents(nodes, comps, centre, opts.packing);
  }
}

/* ---------------------------------------------------------------------------
 * Radial and lens
 * ------------------------------------------------------------------------- */

/** Angle a node of footprint radius `r` needs on a ring of `radius`, gap included (chord, not arc). */
const ringAngle = (r, gap, radius) => 2 * Math.asin(Math.min(1, (r + gap / 2) / radius));

/** Smallest radius at least `from` on which nodes of footprints `rs` fit around the full circle. */
function ringRadiusFor(rs, gap, from) {
  let radius = Math.max(from, 1);
  const need = rad => rs.reduce((sum, r) => sum + ringAngle(r, gap, rad), 0);
  while (rs.length > 1 && need(radius) > Math.PI * 2) radius *= 1.04;
  return radius;
}

/**
 * BFS tree on concentric rings. Each ring is far enough from the previous one and
 * long enough for all its nodes (node plus outside label, see footprintOf); nodes
 * start at their subtree's angle and are then spread along the ring so neighbours
 * keep at least `gap` between them.
 */
export function radialLayout(nodes, links, opts = {}) {
  const { ids, adj } = visibleGraph(nodes, links);
  if (ids.length === 0) return;
  const top = new Set([].concat(opts.top || []));
  const tight = Math.min(10, Math.max(0, opts.tightness ?? 5));
  const gap = DEFAULT_NODE_RADIUS * (0.8 + (10 - tight) * 0.12);
  const comps = components(ids, adj);

  comps.forEach(comp => {
    const roots = pickRoots(comp, adj, top).slice(0, 1);
    const { level, parent } = bfsLevels(comp, adj, roots);
    const children = new Map(comp.map(id => [id, []]));
    comp.forEach(id => { const p = parent.get(id); if (p != null) children.get(p).push(id); });
    const leaves = new Map();
    const count = id => {
      if (leaves.has(id)) return leaves.get(id);
      const c = children.get(id);
      const v = c.length ? c.reduce((s, k) => s + count(k), 0) : 1;
      leaves.set(id, v);
      return v;
    };
    // Tree angles: each subtree gets an arc sized by its leaf count.
    const angle = new Map();
    const spread = (id, a0, a1) => {
      angle.set(id, (a0 + a1) / 2);
      let a = a0;
      children.get(id).forEach(c => {
        const span = ((a1 - a0) * count(c)) / count(id);
        spread(c, a, a + span);
        a += span;
      });
    };
    spread(roots[0], 0, Math.PI * 2);

    const byLevel = [];
    comp.forEach(id => { const l = level.get(id); (byLevel[l] = byLevel[l] || []).push(id); });
    nodes[roots[0]].x = 0;
    nodes[roots[0]].y = 0;
    let outer = footprintOf(nodes[roots[0]]);
    for (let l = 1; l < byLevel.length; l++) {
      const ring = (byLevel[l] || []).slice().sort((a, b) => angle.get(a) - angle.get(b));
      if (!ring.length) continue;
      const rs = ring.map(id => footprintOf(nodes[id]));
      const radius = ringRadiusFor(rs, gap, outer + gap + Math.max(...rs));
      // Spread along the ring: forward pass enforces the minimum angle to the
      // previous node, then the whole ring turns back by the average drift.
      const want = ring.map(id => angle.get(id));
      const got = want.slice();
      for (let k = 1; k < ring.length; k++) {
        const min = got[k - 1] + (ringAngle(rs[k - 1], gap, radius) + ringAngle(rs[k], gap, radius)) / 2;
        if (got[k] < min) got[k] = min;
      }
      // If the pushed ring wraps into its own start, fall back to even spacing in
      // tree order (the radius guarantees the minimum angles fit in a full turn).
      const n = ring.length;
      const half = k => ringAngle(rs[k], gap, radius) / 2;
      if (n > 1 && got[n - 1] - got[0] + half(n - 1) + half(0) > Math.PI * 2) {
        const total = rs.reduce((sum, r) => sum + ringAngle(r, gap, radius), 0);
        const spare = (Math.PI * 2 - total) / n;
        let a = want[0] - half(0);
        for (let k = 0; k < n; k++) { a += half(k); got[k] = a; a += half(k) + spare; }
      }
      const drift = got.reduce((sum, a, k) => sum + (a - want[k]), 0) / ring.length;
      ring.forEach((id, k) => {
        const a = got[k] - drift;
        nodes[id].x = Math.cos(a) * radius;
        nodes[id].y = Math.sin(a) * radius;
      });
      outer = radius + Math.max(...rs);
    }
  });
  packOnArc(nodes, comps);
}

/**
 * Concentric rings by degree: best-connected in the middle, ring size grows outward.
 * Rings are spaced and filled by each node's footprint (node plus outside label),
 * measured as chords, so neighbours never overlap.
 */
export function lensLayout(nodes, links, opts = {}) {
  const { ids, adj } = visibleGraph(nodes, links);
  if (ids.length === 0) return;
  const tight = Math.min(10, Math.max(0, opts.tightness ?? 5));
  const gap = DEFAULT_NODE_RADIUS * (0.6 + (10 - tight) * 0.1);
  const comps = components(ids, adj);
  comps.forEach(comp => {
    const sorted = comp.slice().sort((p, q) => adj.get(q).size - adj.get(p).size);
    const first = sorted[0];
    nodes[first].x = 0;
    nodes[first].y = 0;
    let outer = footprintOf(nodes[first]);
    let i = 1;
    let ring = 1;
    while (i < sorted.length) {
      // Fill the ring at the radius that clears the previous one.
      const start = outer + gap + footprintOf(nodes[sorted[i]]);
      const members = [];
      let used = 0;
      while (i < sorted.length) {
        const a = ringAngle(footprintOf(nodes[sorted[i]]), gap, start);
        if (members.length && used + a > Math.PI * 2) break;
        members.push(sorted[i++]);
        used += a;
      }
      const rs = members.map(id => footprintOf(nodes[id]));
      const radius = ringRadiusFor(rs, gap, start);
      // Spread the ring's spare angle evenly between neighbours.
      const angles = rs.map(r => ringAngle(r, gap, radius));
      const spare = (Math.PI * 2 - angles.reduce((a, b) => a + b, 0)) / members.length;
      let a = ring * 0.5;
      members.forEach((id, k) => {
        a += angles[k] / 2;
        nodes[id].x = Math.cos(a) * radius;
        nodes[id].y = Math.sin(a) * radius;
        a += angles[k] / 2 + spare;
      });
      outer = radius + Math.max(...rs);
      ring++;
    }
  });
  packOnArc(nodes, comps);
}

/* ---------------------------------------------------------------------------
 * Structural: nodes with identical neighbour sets are grouped together
 * ------------------------------------------------------------------------- */

export function structuralLayout(nodes, links, opts = {}) {
  const { ids, adj } = visibleGraph(nodes, links);
  if (ids.length === 0) return;
  const groups = new Map();
  ids.forEach(id => {
    const key = [...adj.get(id)].sort().join('\u0000');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  });
  const groupOf = new Map();
  const supers = {};
  [...groups.values()].forEach((members, g) => {
    members.forEach(id => groupOf.set(id, `g${g}`));
    supers[`g${g}`] = { id: `g${g}`, e: Math.sqrt(members.length) * 1.2, members };
  });
  const superLinks = {};
  ids.forEach(id => adj.get(id).forEach(n => {
    const a = groupOf.get(id);
    const b = groupOf.get(n);
    if (a !== b) superLinks[a < b ? `${a}|${b}` : `${b}|${a}`] = { id1: a, id2: b };
  }));
  forceLayout(supers, superLinks, opts);
  const step = DEFAULT_NODE_RADIUS * 2.4;
  Object.values(supers).forEach(s => {
    const cols = Math.ceil(Math.sqrt(s.members.length));
    s.members.forEach((id, i) => {
      nodes[id].x = s.x + ((i % cols) - (cols - 1) / 2) * step;
      nodes[id].y = s.y + (Math.floor(i / cols) - (Math.ceil(s.members.length / cols) - 1) / 2) * step;
      if (opts.dimensions === 3) nodes[id].z = s.z || 0;
    });
  });
}

/* ---------------------------------------------------------------------------
 * 3D versions of the flat layouts (used when view3d is on)
 * ------------------------------------------------------------------------- */

/** Points spread evenly over a unit sphere (Fibonacci spiral). */
function spherePoints(n) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    pts.push({ x: Math.cos(golden * i) * r, y, z: Math.sin(golden * i) * r });
  }
  return pts;
}

/**
 * Radial / lens in 3D: every ring becomes a sphere of the same radius around the
 * component's centre. Nodes keep their ring and their order by angle, so the shells
 * read like the 2D rings; a sphere has more room than its ring, so nothing overlaps.
 */
function liftRings(nodes, links) {
  const { ids, adj } = visibleGraph(nodes, links);
  components(ids, adj).forEach(comp => {
    // The rings share a centre: the root / best-connected node, nearest the box centre.
    const xs = comp.map(id => nodes[id].x);
    const ys = comp.map(id => nodes[id].y);
    const bx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const by = (Math.min(...ys) + Math.max(...ys)) / 2;
    const root = comp.reduce((best, id) => (Math.hypot(nodes[id].x - bx, nodes[id].y - by) < Math.hypot(nodes[best].x - bx, nodes[best].y - by) ? id : best), comp[0]);
    const cx = nodes[root].x;
    const cy = nodes[root].y;
    const shells = new Map();
    comp.forEach(id => {
      const n = nodes[id];
      const key = Math.round(Math.hypot(n.x - cx, n.y - cy) / 4) * 4;
      if (!shells.has(key)) shells.set(key, []);
      shells.get(key).push(id);
    });
    shells.forEach((members, radius) => {
      if (radius === 0) { members.forEach(id => { nodes[id].x = cx; nodes[id].y = cy; nodes[id].z = 0; }); return; }
      const byAngle = members.slice().sort((a, b) => Math.atan2(nodes[a].y - cy, nodes[a].x - cx) - Math.atan2(nodes[b].y - cy, nodes[b].x - cx));
      const pts = spherePoints(byAngle.length).sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
      byAngle.forEach((id, i) => {
        nodes[id].x = cx + pts[i].x * radius;
        nodes[id].y = cy + pts[i].y * radius;
        nodes[id].z = pts[i].z * radius;
      });
    });
  });
}

/**
 * Hierarchy / sequential in 3D (a cone tree): levels stay on their axis and each
 * level's row is wrapped into a ring around that axis, keeping the row's order and
 * spacing (ring circumference = row width).
 */
function liftLayers(nodes, links, orientation = 'down') {
  const { ids, adj } = visibleGraph(nodes, links);
  const vertical = orientation === 'down' || orientation === 'up';
  const lev = id => (vertical ? nodes[id].y : nodes[id].x);
  const across = (id, v) => { if (v === undefined) return vertical ? nodes[id].x : nodes[id].y; if (vertical) nodes[id].x = v; else nodes[id].y = v; };
  components(ids, adj).forEach(comp => {
    const values = comp.map(id => across(id));
    const axis = (Math.min(...values) + Math.max(...values)) / 2;
    const rows = new Map();
    comp.forEach(id => {
      const key = Math.round(lev(id));
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(id);
    });
    rows.forEach(row => {
      if (row.length === 1) { across(row[0], axis); nodes[row[0]].z = 0; return; }
      row.sort((a, b) => across(a) - across(b));
      const steps = row.slice(1).map((id, i) => across(id) - across(row[i]));
      const step = Math.max(...steps, DEFAULT_NODE_RADIUS * 2);
      const width = across(row[row.length - 1]) - across(row[0]) + step;
      const radius = width / (2 * Math.PI);
      const first = across(row[0]);
      row.forEach(id => {
        const a = (2 * Math.PI * (across(id) - first + step / 2)) / width;
        across(id, axis + Math.cos(a) * radius);
        nodes[id].z = Math.sin(a) * radius;
      });
    });
  });
}

/* ---------------------------------------------------------------------------
 * Dispatcher
 * ------------------------------------------------------------------------- */

export const LAYOUT_NAMES = ['organic', 'hierarchy', 'sequential', 'lens', 'radial', 'structural', 'tweak'];

/** Runs layout `name` over `nodes` in place. Throws on an unknown name. */
export function runLayout(name = 'organic', nodes, links, opts = {}) {
  const random = opts.consistent ? seededRandom(1) : Math.random;
  const common = { tightness: opts.tightness, random, fixed: opts.fixed, top: opts.top, packing: opts.packing };
  // dimensions: 3 (view3d) gives every layout depth: the force layouts (and the groups in
  // structural) place nodes in z directly; the ring and layered layouts run flat and are
  // then lifted into 3D (spheres, cone trees). Any 2D run is flat (z = 0).
  const d3 = opts.dimensions === 3;
  const force3D = d3 && ['organic', 'tweak', 'structural'].includes(name);
  if (!force3D) Object.values(nodes).forEach(n => { if (!n.hi && n.z) n.z = 0; });
  if (force3D) common.dimensions = 3;
  const result = runFlat(name, nodes, links, opts, common);
  if (d3 && (name === 'radial' || name === 'lens')) liftRings(nodes, links);
  if (d3 && (name === 'hierarchy' || name === 'sequential') && opts.mode !== 'adaptive') liftLayers(nodes, links, opts.orientation);
  return result;
}

function runFlat(name, nodes, links, opts, common) {
  // Options that only the layered layouts read.
  const layered = {
    level: opts.level, orientation: opts.orientation, orderBy: opts.orderBy, spacing: opts.spacing,
    stacking: opts.stacking, stretch: opts.stretch, stretchType: opts.stretchType,
  };
  switch (name) {
    case 'organic': {
      // 'adaptive' keeps the current arrangement; so does packing 'adaptive' / 'none'.
      const adaptive = opts.mode === 'adaptive' || opts.packing === 'adaptive' || opts.packing === 'none';
      return forceLayout(nodes, links, { ...common, packing: opts.packing === 'adaptive' ? undefined : opts.packing, adaptive, iterations: adaptive ? 120 : 300 });
    }
    case 'tweak':
      return forceLayout(nodes, links, { ...common, adaptive: true, iterations: 60 });
    case 'hierarchy':
      return layeredLayout(nodes, links, { ...common, ...layered, flatten: opts.flatten });
    case 'sequential':
      // Sequential adaptive mode: a short force pass that keeps the current arrangement.
      if (opts.mode === 'adaptive') return forceLayout(nodes, links, { ...common, adaptive: true, iterations: 60 });
      // Sequential follows link direction; a `level` property overrides it.
      return layeredLayout(nodes, links, { ...common, ...layered, directed: !opts.level });
    case 'radial':
      return radialLayout(nodes, links, common);
    case 'lens':
      return lensLayout(nodes, links, common);
    case 'structural':
      return structuralLayout(nodes, links, common);
    default:
      throw new Error(`Unknown layout name: ${name}`);
  }
}

/**
 * chart.arrange(name, ids, opts): place a subset as a grid, circle or radial
 * tree. `position` is 'average' (default: centre on the subset's current
 * centroid), 'absolute' (centre on opts.x/opts.y) or 'tidy' (same as average).
 */
export function arrangeNodes(name, nodes, links, ids, opts = {}) {
  const list = ids.filter(id => nodes[id] && !nodes[id].hi);
  if (list.length === 0) return;
  let cx = 0; let cy = 0;
  if (opts.position === 'absolute') { cx = opts.x || 0; cy = opts.y || 0; }
  else { list.forEach(id => { cx += nodes[id].x || 0; cy += nodes[id].y || 0; }); cx /= list.length; cy /= list.length; }
  const tight = Math.min(10, Math.max(0, opts.tightness ?? 5));
  const step = DEFAULT_NODE_RADIUS * (2.2 + (10 - tight) * 0.15) * Math.max(...list.map(id => nodes[id].e || 1));

  // Runs a whole-graph layout on just these nodes, then centres the result on (cx, cy).
  const viaLayout = fn => {
    const subset = {};
    list.forEach(id => { subset[id] = { ...nodes[id] }; });
    fn(subset);
    let sx = 0; let sy = 0;
    list.forEach(id => { sx += subset[id].x; sy += subset[id].y; });
    sx /= list.length; sy /= list.length;
    list.forEach(id => { nodes[id].x = cx + subset[id].x - sx; nodes[id].y = cy + subset[id].y - sy; });
  };

  if (name === 'grid') {
    // gridShape: 'auto' (square-ish), { rows } or { columns }.
    const shape = opts.gridShape;
    let cols = Math.ceil(Math.sqrt(list.length));
    if (shape && shape.columns) cols = Math.max(1, Math.min(list.length, shape.columns));
    else if (shape && shape.rows) cols = Math.max(1, Math.ceil(list.length / shape.rows));
    const rows = Math.ceil(list.length / cols);
    list.forEach((id, i) => {
      nodes[id].x = cx + ((i % cols) - (cols - 1) / 2) * step;
      nodes[id].y = cy + (Math.floor(i / cols) - (rows - 1) / 2) * step;
    });
  } else if (name === 'circle') {
    const radius = list.length === 1 ? 0 : (step * list.length) / (2 * Math.PI);
    list.forEach((id, i) => {
      const a = (i / list.length) * Math.PI * 2;
      nodes[id].x = cx + Math.cos(a) * radius;
      nodes[id].y = cy + Math.sin(a) * radius;
    });
  } else if (name === 'concentric') {
    // Larger items in the middle, rings filling outward.
    const sorted = list.slice().sort((p, q) => (nodes[q].e || 1) - (nodes[p].e || 1));
    let i = 0;
    let ring = 0;
    while (i < sorted.length) {
      const radius = ring * step;
      const capacity = ring === 0 ? 1 : Math.max(1, Math.floor((2 * Math.PI * radius) / step));
      const members = sorted.slice(i, i + capacity);
      members.forEach((id, j) => {
        const a = (j / members.length) * Math.PI * 2;
        nodes[id].x = cx + Math.cos(a) * radius;
        nodes[id].y = cy + Math.sin(a) * radius;
      });
      i += capacity;
      ring++;
    }
  } else if (name === 'lens') {
    viaLayout(subset => lensLayout(subset, links, opts));
  } else if (name === 'sequential') {
    viaLayout(subset => layeredLayout(subset, links, { ...opts, directed: !opts.top && !opts.level }));
  } else if (name === 'radial') {
    viaLayout(subset => radialLayout(subset, links, opts));
  } else {
    throw new Error(`Unknown arrangement: ${name}`);
  }
}
