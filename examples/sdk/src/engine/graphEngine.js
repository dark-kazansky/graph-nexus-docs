/**
 * Graph Nexus graph-analysis engine. Original code, written from the standard
 * published algorithms; the method names and options follow the public Graph
 * interface. Not derived from the vendor build in `references/` or `test.js`.
 *
 *   distances / shortestPaths  Dijkstra (binary heap)
 *   betweenness                Brandes (2001), weighted variant
 *   closeness                  summed reciprocal distances x reach, see below
 *   eigenCentrality            power iteration, each component sums to its size
 *   pageRank                   power iteration, damping 0.85, sums to 1
 *   kCores                     Batagelj–Zaversnik peeling
 *   clusters                   Louvain modularity (Blondel et al. 2008)
 *
 * Link direction comes from arrows: `a2` means id1 -> id2, `a1` means
 * id2 -> id1, both means both ways. Links without arrows count as both ways
 * for 'any' and for PageRank, and are ignored by direction 'from' / 'to'.
 * Hidden items (`hi`, or a link touching a hidden node) are skipped unless
 * `all: true`.
 */

const asList = v => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Minimal binary min-heap of [priority, value]. */
function createHeap() {
  const a = [];
  const up = i => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  };
  const down = i => {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < a.length && a[l][0] < a[m][0]) m = l;
      if (r < a.length && a[r][0] < a[m][0]) m = r;
      if (m === i) return;
      [a[m], a[i]] = [a[i], a[m]];
      i = m;
    }
  };
  return {
    get size() { return a.length; },
    push(p, v) { a.push([p, v]); up(a.length - 1); },
    pop() {
      const top = a[0];
      const last = a.pop();
      if (a.length) { a[0] = last; down(0); }
      return top;
    },
  };
}

import { closenessWasm, betweennessWasm } from './wasmCore.js';

/** Calls opts.onProgress(fraction) about 20 times over a loop of `total` steps. */
function progressReporter(opts, total) {
  const fn = opts && typeof opts.onProgress === 'function' ? opts.onProgress : null;
  if (!fn) return () => {};
  const every = Math.max(1, Math.floor(total / 20));
  let done = 0;
  return () => { done++; if (done % every === 0 || done === total) fn(done / total); };
}

/** Seeded PRNG (mulberry32). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGraphEngine(engineOptions = {}) {
  const selfLinks = !!engineOptions.selfLinks;
  let nodes = new Map(); // id -> node
  let links = new Map(); // id -> link

  /* ---- graph views ---- */

  function liveNodes(all) {
    return [...nodes.values()].filter(n => all || !n.hi).map(n => n.id);
  }

  function liveLinks(all) {
    return [...links.values()].filter(l => {
      const a = nodes.get(l.id1);
      const b = nodes.get(l.id2);
      if (!a || !b) return false;
      return all || (!l.hi && !a.hi && !b.hi);
    });
  }

  const valueOf = (link, key) => {
    if (!key) return 1;
    const v = Number(link.d && link.d[key]);
    return Number.isFinite(v) ? v : 1;
  };
  const lengthOf = (link, opts) => {
    const v = valueOf(link, opts.value);
    return opts.weights ? (v > 0 ? 1 / v : Infinity) : v;
  };

  /**
   * Adjacency list: id -> [{ to, link }] honouring `direction`.
   * 'from' follows arrows outward, 'to' follows them backwards.
   */
  function adjacency(opts = {}) {
    const direction = opts.direction || 'any';
    const adj = new Map(liveNodes(opts.all).map(id => [id, []]));
    liveLinks(opts.all).forEach(l => {
      const fwd = !!l.a2; // id1 -> id2
      const back = !!l.a1; // id2 -> id1
      const add = (from, to) => adj.get(from).push({ to, link: l });
      if (direction === 'any') {
        add(l.id1, l.id2);
        if (l.id1 !== l.id2) add(l.id2, l.id1);
      } else if (direction === 'from') {
        if (fwd) add(l.id1, l.id2);
        if (back) add(l.id2, l.id1);
      } else {
        if (fwd) add(l.id2, l.id1);
        if (back) add(l.id1, l.id2);
      }
    });
    return adj;
  }

  /**
   * Integer-indexed copy of an adjacency map for the all-sources measures:
   * one edge per (from, to) pair at its shortest finite length (parallel links
   * are one route), forward and reverse CSR arrays, and whether every length
   * is 1 (then a plain BFS gives the same distances as Dijkstra).
   */
  function indexedGraph(adj, opts) {
    const ids = [...adj.keys()];
    const idx = new Map(ids.map((id, i) => [id, i]));
    const n = ids.length;
    const best = Array.from({ length: n }, () => new Map());
    adj.forEach((list, id) => {
      const u = idx.get(id);
      list.forEach(({ to, link }) => {
        if (to === id) return;
        const len = lengthOf(link, opts);
        if (!Number.isFinite(len)) return;
        const v = idx.get(to);
        const cur = best[u].get(v);
        if (cur === undefined || len < cur) best[u].set(v, len);
      });
    });
    const build = (reverse) => {
      const count = new Int32Array(n + 1);
      best.forEach((m, u) => m.forEach((_, v) => { count[(reverse ? v : u) + 1]++; }));
      for (let i = 0; i < n; i++) count[i + 1] += count[i];
      const at = count.slice(0, n);
      const to = new Int32Array(count[n]);
      const len = new Float64Array(count[n]);
      best.forEach((m, u) => m.forEach((l, v) => {
        const a = reverse ? v : u;
        const k = at[a]++;
        to[k] = reverse ? u : v;
        len[k] = l;
      }));
      return { start: count, to, len };
    };
    const fwd = build(false);
    const rev = build(true);
    let unit = true;
    for (let k = 0; k < fwd.len.length; k++) if (fwd.len[k] !== 1) { unit = false; break; }
    return { ids, n, fwd, rev, unit };
  }

  /**
   * Single-source shortest paths over an indexedGraph, into reusable buffers:
   * dist (Infinity = unreached) and order (settle order, `count` entries).
   */
  function sssp(g, s, buf) {
    const { n, fwd, unit } = g;
    const { dist, order } = buf;
    dist.fill(Infinity);
    dist[s] = 0;
    let count = 0;
    if (unit) {
      order[count++] = s;
      for (let head = 0; head < count; head++) {
        const u = order[head];
        const du = dist[u] + 1;
        for (let k = fwd.start[u]; k < fwd.start[u + 1]; k++) {
          const v = fwd.to[k];
          if (dist[v] === Infinity) { dist[v] = du; order[count++] = v; }
        }
      }
      return count;
    }
    // Binary heap of (distance, node) with lazy deletion.
    const hd = buf.heapDist; const hn = buf.heapNode; const done = buf.done;
    done.fill(0);
    let size = 0;
    const push = (d, v) => {
      let i = size++;
      while (i > 0) { const p = (i - 1) >> 1; if (hd[p] <= d) break; hd[i] = hd[p]; hn[i] = hn[p]; i = p; }
      hd[i] = d; hn[i] = v;
    };
    const pop = () => {
      const v = hn[0]; const last = --size;
      const d = hd[last]; const x = hn[last];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= size) break;
        if (c + 1 < size && hd[c + 1] < hd[c]) c++;
        if (hd[c] >= d) break;
        hd[i] = hd[c]; hn[i] = hn[c]; i = c;
      }
      hd[i] = d; hn[i] = x;
      return v;
    };
    push(0, s);
    while (size > 0) {
      const u = pop();
      if (done[u]) continue;
      done[u] = 1;
      order[count++] = u;
      const du = dist[u];
      for (let k = fwd.start[u]; k < fwd.start[u + 1]; k++) {
        const v = fwd.to[k];
        const nd = du + fwd.len[k];
        if (nd < dist[v] - 1e-12) { dist[v] = nd; push(nd, v); }
      }
    }
    return count;
  }

  /** Brandes accumulation over every source (JavaScript path): raw scores per node index. */
  function betweennessJs(g, tick) {
    const buf = ssspBuffers(g);
    const { sigma, delta, dist, order } = buf;
    const { rev } = g;
    const raw = new Float64Array(g.n);
    // A predecessor of v is any u with an edge u -> v on a shortest path.
    const isPred = (u, v, k) => dist[u] !== Infinity && Math.abs(dist[u] + rev.len[k] - dist[v]) <= 1e-12;
    for (let s = 0; s < g.n; s++) {
      tick();
      const count = sssp(g, s, buf);
      sigma[s] = 1;
      for (let i = 1; i < count; i++) {
        const v = order[i];
        let total = 0;
        for (let k = rev.start[v]; k < rev.start[v + 1]; k++) { const u = rev.to[k]; if (isPred(u, v, k)) total += sigma[u]; }
        sigma[v] = total;
      }
      for (let i = 0; i < count; i++) delta[order[i]] = 0;
      for (let i = count - 1; i >= 1; i--) {
        const w = order[i];
        const coeff = (1 + delta[w]) / sigma[w];
        for (let k = rev.start[w]; k < rev.start[w + 1]; k++) { const u = rev.to[k]; if (isPred(u, w, k)) delta[u] += sigma[u] * coeff; }
        raw[w] += delta[w];
      }
    }
    return raw;
  }

  function ssspBuffers(g) {
    const m = g.fwd.to.length + g.n + 1;
    return {
      dist: new Float64Array(g.n), order: new Int32Array(g.n), done: new Uint8Array(g.n),
      heapDist: new Float64Array(m), heapNode: new Int32Array(m),
      sigma: new Float64Array(g.n), delta: new Float64Array(g.n),
    };
  }

  /** Dijkstra from `source`; returns { dist, preds: id -> [{ from, link }], order }. */
  function dijkstra(adj, source, opts) {
    const dist = new Map([[source, 0]]);
    const preds = new Map([[source, []]]);
    const order = [];
    const done = new Set();
    const heap = createHeap();
    heap.push(0, source);
    while (heap.size) {
      const [d, id] = heap.pop();
      if (done.has(id)) continue;
      done.add(id);
      order.push(id);
      adj.get(id).forEach(({ to, link }) => {
        if (to === id) return;
        const nd = d + lengthOf(link, opts);
        if (!Number.isFinite(nd)) return;
        const cur = dist.get(to);
        if (cur === undefined || nd < cur - 1e-12) {
          dist.set(to, nd);
          preds.set(to, [{ from: id, link }]);
          heap.push(nd, to);
        } else if (Math.abs(nd - cur) <= 1e-12 && !preds.get(to).some(p => p.from === id)) {
          // Parallel links between the same pair are one route, not several.
          preds.get(to).push({ from: id, link });
        }
      });
    }
    return { dist, preds, order };
  }

  /** Undirected connected components (node id arrays), largest first. */
  function componentsOf(all) {
    const adj = adjacency({ all });
    const seen = new Set();
    const out = [];
    adj.forEach((_, start) => {
      if (seen.has(start)) return;
      const comp = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const id = stack.pop();
        comp.push(id);
        adj.get(id).forEach(({ to }) => { if (!seen.has(to)) { seen.add(to); stack.push(to); } });
      }
      out.push(comp);
    });
    return out.sort((a, b) => b.length - a.length);
  }

  const componentSize = all => {
    const size = new Map();
    componentsOf(all).forEach(c => c.forEach(id => size.set(id, c.length)));
    return size;
  };

  /* ---- public API ---- */

  const api = {
    load(data) {
      nodes = new Map();
      links = new Map();
      asList(data && data.items).forEach(item => {
        if (!item || item.id == null) return;
        // Shallow copy, sharing `d`: callers' later edits cannot change the graph.
        if (item.type === 'link') links.set(item.id, { ...item });
        else nodes.set(item.id, { ...item });
      });
      if (!selfLinks) links.forEach((l, id) => { if (l.id1 === l.id2) links.delete(id); });
      // Combo parents with children present are containers, not graph nodes.
      const parents = new Set([...nodes.values()].map(n => n.parentId).filter(p => p != null));
      parents.forEach(p => { if (nodes.has(p) && nodes.get(p)._combo) nodes.delete(p); });
    },

    clear() {
      nodes = new Map();
      links = new Map();
    },

    degrees(opts = {}) {
      const direction = opts.direction || 'any';
      const out = Object.fromEntries(liveNodes(opts.all).map(id => [id, 0]));
      liveLinks(opts.all).forEach(l => {
        const v = valueOf(l, opts.value);
        if (direction === 'any') { out[l.id1] += v; out[l.id2] += v; return; }
        // 'from' credits the tail of each arrow, 'to' its head.
        if (l.a2) out[direction === 'from' ? l.id1 : l.id2] += v;
        if (l.a1) out[direction === 'from' ? l.id2 : l.id1] += v;
      });
      return out;
    },

    neighbours(ids, opts = {}) {
      const start = asList(ids).filter(id => nodes.has(id));
      const adj = adjacency(opts);
      const hops = opts.hops ?? 1;
      const seen = new Set(start);
      const linkSet = new Set();
      let frontier = start.filter(id => adj.has(id));
      for (let h = 0; h < hops && frontier.length; h++) {
        const next = [];
        frontier.forEach(id => adj.get(id).forEach(({ to, link }) => {
          linkSet.add(link.id);
          if (!seen.has(to)) { seen.add(to); next.push(to); }
        }));
        frontier = next;
      }
      return { nodes: [...seen].filter(id => !start.includes(id)), links: [...linkSet] };
    },

    distances(id, opts = {}) {
      const adj = adjacency(opts);
      if (!adj.has(id)) return {};
      return Object.fromEntries(dijkstra(adj, id, opts).dist);
    },

    shortestPaths(id1, id2, opts = {}) {
      const none = { onePath: [], one: [], items: [], distance: Infinity };
      const adj = adjacency(opts);
      if (!adj.has(id1) || !adj.has(id2)) return none;
      const { dist, preds } = dijkstra(adj, id1, opts);
      if (!dist.has(id2)) return none;
      // One path: follow the first predecessor back from the target.
      const onePath = [id2];
      for (let at = id2; at !== id1;) {
        const p = preds.get(at)[0];
        onePath.unshift(p.from, p.link.id);
        at = p.from;
      }
      // All items on any shortest path: walk every predecessor from the target.
      const items = new Set([id2]);
      const stack = [id2];
      while (stack.length) {
        const at = stack.pop();
        (preds.get(at) || []).forEach(({ from, link }) => {
          items.add(link.id);
          if (!items.has(from)) { items.add(from); stack.push(from); }
        });
      }
      return {
        onePath,
        one: onePath.filter((_, i) => i % 2 === 0),
        items: [...items],
        distance: dist.get(id2),
      };
    },

    /**
     * Closeness for graphs that may be disconnected: the reciprocals of the
     * distances to every node this one reaches are summed (as the Graph
     * centrality docs describe), then multiplied by how many nodes it reaches,
     * so a node that reaches more of the graph outranks an equally close one
     * that reaches less. With `weights`, a link's length is 1 / value.
     *  'unnormalized' the plain sum of reciprocals
     * Nodes that reach nothing score 0.
     */
    closeness(opts = {}) {
      const g = indexedGraph(adjacency(opts), opts);
      const out = {};
      const tick = progressReporter(opts, g.n);
      // All sources in the WebAssembly core when available (same results; see wasmCore.js).
      const fast = closenessWasm(g, tick);
      if (fast) {
        for (let s = 0; s < g.n; s++) {
          const harmonic = fast.harmonic[s];
          out[g.ids[s]] = opts.normalization === 'unnormalized' ? harmonic : harmonic * (fast.settled[s] - 1);
        }
        return Promise.resolve(out);
      }
      const buf = ssspBuffers(g);
      for (let s = 0; s < g.n; s++) {
        tick();
        const count = sssp(g, s, buf);
        let harmonic = 0;
        for (let k = 1; k < count; k++) { const d = buf.dist[buf.order[k]]; if (d > 0) harmonic += 1 / d; }
        out[g.ids[s]] = opts.normalization === 'unnormalized' ? harmonic : harmonic * (count - 1);
      }
      return Promise.resolve(out);
    },

    /**
     * Brandes betweenness. Undirected scores are halved (each pair counted once).
     *  'component'    divided by the pair count of the node's component
     *  'chart'        divided by the pair count of the whole graph
     *  'unnormalized' raw path counts
     */
    betweenness(opts = {}) {
      const directed = !!opts.directed;
      const g = indexedGraph(adjacency({ ...opts, direction: directed ? 'from' : 'any' }), opts);
      const tick = progressReporter(opts, g.n);
      // All sources in the WebAssembly core when available (same results; see wasmCore.js).
      let raw = betweennessWasm(g, tick);
      if (!raw) raw = betweennessJs(g, tick);
      const cb = new Map(g.ids.map((id, i) => [id, raw[i]]));
      const N = g.n;
      const norm = opts.normalization || 'component';
      const sizes = componentSize(opts.all);
      const pairs = n => (directed ? (n - 1) * (n - 2) : ((n - 1) * (n - 2)) / 2);
      const out = {};
      cb.forEach((v, id) => {
        const raw = directed ? v : v / 2;
        if (norm === 'unnormalized') { out[id] = raw; return; }
        const p = pairs(norm === 'chart' ? N : sizes.get(id));
        out[id] = p > 0 ? raw / p : 0;
      });
      return Promise.resolve(out);
    },

    /**
     * Eigenvector centrality on the undirected graph (every link counts, so
     * parallel links add weight; direction is ignored). Scores are scaled per
     * connected component to sum to the component's size: the average node
     * scores 1, and an isolated node scores exactly 1.
     */
    eigenCentrality(opts = {}) {
      const ids = liveNodes(opts.all);
      const idx = new Map(ids.map((id, i) => [id, i]));
      const edges = liveLinks(opts.all).filter(l => l.id1 !== l.id2).map(l => [idx.get(l.id1), idx.get(l.id2), valueOf(l, opts.value)]);
      const comps = componentsOf(opts.all).map(c => c.map(id => idx.get(id)));
      const normalise = (v) => {
        comps.forEach(c => {
          const sum = c.reduce((acc, i) => acc + v[i], 0) || 1;
          c.forEach(i => { v[i] *= c.length / sum; });
        });
      };
      let x = new Float64Array(ids.length).fill(1);
      for (let iter = 0; iter < 5000; iter++) {
        // Adding x itself (A + I) keeps bipartite graphs from oscillating.
        const y = Float64Array.from(x);
        edges.forEach(([a, b, w]) => { y[a] += w * x[b]; y[b] += w * x[a]; });
        normalise(y);
        let delta = 0;
        for (let i = 0; i < y.length; i++) delta = Math.max(delta, Math.abs(y[i] - x[i]));
        x = y;
        if (delta < 1e-13) break;
      }
      return Object.fromEntries(ids.map((id, i) => [id, x[i]]));
    },

    /** PageRank, damping 0.85; dangling rank spreads evenly. Scores sum to 1. */
    pageRank(opts = {}) {
      const directed = opts.directed !== false;
      const ids = liveNodes(opts.all);
      const n = ids.length;
      if (n === 0) return {};
      const idx = new Map(ids.map((id, i) => [id, i]));
      const out = Array.from({ length: n }, () => []);
      liveLinks(opts.all).forEach(l => {
        if (l.id1 === l.id2) return;
        const a = idx.get(l.id1);
        const b = idx.get(l.id2);
        const w = valueOf(l, opts.value);
        const both = !directed || (!l.a1 && !l.a2);
        if (both || l.a2) out[a].push([b, w]);
        if (both || l.a1) out[b].push([a, w]);
      });
      const total = out.map(list => list.reduce((s, [, w]) => s + w, 0));
      const d = 0.85;
      let pr = new Float64Array(n).fill(1 / n);
      for (let iter = 0; iter < 1000; iter++) {
        const next = new Float64Array(n);
        let dangling = 0;
        for (let i = 0; i < n; i++) {
          if (total[i] === 0) { dangling += pr[i]; continue; }
          out[i].forEach(([j, w]) => { next[j] += (d * pr[i] * w) / total[i]; });
        }
        let delta = 0;
        for (let i = 0; i < n; i++) {
          next[i] += (1 - d) / n + (d * dangling) / n;
          delta += Math.abs(next[i] - pr[i]);
        }
        pr = next;
        if (delta < 1e-12) break;
      }
      return Object.fromEntries(ids.map((id, i) => [id, pr[i]]));
    },

    /** k-core number per node, counting distinct neighbours (Batagelj–Zaversnik, bucket queue, O(m)). */
    kCores(opts = {}) {
      const adj = adjacency({ all: opts.all });
      const nbrs = new Map([...adj].map(([id, list]) => [id, new Set(list.map(e => e.to).filter(t => t !== id))]));
      const degree = new Map([...nbrs].map(([id, set]) => [id, set.size]));
      const buckets = [];
      degree.forEach((deg, id) => { (buckets[deg] = buckets[deg] || new Set()).add(id); });
      const core = {};
      let d = 0;
      for (let done = 0; done < nbrs.size; done++) {
        while (!buckets[d] || buckets[d].size === 0) d++;
        const v = buckets[d].values().next().value;
        buckets[d].delete(v);
        core[v] = d;
        nbrs.get(v).forEach(u => {
          if (u in core) return;
          const du = degree.get(u);
          if (du > d) {
            buckets[du].delete(u);
            degree.set(u, du - 1);
            (buckets[du - 1] = buckets[du - 1] || new Set()).add(u);
          }
        });
      }
      const values = Object.values(core);
      return { maximumK: values.length ? Math.max(...values) : 0, values: core };
    },

    components(opts = {}) {
      const comps = componentsOf(opts.all);
      const live = liveLinks(opts.all);
      return comps.map(ids => {
        const set = new Set(ids);
        return { nodes: ids, links: live.filter(l => set.has(l.id1)).map(l => l.id) };
      });
    },

    /**
     * Louvain clusters. `factor` 0-10 sets the modularity resolution
     * (factor / 5, so the default 5 is classic modularity); higher gives more,
     * smaller clusters. `consistent: false` shuffles the visiting order.
     */
    clusters(opts = {}) {
      const ids = liveNodes(opts.all);
      if (ids.length === 0) return [];
      const gamma = Math.max(0.01, (opts.factor ?? 5) / 5);
      const random = opts.consistent === false ? Math.random : rng(42);
      // Weighted undirected graph over indices; merged links add weights.
      let n = ids.length;
      const idx = new Map(ids.map((id, i) => [id, i]));
      let w = Array.from({ length: n }, () => new Map());
      liveLinks(opts.all).forEach(l => {
        const a = idx.get(l.id1);
        const b = idx.get(l.id2);
        const v = valueOf(l, opts.value);
        w[a].set(b, (w[a].get(b) || 0) + v);
        if (a !== b) w[b].set(a, (w[b].get(a) || 0) + v);
      });
      let members = ids.map(id => [id]); // super-node -> original ids

      for (let level = 0; level < 20; level++) {
        // Weighted degree; a self loop counts twice.
        const k = w.map((m, i) => [...m].reduce((sum, [j, v]) => sum + (j === i ? 2 * v : v), 0));
        const m2 = k.reduce((sum, v) => sum + v, 0);
        if (m2 === 0) break;
        const comm = Array.from({ length: n }, (_, i) => i);
        const tot = k.slice();
        let improved = false;
        const order = Array.from({ length: n }, (_, i) => i);
        for (let pass = 0; pass < 50; pass++) {
          for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
          }
          let moved = false;
          order.forEach(i => {
            const ci = comm[i];
            const toComm = new Map();
            w[i].forEach((v, j) => { if (j !== i) toComm.set(comm[j], (toComm.get(comm[j]) || 0) + v); });
            tot[ci] -= k[i];
            let best = ci;
            let bestGain = (toComm.get(ci) || 0) - (gamma * tot[ci] * k[i]) / m2;
            toComm.forEach((v, c) => {
              const gain = v - (gamma * tot[c] * k[i]) / m2;
              if (gain > bestGain + 1e-12) { bestGain = gain; best = c; }
            });
            tot[best] += k[i];
            if (best !== ci) { comm[i] = best; moved = true; improved = true; }
          });
          if (!moved) break;
        }
        if (!improved) break;
        // Aggregate communities into super-nodes. Each undirected edge is
        // stored in both endpoints' maps: an inter-community edge lands once
        // in each direction; an intra-community edge twice, so it is halved.
        const remap = new Map();
        comm.forEach(c => { if (!remap.has(c)) remap.set(c, remap.size); });
        const nn = remap.size;
        const nw = Array.from({ length: nn }, () => new Map());
        const nm = Array.from({ length: nn }, () => []);
        for (let i = 0; i < n; i++) {
          const ci = remap.get(comm[i]);
          nm[ci].push(...members[i]);
          w[i].forEach((v, j) => {
            const cj = remap.get(comm[j]);
            const add = ci !== cj ? v : i === j ? v : v / 2;
            nw[ci].set(cj, (nw[ci].get(cj) || 0) + add);
          });
        }
        w = nw;
        members = nm;
        n = nn;
      }
      return members.sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
    },
  };

  return api;
}
