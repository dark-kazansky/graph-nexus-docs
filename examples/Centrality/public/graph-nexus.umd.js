var GraphNexus = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/graph-nexus-umd.js
  var graph_nexus_umd_exports = {};
  __export(graph_nexus_umd_exports, {
    default: () => graph_nexus_umd_default
  });

  // src/engine/graphEngine.js
  var asList = (v) => Array.isArray(v) ? v : v == null ? [] : [v];
  function createHeap() {
    const a = [];
    const up = (i) => {
      while (i > 0) {
        const p = i - 1 >> 1;
        if (a[p][0] <= a[i][0]) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    };
    const down = (i) => {
      for (; ; ) {
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
      get size() {
        return a.length;
      },
      push(p, v) {
        a.push([p, v]);
        up(a.length - 1);
      },
      pop() {
        const top = a[0];
        const last = a.pop();
        if (a.length) {
          a[0] = last;
          down(0);
        }
        return top;
      }
    };
  }
  function progressReporter(opts, total) {
    const fn = opts && typeof opts.onProgress === "function" ? opts.onProgress : null;
    if (!fn) return () => {
    };
    const every = Math.max(1, Math.floor(total / 20));
    let done = 0;
    return () => {
      done++;
      if (done % every === 0 || done === total) fn(done / total);
    };
  }
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = s + 1831565813 >>> 0;
      let t = Math.imul(s ^ s >>> 15, s | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function createGraphEngine(engineOptions = {}) {
    const selfLinks = !!engineOptions.selfLinks;
    let nodes = /* @__PURE__ */ new Map();
    let links = /* @__PURE__ */ new Map();
    function liveNodes(all) {
      return [...nodes.values()].filter((n) => all || !n.hi).map((n) => n.id);
    }
    function liveLinks(all) {
      return [...links.values()].filter((l) => {
        const a = nodes.get(l.id1);
        const b = nodes.get(l.id2);
        if (!a || !b) return false;
        return all || !l.hi && !a.hi && !b.hi;
      });
    }
    const valueOf = (link, key) => {
      if (!key) return 1;
      const v = Number(link.d && link.d[key]);
      return Number.isFinite(v) ? v : 1;
    };
    const lengthOf = (link, opts) => {
      const v = valueOf(link, opts.value);
      return opts.weights ? v > 0 ? 1 / v : Infinity : v;
    };
    function adjacency(opts = {}) {
      const direction = opts.direction || "any";
      const adj = new Map(liveNodes(opts.all).map((id) => [id, []]));
      liveLinks(opts.all).forEach((l) => {
        const fwd = !!l.a2;
        const back = !!l.a1;
        const add = (from, to) => adj.get(from).push({ to, link: l });
        if (direction === "any") {
          add(l.id1, l.id2);
          if (l.id1 !== l.id2) add(l.id2, l.id1);
        } else if (direction === "from") {
          if (fwd) add(l.id1, l.id2);
          if (back) add(l.id2, l.id1);
        } else {
          if (fwd) add(l.id2, l.id1);
          if (back) add(l.id1, l.id2);
        }
      });
      return adj;
    }
    function indexedGraph(adj, opts) {
      const ids = [...adj.keys()];
      const idx = new Map(ids.map((id, i) => [id, i]));
      const n = ids.length;
      const best = Array.from({ length: n }, () => /* @__PURE__ */ new Map());
      adj.forEach((list, id) => {
        const u = idx.get(id);
        list.forEach(({ to, link }) => {
          if (to === id) return;
          const len = lengthOf(link, opts);
          if (!Number.isFinite(len)) return;
          const v = idx.get(to);
          const cur = best[u].get(v);
          if (cur === void 0 || len < cur) best[u].set(v, len);
        });
      });
      const build = (reverse) => {
        const count = new Int32Array(n + 1);
        best.forEach((m, u) => m.forEach((_, v) => {
          count[(reverse ? v : u) + 1]++;
        }));
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
      for (let k = 0; k < fwd.len.length; k++) if (fwd.len[k] !== 1) {
        unit = false;
        break;
      }
      return { ids, n, fwd, rev, unit };
    }
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
            if (dist[v] === Infinity) {
              dist[v] = du;
              order[count++] = v;
            }
          }
        }
        return count;
      }
      const hd = buf.heapDist;
      const hn = buf.heapNode;
      const done = buf.done;
      done.fill(0);
      let size = 0;
      const push = (d, v) => {
        let i = size++;
        while (i > 0) {
          const p = i - 1 >> 1;
          if (hd[p] <= d) break;
          hd[i] = hd[p];
          hn[i] = hn[p];
          i = p;
        }
        hd[i] = d;
        hn[i] = v;
      };
      const pop = () => {
        const v = hn[0];
        const last = --size;
        const d = hd[last];
        const x = hn[last];
        let i = 0;
        for (; ; ) {
          let c = 2 * i + 1;
          if (c >= size) break;
          if (c + 1 < size && hd[c + 1] < hd[c]) c++;
          if (hd[c] >= d) break;
          hd[i] = hd[c];
          hn[i] = hn[c];
          i = c;
        }
        hd[i] = d;
        hn[i] = x;
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
          if (nd < dist[v] - 1e-12) {
            dist[v] = nd;
            push(nd, v);
          }
        }
      }
      return count;
    }
    function ssspBuffers(g) {
      const m = g.fwd.to.length + g.n + 1;
      return {
        dist: new Float64Array(g.n),
        order: new Int32Array(g.n),
        done: new Uint8Array(g.n),
        heapDist: new Float64Array(m),
        heapNode: new Int32Array(m),
        sigma: new Float64Array(g.n),
        delta: new Float64Array(g.n)
      };
    }
    function dijkstra(adj, source, opts) {
      const dist = /* @__PURE__ */ new Map([[source, 0]]);
      const preds = /* @__PURE__ */ new Map([[source, []]]);
      const order = [];
      const done = /* @__PURE__ */ new Set();
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
          if (cur === void 0 || nd < cur - 1e-12) {
            dist.set(to, nd);
            preds.set(to, [{ from: id, link }]);
            heap.push(nd, to);
          } else if (Math.abs(nd - cur) <= 1e-12 && !preds.get(to).some((p) => p.from === id)) {
            preds.get(to).push({ from: id, link });
          }
        });
      }
      return { dist, preds, order };
    }
    function componentsOf(all) {
      const adj = adjacency({ all });
      const seen = /* @__PURE__ */ new Set();
      const out = [];
      adj.forEach((_, start) => {
        if (seen.has(start)) return;
        const comp = [];
        const stack = [start];
        seen.add(start);
        while (stack.length) {
          const id = stack.pop();
          comp.push(id);
          adj.get(id).forEach(({ to }) => {
            if (!seen.has(to)) {
              seen.add(to);
              stack.push(to);
            }
          });
        }
        out.push(comp);
      });
      return out.sort((a, b) => b.length - a.length);
    }
    const componentSize = (all) => {
      const size = /* @__PURE__ */ new Map();
      componentsOf(all).forEach((c) => c.forEach((id) => size.set(id, c.length)));
      return size;
    };
    const api = {
      load(data) {
        nodes = /* @__PURE__ */ new Map();
        links = /* @__PURE__ */ new Map();
        asList(data && data.items).forEach((item) => {
          if (!item || item.id == null) return;
          if (item.type === "link") links.set(item.id, { ...item });
          else nodes.set(item.id, { ...item });
        });
        if (!selfLinks) links.forEach((l, id) => {
          if (l.id1 === l.id2) links.delete(id);
        });
        const parents = new Set([...nodes.values()].map((n) => n.parentId).filter((p) => p != null));
        parents.forEach((p) => {
          if (nodes.has(p) && nodes.get(p)._combo) nodes.delete(p);
        });
      },
      clear() {
        nodes = /* @__PURE__ */ new Map();
        links = /* @__PURE__ */ new Map();
      },
      degrees(opts = {}) {
        const direction = opts.direction || "any";
        const out = Object.fromEntries(liveNodes(opts.all).map((id) => [id, 0]));
        liveLinks(opts.all).forEach((l) => {
          const v = valueOf(l, opts.value);
          if (direction === "any") {
            out[l.id1] += v;
            out[l.id2] += v;
            return;
          }
          if (l.a2) out[direction === "from" ? l.id1 : l.id2] += v;
          if (l.a1) out[direction === "from" ? l.id2 : l.id1] += v;
        });
        return out;
      },
      neighbours(ids, opts = {}) {
        const start = asList(ids).filter((id) => nodes.has(id));
        const adj = adjacency(opts);
        const hops = opts.hops ?? 1;
        const seen = new Set(start);
        const linkSet = /* @__PURE__ */ new Set();
        let frontier = start.filter((id) => adj.has(id));
        for (let h = 0; h < hops && frontier.length; h++) {
          const next = [];
          frontier.forEach((id) => adj.get(id).forEach(({ to, link }) => {
            linkSet.add(link.id);
            if (!seen.has(to)) {
              seen.add(to);
              next.push(to);
            }
          }));
          frontier = next;
        }
        return { nodes: [...seen].filter((id) => !start.includes(id)), links: [...linkSet] };
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
        const onePath = [id2];
        for (let at = id2; at !== id1; ) {
          const p = preds.get(at)[0];
          onePath.unshift(p.from, p.link.id);
          at = p.from;
        }
        const items = /* @__PURE__ */ new Set([id2]);
        const stack = [id2];
        while (stack.length) {
          const at = stack.pop();
          (preds.get(at) || []).forEach(({ from, link }) => {
            items.add(link.id);
            if (!items.has(from)) {
              items.add(from);
              stack.push(from);
            }
          });
        }
        return {
          onePath,
          one: onePath.filter((_, i) => i % 2 === 0),
          items: [...items],
          distance: dist.get(id2)
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
        const buf = ssspBuffers(g);
        const out = {};
        const tick = progressReporter(opts, g.n);
        for (let s = 0; s < g.n; s++) {
          tick();
          const count = sssp(g, s, buf);
          let harmonic = 0;
          for (let k = 1; k < count; k++) {
            const d = buf.dist[buf.order[k]];
            if (d > 0) harmonic += 1 / d;
          }
          out[g.ids[s]] = opts.normalization === "unnormalized" ? harmonic : harmonic * (count - 1);
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
        const g = indexedGraph(adjacency({ ...opts, direction: directed ? "from" : "any" }), opts);
        const buf = ssspBuffers(g);
        const { sigma, delta, dist, order } = buf;
        const { rev } = g;
        const raw = new Float64Array(g.n);
        const tick = progressReporter(opts, g.n);
        const isPred = (u, v, k) => dist[u] !== Infinity && Math.abs(dist[u] + rev.len[k] - dist[v]) <= 1e-12;
        for (let s = 0; s < g.n; s++) {
          tick();
          const count = sssp(g, s, buf);
          sigma[s] = 1;
          for (let i = 1; i < count; i++) {
            const v = order[i];
            let total = 0;
            for (let k = rev.start[v]; k < rev.start[v + 1]; k++) {
              const u = rev.to[k];
              if (isPred(u, v, k)) total += sigma[u];
            }
            sigma[v] = total;
          }
          for (let i = 0; i < count; i++) delta[order[i]] = 0;
          for (let i = count - 1; i >= 1; i--) {
            const w = order[i];
            const coeff = (1 + delta[w]) / sigma[w];
            for (let k = rev.start[w]; k < rev.start[w + 1]; k++) {
              const u = rev.to[k];
              if (isPred(u, w, k)) delta[u] += sigma[u] * coeff;
            }
            raw[w] += delta[w];
          }
        }
        const cb = new Map(g.ids.map((id, i) => [id, raw[i]]));
        const N = g.n;
        const norm = opts.normalization || "component";
        const sizes = componentSize(opts.all);
        const pairs = (n) => directed ? (n - 1) * (n - 2) : (n - 1) * (n - 2) / 2;
        const out = {};
        cb.forEach((v, id) => {
          const raw2 = directed ? v : v / 2;
          if (norm === "unnormalized") {
            out[id] = raw2;
            return;
          }
          const p = pairs(norm === "chart" ? N : sizes.get(id));
          out[id] = p > 0 ? raw2 / p : 0;
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
        const edges = liveLinks(opts.all).filter((l) => l.id1 !== l.id2).map((l) => [idx.get(l.id1), idx.get(l.id2), valueOf(l, opts.value)]);
        const comps = componentsOf(opts.all).map((c) => c.map((id) => idx.get(id)));
        const normalise = (v) => {
          comps.forEach((c) => {
            const sum = c.reduce((acc, i) => acc + v[i], 0) || 1;
            c.forEach((i) => {
              v[i] *= c.length / sum;
            });
          });
        };
        let x = new Float64Array(ids.length).fill(1);
        for (let iter = 0; iter < 5e3; iter++) {
          const y = Float64Array.from(x);
          edges.forEach(([a, b, w]) => {
            y[a] += w * x[b];
            y[b] += w * x[a];
          });
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
        liveLinks(opts.all).forEach((l) => {
          if (l.id1 === l.id2) return;
          const a = idx.get(l.id1);
          const b = idx.get(l.id2);
          const w = valueOf(l, opts.value);
          const both = !directed || !l.a1 && !l.a2;
          if (both || l.a2) out[a].push([b, w]);
          if (both || l.a1) out[b].push([a, w]);
        });
        const total = out.map((list) => list.reduce((s, [, w]) => s + w, 0));
        const d = 0.85;
        let pr = new Float64Array(n).fill(1 / n);
        for (let iter = 0; iter < 1e3; iter++) {
          const next = new Float64Array(n);
          let dangling = 0;
          for (let i = 0; i < n; i++) {
            if (total[i] === 0) {
              dangling += pr[i];
              continue;
            }
            out[i].forEach(([j, w]) => {
              next[j] += d * pr[i] * w / total[i];
            });
          }
          let delta = 0;
          for (let i = 0; i < n; i++) {
            next[i] += (1 - d) / n + d * dangling / n;
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
        const nbrs = new Map([...adj].map(([id, list]) => [id, new Set(list.map((e) => e.to).filter((t) => t !== id))]));
        const degree = new Map([...nbrs].map(([id, set]) => [id, set.size]));
        const buckets = [];
        degree.forEach((deg, id) => {
          (buckets[deg] = buckets[deg] || /* @__PURE__ */ new Set()).add(id);
        });
        const core = {};
        let d = 0;
        for (let done = 0; done < nbrs.size; done++) {
          while (!buckets[d] || buckets[d].size === 0) d++;
          const v = buckets[d].values().next().value;
          buckets[d].delete(v);
          core[v] = d;
          nbrs.get(v).forEach((u) => {
            if (u in core) return;
            const du = degree.get(u);
            if (du > d) {
              buckets[du].delete(u);
              degree.set(u, du - 1);
              (buckets[du - 1] = buckets[du - 1] || /* @__PURE__ */ new Set()).add(u);
            }
          });
        }
        const values = Object.values(core);
        return { maximumK: values.length ? Math.max(...values) : 0, values: core };
      },
      components(opts = {}) {
        const comps = componentsOf(opts.all);
        const live = liveLinks(opts.all);
        return comps.map((ids) => {
          const set = new Set(ids);
          return { nodes: ids, links: live.filter((l) => set.has(l.id1)).map((l) => l.id) };
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
        let n = ids.length;
        const idx = new Map(ids.map((id, i) => [id, i]));
        let w = Array.from({ length: n }, () => /* @__PURE__ */ new Map());
        liveLinks(opts.all).forEach((l) => {
          const a = idx.get(l.id1);
          const b = idx.get(l.id2);
          const v = valueOf(l, opts.value);
          w[a].set(b, (w[a].get(b) || 0) + v);
          if (a !== b) w[b].set(a, (w[b].get(a) || 0) + v);
        });
        let members = ids.map((id) => [id]);
        for (let level = 0; level < 20; level++) {
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
            order.forEach((i) => {
              const ci = comm[i];
              const toComm = /* @__PURE__ */ new Map();
              w[i].forEach((v, j) => {
                if (j !== i) toComm.set(comm[j], (toComm.get(comm[j]) || 0) + v);
              });
              tot[ci] -= k[i];
              let best = ci;
              let bestGain = (toComm.get(ci) || 0) - gamma * tot[ci] * k[i] / m2;
              toComm.forEach((v, c) => {
                const gain = v - gamma * tot[c] * k[i] / m2;
                if (gain > bestGain + 1e-12) {
                  bestGain = gain;
                  best = c;
                }
              });
              tot[best] += k[i];
              if (best !== ci) {
                comm[i] = best;
                moved = true;
                improved = true;
              }
            });
            if (!moved) break;
          }
          if (!improved) break;
          const remap = /* @__PURE__ */ new Map();
          comm.forEach((c) => {
            if (!remap.has(c)) remap.set(c, remap.size);
          });
          const nn = remap.size;
          const nw = Array.from({ length: nn }, () => /* @__PURE__ */ new Map());
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
      }
    };
    return api;
  }

  // src/engine/layouts.js
  var DEFAULT_NODE_RADIUS = 27;
  var DEFAULT_BORDER_WIDTH = 4;
  var radiusOf = (node) => (node.e || 1) * (DEFAULT_NODE_RADIUS + (node.b ? node.bw ?? DEFAULT_BORDER_WIDTH : 0));
  function seededRandom(seed = 1) {
    let a = seed >>> 0;
    return () => {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function visibleGraph(nodes, links) {
    const ids = Object.keys(nodes).filter((id) => !nodes[id].hi);
    const live = new Set(ids);
    const edges = Object.values(links).filter((l) => !l.hi && live.has(l.id1) && live.has(l.id2) && l.id1 !== l.id2).map((l) => [l.id1, l.id2, l]);
    const adj = new Map(ids.map((id) => [id, /* @__PURE__ */ new Set()]));
    edges.forEach(([a, b]) => {
      adj.get(a).add(b);
      adj.get(b).add(a);
    });
    return { ids, edges, adj };
  }
  function components(ids, adj) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    ids.forEach((start) => {
      if (seen.has(start)) return;
      const comp = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const id = stack.pop();
        comp.push(id);
        adj.get(id).forEach((n) => {
          if (!seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        });
      }
      out.push(comp);
    });
    return out.sort((p, q) => q.length - p.length);
  }
  function recentre(nodes, ids) {
    let cx = 0;
    let cy = 0;
    ids.forEach((id) => {
      cx += nodes[id].x;
      cy += nodes[id].y;
    });
    cx /= ids.length;
    cy /= ids.length;
    ids.forEach((id) => {
      nodes[id].x -= cx;
      nodes[id].y -= cy;
    });
  }
  function enclosingCircle(nodes, ids) {
    let cx = 0;
    let cy = 0;
    ids.forEach((id) => {
      cx += nodes[id].x;
      cy += nodes[id].y;
    });
    cx /= ids.length;
    cy /= ids.length;
    const reach = (id) => Math.hypot(nodes[id].x - cx, nodes[id].y - cy) + radiusOf(nodes[id]);
    for (let k = 1; k <= 400 && ids.length > 1; k++) {
      let far = ids[0];
      ids.forEach((id) => {
        if (reach(id) > reach(far)) far = id;
      });
      cx += (nodes[far].x - cx) / (k + 1);
      cy += (nodes[far].y - cy) / (k + 1);
    }
    return { cx, cy, r: Math.max(...ids.map(reach)) };
  }
  var packPadding = (r) => Math.min(200, Math.max(20, 0.12 * r));
  function packRect(nodes, comps, centre = { x: 0, y: 0 }, aligned = false) {
    if (comps.length === 0) return;
    const gap = DEFAULT_NODE_RADIUS * 2;
    const boxes = comps.map((ids) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      ids.forEach((id) => {
        const n = nodes[id];
        const r = radiusOf(n);
        minX = Math.min(minX, n.x - r);
        maxX = Math.max(maxX, n.x + r);
        minY = Math.min(minY, n.y - r);
        maxY = Math.max(maxY, n.y + r);
      });
      return { ids, minX, minY, w: maxX - minX, h: maxY - minY };
    }).sort((a, b) => b.w * b.h - a.w * a.h);
    const area = boxes.reduce((sum, b) => sum + (b.w + gap) * (b.h + gap), 0);
    const rowWidth = Math.max(boxes[0].w, Math.sqrt(area) * 1.2);
    let x = 0;
    let y = 0;
    let rowH = 0;
    const rows = [[]];
    boxes.forEach((b) => {
      if (x > 0 && x + b.w > rowWidth) {
        x = 0;
        y += rowH + gap;
        rowH = 0;
        rows.push([]);
      }
      b.tx = x;
      b.ty = y;
      rows[rows.length - 1].push(b);
      x += b.w + gap;
      rowH = Math.max(rowH, b.h);
    });
    rows.forEach((row) => {
      const h = Math.max(...row.map((b) => b.h));
      row.forEach((b) => {
        if (!aligned) b.ty += (h - b.h) / 2;
      });
    });
    const totalW = Math.max(...boxes.map((b) => b.tx + b.w));
    const totalH = Math.max(...boxes.map((b) => b.ty + b.h));
    boxes.forEach((b) => {
      const dx = centre.x - totalW / 2 + b.tx - b.minX;
      const dy = centre.y - totalH / 2 + b.ty - b.minY;
      b.ids.forEach((id) => {
        nodes[id].x += dx;
        nodes[id].y += dy;
      });
    });
  }
  function packComponents(nodes, comps, centre, packing) {
    if (packing === "none") return;
    if (packing === "rectangle" || packing === "aligned") packRect(nodes, comps, centre, packing === "aligned");
    else packOnArc(nodes, comps, centre);
  }
  function packOnArc(nodes, comps, centre = { x: 0, y: 0 }) {
    if (comps.length === 0) return;
    const circles = comps.map((ids) => ({ ids, ...enclosingCircle(nodes, ids) }));
    const moveTo = (c, x, y) => c.ids.forEach((id) => {
      nodes[id].x += x - c.cx;
      nodes[id].y += y - c.cy;
    });
    const [main, ...rest] = circles;
    moveTo(main, 0, 0);
    const ringR = main.r + packPadding(main.r);
    const last = {};
    let up = 0;
    let down = 0;
    rest.forEach((c, k) => {
      const rp = c.r + packPadding(c.r);
      const d = ringR + rp;
      let angle = 0;
      if (k === 0) last.up = last.down = { rp, d };
      else {
        const side = k % 2 === 1 ? "down" : "up";
        const prev = last[side];
        const want = rp + prev.rp;
        const cos = (d * d + prev.d * prev.d - want * want) / (2 * d * prev.d);
        const step = Math.acos(Math.max(-1, Math.min(1, cos)));
        if (side === "down") {
          down += step;
          angle = down;
        } else {
          up -= step;
          angle = up;
        }
        last[side] = { rp, d };
      }
      moveTo(c, Math.cos(angle) * d, Math.sin(angle) * d);
    });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    comps.flat().forEach((id) => {
      const n = nodes[id];
      const r = radiusOf(n);
      minX = Math.min(minX, n.x - r);
      maxX = Math.max(maxX, n.x + r);
      minY = Math.min(minY, n.y - r);
      maxY = Math.max(maxY, n.y + r);
    });
    const dx = centre.x - (minX + maxX) / 2;
    const dy = centre.y - (minY + maxY) / 2;
    comps.flat().forEach((id) => {
      nodes[id].x += dx;
      nodes[id].y += dy;
    });
  }
  function boxCentre(nodes, ids) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    ids.forEach((id) => {
      const n = nodes[id];
      const x = n.x || 0;
      const y = n.y || 0;
      const r = radiusOf(n);
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
      minY = Math.min(minY, y - r);
      maxY = Math.max(maxY, y + r);
    });
    return ids.length ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : { x: 0, y: 0 };
  }
  var BH_THRESHOLD = 400;
  var BH_THETA = 0.9;
  function barnesHut(nodes, ids, radius, gap, disp, random) {
    const n = ids.length;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const rad = new Float64Array(n);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = nodes[ids[i]];
      xs[i] = v.x;
      ys[i] = v.y;
      rad[i] = radius(ids[i]);
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    const cap = n * 8 + 16;
    let cx0 = new Float64Array(cap);
    let cy0 = new Float64Array(cap);
    let cs = new Float64Array(cap);
    let cnt = new Int32Array(cap);
    let mx = new Float64Array(cap);
    let my = new Float64Array(cap);
    let rs = new Float64Array(cap);
    let kid = new Int32Array(cap).fill(-1);
    let leaf = new Int32Array(cap).fill(-1);
    let cells = 1;
    const grow = () => {
      const more = (a, fill) => {
        const b = new a.constructor(a.length * 2);
        if (fill !== void 0) b.fill(fill);
        b.set(a);
        return b;
      };
      cx0 = more(cx0);
      cy0 = more(cy0);
      cs = more(cs);
      cnt = more(cnt);
      mx = more(mx);
      my = more(my);
      rs = more(rs);
      kid = more(kid, -1);
      leaf = more(leaf, -1);
    };
    cx0[0] = minX;
    cy0[0] = minY;
    cs[0] = Math.max(maxX - minX, maxY - minY, 1) * 1.0001;
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
        cx0[k] = cx0[c] + (q & 1) * h;
        cy0[k] = cy0[c] + (q >> 1) * h;
        cs[k] = h;
        cnt[k] = 0;
        mx[k] = 0;
        my[k] = 0;
        rs[k] = 0;
        kid[k] = -1;
        leaf[k] = -1;
      }
    };
    for (let i = 0; i < n; i++) {
      let c = 0;
      for (let depth = 0; ; depth++) {
        mx[c] = (mx[c] * cnt[c] + xs[i]) / (cnt[c] + 1);
        my[c] = (my[c] * cnt[c] + ys[i]) / (cnt[c] + 1);
        rs[c] += rad[i];
        cnt[c]++;
        if (cnt[c] === 1) {
          leaf[c] = i;
          break;
        }
        if (depth > 40) break;
        if (kid[c] < 0) {
          split(c);
          const old = leaf[c];
          if (old >= 0) {
            leaf[c] = -1;
            const k = childFor(c, old);
            mx[k] = xs[old];
            my[k] = ys[old];
            rs[k] = rad[old];
            cnt[k] = 1;
            leaf[k] = old;
          }
        }
        c = childFor(c, i);
      }
    }
    const theta2 = BH_THETA * BH_THETA;
    const stack = new Int32Array(cells + 8);
    for (let i = 0; i < n; i++) {
      const vx = xs[i];
      const vy = ys[i];
      const rv = rad[i];
      let fx = 0;
      let fy = 0;
      let top = 0;
      stack[top++] = 0;
      while (top > 0) {
        const c = stack[--top];
        const count = cnt[c];
        if (count === 0 || count === 1 && leaf[c] === i) continue;
        let dx = vx - mx[c];
        let dy = vy - my[c];
        let distSq = dx * dx + dy * dy;
        if (kid[c] >= 0 && cs[c] * cs[c] > theta2 * distSq) {
          const k = kid[c];
          stack[top++] = k;
          stack[top++] = k + 1;
          stack[top++] = k + 2;
          stack[top++] = k + 3;
          continue;
        }
        if (distSq < 0.01) {
          dx = random() - 0.5;
          dy = random() - 0.5;
          distSq = 0.01;
        }
        const dist = Math.sqrt(distSq);
        const kk = rv + rs[c] / count + gap;
        const force = kk * kk / dist * count;
        fx += dx / dist * force;
        fy += dy / dist * force;
      }
      const d = disp[ids[i]];
      d.x += fx;
      d.y += fy;
    }
  }
  function gridNeighbours(nodes, ids, cell) {
    const grid = /* @__PURE__ */ new Map();
    const key = (gx, gy) => `${gx},${gy}`;
    ids.forEach((id, i) => {
      const k = key(Math.floor(nodes[id].x / cell), Math.floor(nodes[id].y / cell));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    return (i) => {
      const gx = Math.floor(nodes[ids[i]].x / cell);
      const gy = Math.floor(nodes[ids[i]].y / cell);
      const out = [];
      for (let x = gx - 1; x <= gx + 1; x++) for (let y = gy - 1; y <= gy + 1; y++) out.push(...grid.get(key(x, y)) || []);
      return out;
    };
  }
  function forceLayout(nodes, links, opts = {}) {
    const { ids, edges, adj } = visibleGraph(nodes, links);
    if (ids.length === 0) return;
    const centre = boxCentre(nodes, ids);
    const comps = components(ids, adj);
    comps.forEach((comp) => {
      const set = new Set(comp);
      (opts.dimensions === 3 ? forceComponent3D : forceComponent)(nodes, comp, edges.filter(([a]) => set.has(a)), opts);
    });
    if (opts.fixed && opts.fixed.length) return;
    if (opts.packing === "none") return;
    if (opts.dimensions === 3) {
      packSphere(nodes, comps, centre);
      return;
    }
    if (opts.adaptive) comps.forEach((comp) => recentre(nodes, comp));
    packComponents(nodes, comps, centre, opts.packing === "adaptive" ? "circle" : opts.packing);
  }
  var LARGE_COMPONENT = 2e3;
  var LARGE_ITERATIONS = 100;
  function forceComponent(nodes, ids, edges, opts) {
    const n = ids.length;
    const random = opts.random || Math.random;
    const fixed = new Set(opts.fixed || []);
    const iterations = n > LARGE_COMPONENT ? Math.min(opts.iterations || 300, LARGE_ITERATIONS) : opts.iterations || 300;
    if (n === 1) {
      const only = nodes[ids[0]];
      const placed = Number.isFinite(only.x) && Number.isFinite(only.y);
      if (!fixed.has(ids[0]) && (!opts.adaptive || !placed)) {
        only.x = 0;
        only.y = 0;
      }
      return;
    }
    const tight = Math.min(10, Math.max(0, opts.tightness ?? 5));
    const gap = DEFAULT_NODE_RADIUS * (1 + (10 - tight) * 0.4);
    const k = DEFAULT_NODE_RADIUS * 2 + gap;
    const r = (id) => radiusOf(nodes[id]);
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const span = cols * k;
    ids.forEach((id, i) => {
      const node = nodes[id];
      const unplaced = !Number.isFinite(node.x) || !Number.isFinite(node.y) || node.x === 0 && node.y === 0;
      if (unplaced && (!opts.adaptive || !fixed.has(id))) {
        node.x = i % cols * k - span / 2 + (random() - 0.5) * k * 0.5;
        node.y = Math.floor(i / cols) * k - span / 2 + (random() - 0.5) * k * 0.5;
      }
    });
    const gravity = 75e-4;
    let temperature = span * (opts.adaptive ? 0.02 : 0.1);
    const minTemp = k * 0.01;
    const cooling = (temperature - minTemp) / (iterations + 1);
    let gx = 0;
    let gy = 0;
    if (opts.adaptive) {
      ids.forEach((id) => {
        gx += nodes[id].x;
        gy += nodes[id].y;
      });
      gx /= n;
      gy /= n;
    }
    const useTree = n > BH_THRESHOLD;
    for (let step = 0; step < iterations; step++) {
      const disp = {};
      ids.forEach((id) => {
        disp[id] = { x: 0, y: 0 };
      });
      if (useTree) barnesHut(nodes, ids, r, gap, disp, random);
      else for (let a = 0; a < n; a++) {
        const va = nodes[ids[a]];
        for (let b = a + 1; b < n; b++) {
          const vb = nodes[ids[b]];
          let dx = va.x - vb.x;
          let dy = va.y - vb.y;
          let distSq = dx * dx + dy * dy;
          if (distSq < 0.01) {
            dx = random() - 0.5;
            dy = random() - 0.5;
            distSq = 0.01;
          }
          const dist = Math.sqrt(distSq);
          const kk = r(ids[a]) + r(ids[b]) + gap;
          const force = kk * kk / dist;
          disp[ids[a]].x += dx / dist * force;
          disp[ids[a]].y += dy / dist * force;
          disp[ids[b]].x -= dx / dist * force;
          disp[ids[b]].y -= dy / dist * force;
        }
      }
      edges.forEach(([id1, id2]) => {
        const v1 = nodes[id1];
        const v2 = nodes[id2];
        const dx = v1.x - v2.x;
        const dy = v1.y - v2.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = dist * dist / (r(id1) + r(id2) + gap);
        disp[id1].x -= dx / dist * force;
        disp[id1].y -= dy / dist * force;
        disp[id2].x += dx / dist * force;
        disp[id2].y += dy / dist * force;
      });
      ids.forEach((id) => {
        if (fixed.has(id)) return;
        const node = nodes[id];
        const d = disp[id];
        d.x -= (node.x - gx) * gravity * k;
        d.y -= (node.y - gy) * gravity * k;
        const len = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
        node.x += d.x / len * Math.min(len, temperature);
        node.y += d.y / len * Math.min(len, temperature);
      });
      temperature = Math.max(temperature - cooling, minTemp);
    }
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
          if (!fixed.has(ids[a])) {
            va.x -= dx / dist * push;
            va.y -= dy / dist * push;
          }
          if (!fixed.has(ids[b])) {
            vb.x += dx / dist * push;
            vb.y += dy / dist * push;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    if (!opts.adaptive && fixed.size === 0) recentre(nodes, ids);
  }
  function barnesHut3D(nodes, ids, radius, gap, disp, random) {
    const n = ids.length;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const zs = new Float64Array(n);
    const rad = new Float64Array(n);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const v = nodes[ids[i]];
      xs[i] = v.x;
      ys[i] = v.y;
      zs[i] = v.z;
      rad[i] = radius(ids[i]);
      [v.x, v.y, v.z].forEach((c, a) => {
        if (c < lo[a]) lo[a] = c;
        if (c > hi[a]) hi[a] = c;
      });
    }
    const cells = [];
    const cell = (ox, oy, oz, size) => {
      cells.push({ ox, oy, oz, size, cnt: 0, mx: 0, my: 0, mz: 0, rs: 0, kid: -1, leaf: -1 });
      return cells.length - 1;
    };
    cell(lo[0], lo[1], lo[2], Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1) * 1.0001);
    const childFor = (c, i) => {
      const C = cells[c];
      const h = C.size / 2;
      return C.kid + (xs[i] >= C.ox + h ? 1 : 0) + (ys[i] >= C.oy + h ? 2 : 0) + (zs[i] >= C.oz + h ? 4 : 0);
    };
    const split = (c) => {
      const C = cells[c];
      const h = C.size / 2;
      C.kid = cells.length;
      for (let q = 0; q < 8; q++) cell(C.ox + (q & 1) * h, C.oy + (q >> 1 & 1) * h, C.oz + (q >> 2) * h, h);
    };
    for (let i = 0; i < n; i++) {
      let c = 0;
      for (let depth = 0; ; depth++) {
        const C = cells[c];
        C.mx = (C.mx * C.cnt + xs[i]) / (C.cnt + 1);
        C.my = (C.my * C.cnt + ys[i]) / (C.cnt + 1);
        C.mz = (C.mz * C.cnt + zs[i]) / (C.cnt + 1);
        C.rs += rad[i];
        C.cnt++;
        if (C.cnt === 1) {
          C.leaf = i;
          break;
        }
        if (depth > 40) break;
        if (C.kid < 0) {
          split(c);
          const old = C.leaf;
          if (old >= 0) {
            C.leaf = -1;
            const K = cells[childFor(c, old)];
            Object.assign(K, { mx: xs[old], my: ys[old], mz: zs[old], rs: rad[old], cnt: 1, leaf: old });
          }
        }
        c = childFor(c, i);
      }
    }
    const theta2 = BH_THETA * BH_THETA;
    for (let i = 0; i < n; i++) {
      let fx = 0;
      let fy = 0;
      let fz = 0;
      const stack = [0];
      while (stack.length) {
        const C = cells[stack.pop()];
        if (C.cnt === 0 || C.cnt === 1 && C.leaf === i) continue;
        let dx = xs[i] - C.mx;
        let dy = ys[i] - C.my;
        let dz = zs[i] - C.mz;
        let distSq = dx * dx + dy * dy + dz * dz;
        if (C.kid >= 0 && C.size * C.size > theta2 * distSq) {
          for (let q = 0; q < 8; q++) stack.push(C.kid + q);
          continue;
        }
        if (distSq < 0.01) {
          dx = random() - 0.5;
          dy = random() - 0.5;
          dz = random() - 0.5;
          distSq = 0.01;
        }
        const dist = Math.sqrt(distSq);
        const kk = rad[i] + C.rs / C.cnt + gap;
        const force = kk * kk / dist * C.cnt;
        fx += dx / dist * force;
        fy += dy / dist * force;
        fz += dz / dist * force;
      }
      const d = disp[ids[i]];
      d.x += fx;
      d.y += fy;
      d.z += fz;
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
      if (!fixed.has(ids[0]) && (!opts.adaptive || !placed)) {
        only.x = 0;
        only.y = 0;
        only.z = 0;
      } else if (!Number.isFinite(only.z)) only.z = 0;
      return;
    }
    const tight = Math.min(10, Math.max(0, opts.tightness ?? 5));
    const gap = DEFAULT_NODE_RADIUS * (1 + (10 - tight) * 0.4);
    const k = DEFAULT_NODE_RADIUS * 2 + gap;
    const r = (id) => radiusOf(nodes[id]);
    const cols = Math.max(1, Math.ceil(Math.cbrt(n)));
    const span = cols * k;
    ids.forEach((id, i) => {
      const node = node3(nodes[id]);
      const unplaced = !Number.isFinite(node.x) || !Number.isFinite(node.y) || node.x === 0 && node.y === 0 && node.z === 0;
      if (unplaced && (!opts.adaptive || !fixed.has(id))) {
        node.x = i % cols * k - span / 2 + (random() - 0.5) * k * 0.5;
        node.y = Math.floor(i / cols) % cols * k - span / 2 + (random() - 0.5) * k * 0.5;
        node.z = Math.floor(i / (cols * cols)) * k - span / 2 + (random() - 0.5) * k * 0.5;
      } else if (node.flat && !fixed.has(id)) node.z = (random() - 0.5) * k;
      delete node.flat;
    });
    const gravity = 75e-4;
    let temperature = span * (opts.adaptive ? 0.02 : 0.1);
    const minTemp = k * 0.01;
    const cooling = (temperature - minTemp) / (iterations + 1);
    let gx = 0;
    let gy = 0;
    let gz = 0;
    if (opts.adaptive) {
      ids.forEach((id) => {
        gx += nodes[id].x;
        gy += nodes[id].y;
        gz += nodes[id].z;
      });
      gx /= n;
      gy /= n;
      gz /= n;
    }
    const useTree = n > BH_THRESHOLD;
    for (let step = 0; step < iterations; step++) {
      const disp = {};
      ids.forEach((id) => {
        disp[id] = { x: 0, y: 0, z: 0 };
      });
      if (useTree) barnesHut3D(nodes, ids, r, gap, disp, random);
      else for (let a = 0; a < n; a++) {
        const va = nodes[ids[a]];
        for (let b = a + 1; b < n; b++) {
          const vb = nodes[ids[b]];
          let dx = va.x - vb.x;
          let dy = va.y - vb.y;
          let dz = va.z - vb.z;
          let distSq = dx * dx + dy * dy + dz * dz;
          if (distSq < 0.01) {
            dx = random() - 0.5;
            dy = random() - 0.5;
            dz = random() - 0.5;
            distSq = 0.01;
          }
          const dist = Math.sqrt(distSq);
          const kk = r(ids[a]) + r(ids[b]) + gap;
          const f = kk * kk / dist / dist;
          const da = disp[ids[a]];
          const db = disp[ids[b]];
          da.x += dx * f;
          da.y += dy * f;
          da.z += dz * f;
          db.x -= dx * f;
          db.y -= dy * f;
          db.z -= dz * f;
        }
      }
      edges.forEach(([id1, id2]) => {
        const v1 = nodes[id1];
        const v2 = nodes[id2];
        const dx = v1.x - v2.x;
        const dy = v1.y - v2.y;
        const dz = v1.z - v2.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
        const f = dist / (r(id1) + r(id2) + gap);
        const d1 = disp[id1];
        const d2 = disp[id2];
        d1.x -= dx * f;
        d1.y -= dy * f;
        d1.z -= dz * f;
        d2.x += dx * f;
        d2.y += dy * f;
        d2.z += dz * f;
      });
      ids.forEach((id) => {
        if (fixed.has(id)) return;
        const node = nodes[id];
        const d = disp[id];
        d.x -= (node.x - gx) * gravity * k;
        d.y -= (node.y - gy) * gravity * k;
        d.z -= (node.z - gz) * gravity * k;
        const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z) || 0.01;
        const move = Math.min(len, temperature) / len;
        node.x += d.x * move;
        node.y += d.y * move;
        node.z += d.z * move;
      });
      temperature = Math.max(temperature - cooling, minTemp);
    }
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
          const dx = vb.x - va.x;
          const dy = vb.y - va.y;
          const dz = vb.z - va.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq >= min * min) continue;
          const dist = Math.sqrt(distSq) || 0.01;
          const push = (min - dist) / 2 / dist;
          if (!fixed.has(ids[a])) {
            va.x -= dx * push;
            va.y -= dy * push;
            va.z -= dz * push;
          }
          if (!fixed.has(ids[b])) {
            vb.x += dx * push;
            vb.y += dy * push;
            vb.z += dz * push;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    if (!opts.adaptive && fixed.size === 0) {
      recentre(nodes, ids);
      let cz = 0;
      ids.forEach((id) => {
        cz += nodes[id].z;
      });
      cz /= n;
      ids.forEach((id) => {
        nodes[id].z -= cz;
      });
    }
  }
  function gridNeighbours3D(nodes, ids, cell) {
    const grid = /* @__PURE__ */ new Map();
    const at = (i) => [nodes[ids[i]].x, nodes[ids[i]].y, nodes[ids[i]].z].map((c) => Math.floor(c / cell));
    ids.forEach((id, i) => {
      const k = at(i).join();
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    return (i) => {
      const [gx, gy, gz] = at(i);
      const out = [];
      for (let x = gx - 1; x <= gx + 1; x++) for (let y = gy - 1; y <= gy + 1; y++) for (let z = gz - 1; z <= gz + 1; z++) {
        const list = grid.get(`${x},${y},${z}`);
        if (list) out.push(...list);
      }
      return out;
    };
  }
  function packSphere(nodes, comps, centre) {
    if (!comps.length) return;
    const ball = (ids) => {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      ids.forEach((id) => {
        cx += nodes[id].x;
        cy += nodes[id].y;
        cz += nodes[id].z || 0;
      });
      cx /= ids.length;
      cy /= ids.length;
      cz /= ids.length;
      let r = 0;
      ids.forEach((id) => {
        const n = nodes[id];
        r = Math.max(r, Math.hypot(n.x - cx, n.y - cy, (n.z || 0) - cz) + radiusOf(n));
      });
      return { cx, cy, cz, r };
    };
    const move = (ids, b, x, y, z) => ids.forEach((id) => {
      const n = nodes[id];
      n.x += x - b.cx;
      n.y += y - b.cy;
      n.z = (n.z || 0) + z - b.cz;
    });
    const [main, ...rest] = comps;
    const core = ball(main);
    move(main, core, centre.x, centre.y, 0);
    if (!rest.length) return;
    const balls = rest.map(ball);
    const pad = DEFAULT_NODE_RADIUS * 2;
    const biggest = Math.max(...balls.map((b) => b.r));
    const shell = Math.max(core.r + pad + biggest, Math.sqrt(rest.length) * (2 * biggest + pad) * 0.6);
    const golden = Math.PI * (3 - Math.sqrt(5));
    rest.forEach((comp, i) => {
      const y = 1 - 2 * (i + 0.5) / rest.length;
      const ring = Math.sqrt(1 - y * y);
      const a = i * golden;
      move(comp, balls[i], centre.x + Math.cos(a) * ring * shell, centre.y + y * shell, Math.sin(a) * ring * shell);
    });
  }
  function node3(node) {
    if (!Number.isFinite(node.z)) {
      node.z = 0;
      node.flat = true;
    }
    return node;
  }
  function bfsLevels(comp, adj, roots) {
    const level = /* @__PURE__ */ new Map();
    const parent = /* @__PURE__ */ new Map();
    const queue = [];
    const seed = (id) => {
      level.set(id, 0);
      parent.set(id, null);
      queue.push(id);
    };
    roots.forEach(seed);
    const drain = () => {
      while (queue.length) {
        const id = queue.shift();
        adj.get(id).forEach((n) => {
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
  function directedLevels(comp, edges) {
    const set = new Set(comp);
    const out = new Map(comp.map((id) => [id, []]));
    const indeg = new Map(comp.map((id) => [id, 0]));
    edges.forEach(([a, b, link]) => {
      if (!set.has(a)) return;
      const [from, to] = link && link.a1 && !link.a2 ? [b, a] : [a, b];
      out.get(from).push(to);
    });
    const state = /* @__PURE__ */ new Map();
    const dag = new Map(comp.map((id) => [id, []]));
    const visit = (id) => {
      state.set(id, 1);
      out.get(id).forEach((n) => {
        if (state.get(n) === 1) return;
        dag.get(id).push(n);
        if (!state.has(n)) visit(n);
      });
      state.set(id, 2);
    };
    comp.forEach((id) => {
      if (!state.has(id)) visit(id);
    });
    dag.forEach((targets) => targets.forEach((t) => indeg.set(t, indeg.get(t) + 1)));
    const level = /* @__PURE__ */ new Map();
    const queue = comp.filter((id) => indeg.get(id) === 0);
    queue.forEach((id) => level.set(id, 0));
    while (queue.length) {
      const id = queue.shift();
      dag.get(id).forEach((n) => {
        level.set(n, Math.max(level.get(n) ?? 0, level.get(id) + 1));
        indeg.set(n, indeg.get(n) - 1);
        if (indeg.get(n) === 0) queue.push(n);
      });
    }
    return level;
  }
  function pickRoots(comp, adj, top) {
    const wanted = comp.filter((id) => top.has(id));
    if (wanted.length) return wanted;
    return [comp.reduce((best, id) => adj.get(id).size > adj.get(best).size ? id : best, comp[0])];
  }
  function orderLayers(layers, adj) {
    const pos = /* @__PURE__ */ new Map();
    layers.forEach((layer) => layer.forEach((id, i) => pos.set(id, i)));
    const sweep = (from, to, step) => {
      for (let l = from; l !== to; l += step) {
        const prev = new Set(layers[l - step] || []);
        const bary = (id) => {
          const ns = [...adj.get(id)].filter((n) => prev.has(n));
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
  function layeredLayout(nodes, links, opts = {}) {
    const { ids, edges, adj } = visibleGraph(nodes, links);
    if (ids.length === 0) return;
    const top = new Set([].concat(opts.top || []));
    const tight = Math.min(10, Math.max(0, opts.tightness ?? 5));
    const across = DEFAULT_NODE_RADIUS * (2.4 + (10 - tight) * 0.12);
    const baseDown = DEFAULT_NODE_RADIUS * (3 + (10 - tight) * 0.4) * (opts.stretch > 0 ? opts.stretch : 1);
    const orientation = opts.orientation || "down";
    const order = typeof opts.orderBy === "string" ? { property: opts.orderBy } : opts.orderBy;
    const spacing = opts.spacing || "auto";
    const stackGrid = opts.stacking && opts.stacking.arrange === "grid";
    const centre = boxCentre(nodes, ids);
    const comps = components(ids, adj);
    let offset = 0;
    comps.forEach((comp) => {
      let level;
      if (opts.level) {
        const read = (id) => Number((nodes[id].d || {})[opts.level]);
        level = new Map(comp.map((id) => [id, Number.isFinite(read(id)) ? read(id) : 0]));
      } else if (opts.directed) {
        level = directedLevels(comp, edges);
      } else {
        level = bfsLevels(comp, adj, pickRoots(comp, adj, top)).level;
      }
      const distinct = [...new Set(comp.map((id) => level.get(id) ?? 0))].sort((a, b) => a - b);
      const rank = new Map(distinct.map((v, i) => [v, i]));
      const layers = distinct.map(() => []);
      comp.forEach((id) => layers[rank.get(level.get(id) ?? 0)].push(id));
      orderLayers(layers, adj);
      if (order && order.property) {
        const dir = order.sortBy === "ascending" ? 1 : -1;
        const key = (id) => (nodes[id].d || {})[order.property];
        layers.forEach((layer) => layer.sort((p, q) => {
          const a = key(p);
          const b = key(q);
          if (a === b) return 0;
          if (a === void 0) return 1;
          if (b === void 0) return -1;
          return (a < b ? -1 : 1) * dir;
        }));
      }
      const slotsOf = (layer) => {
        if (!stackGrid) return layer.map((id) => ({ ids: [id] }));
        const groups = /* @__PURE__ */ new Map();
        layer.forEach((id) => {
          const key = [...adj.get(id)].sort().join("\0") + (order && order.property ? `|${(nodes[id].d || {})[order.property]}` : "");
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(id);
        });
        const seen = /* @__PURE__ */ new Set();
        const slots = [];
        layer.forEach((id) => {
          if (seen.has(id)) return;
          const key = [...groups.entries()].find(([, members]) => members.includes(id))[1];
          if (key.length >= 4) {
            key.forEach((m) => seen.add(m));
            slots.push({ ids: key });
          } else {
            seen.add(id);
            slots.push({ ids: [id] });
          }
        });
        return slots;
      };
      const maxSize = Math.max(...comp.map((id) => radiusOf(nodes[id]) * 2));
      const nodeStep = (id) => (spacing === "equal" ? maxSize : radiusOf(nodes[id]) * 2) + across - DEFAULT_NODE_RADIUS * 2;
      const slotLayers = layers.map(slotsOf);
      slotLayers.forEach((slots) => slots.forEach((slot) => {
        const cols = Math.ceil(Math.sqrt(slot.ids.length));
        slot.cols = cols;
        slot.rows = Math.ceil(slot.ids.length / cols);
        const cell = Math.max(...slot.ids.map(nodeStep));
        slot.cell = cell;
        slot.w = cols * cell;
        slot.depth = slot.rows * cell;
      }));
      const layerWidth = (slots) => slots.reduce((sum, slot) => sum + slot.w, 0);
      const width = Math.max(...slotLayers.map(layerWidth));
      const depthOf = (slots) => Math.max(...slots.map((slot) => (slot.rows - 1) * slot.cell + Math.max(...slot.ids.map((id) => radiusOf(nodes[id]) * 2))));
      const levelPos = [];
      let pos = 0;
      slotLayers.forEach((slots, l) => {
        if (l > 0) {
          const prev = slotLayers[l - 1];
          let gap = baseDown;
          if (opts.flatten) gap = (depthOf(prev) + depthOf(slots)) / 2 + DEFAULT_NODE_RADIUS * (0.6 + (10 - tight) * 0.08);
          else if (opts.stretchType === "auto") gap = Math.max(baseDown, (depthOf(prev) + depthOf(slots)) / 2 + DEFAULT_NODE_RADIUS);
          pos += gap;
        }
        levelPos.push(pos);
        pos += depthOf(slots) - Math.max(...slots.map((slot) => Math.max(...slot.ids.map((id) => radiusOf(nodes[id]) * 2))));
      });
      slotLayers.forEach((slots, l) => {
        const w = layerWidth(slots);
        const stretchGap = spacing === "stretched" && slots.length > 1 ? (width - w) / (slots.length - 1) : 0;
        let cursor = offset + (spacing === "stretched" && slots.length > 1 ? 0 : (width - w) / 2);
        slots.forEach((slot) => {
          slot.ids.forEach((id, i) => {
            const a = cursor + (i % slot.cols + 0.5) * slot.cell;
            const b = levelPos[l] + Math.floor(i / slot.cols) * slot.cell;
            const node = nodes[id];
            if (orientation === "down") {
              node.x = a;
              node.y = b;
            } else if (orientation === "up") {
              node.x = a;
              node.y = -b;
            } else if (orientation === "right") {
              node.x = b;
              node.y = a;
            } else {
              node.x = -b;
              node.y = a;
            }
          });
          cursor += slot.w + stretchGap;
        });
      });
      offset += width + across;
    });
    if (opts.packing && opts.packing !== "aligned") {
      comps.forEach((comp) => recentre(nodes, comp));
      packComponents(nodes, comps, centre, opts.packing);
    }
  }
  function radialLayout(nodes, links, opts = {}) {
    const { ids, adj } = visibleGraph(nodes, links);
    if (ids.length === 0) return;
    const top = new Set([].concat(opts.top || []));
    const tight = Math.min(10, Math.max(0, opts.tightness ?? 5));
    const ringGap = DEFAULT_NODE_RADIUS * (3 + (10 - tight) * 0.4);
    const comps = components(ids, adj);
    comps.forEach((comp) => {
      const roots = pickRoots(comp, adj, top).slice(0, 1);
      const { level, parent } = bfsLevels(comp, adj, roots);
      const children = new Map(comp.map((id) => [id, []]));
      comp.forEach((id) => {
        const p = parent.get(id);
        if (p != null) children.get(p).push(id);
      });
      const leaves = /* @__PURE__ */ new Map();
      const count = (id) => {
        if (leaves.has(id)) return leaves.get(id);
        const c = children.get(id);
        const v = c.length ? c.reduce((s, k) => s + count(k), 0) : 1;
        leaves.set(id, v);
        return v;
      };
      const place = (id, a0, a1) => {
        const l = level.get(id);
        const mid = (a0 + a1) / 2;
        nodes[id].x = l === 0 ? 0 : Math.cos(mid) * l * ringGap;
        nodes[id].y = l === 0 ? 0 : Math.sin(mid) * l * ringGap;
        let a = a0;
        children.get(id).forEach((c) => {
          const span = (a1 - a0) * count(c) / count(id);
          place(c, a, a + span);
          a += span;
        });
      };
      place(roots[0], 0, Math.PI * 2);
    });
    packOnArc(nodes, comps);
  }
  function lensLayout(nodes, links, opts = {}) {
    const { ids, adj } = visibleGraph(nodes, links);
    if (ids.length === 0) return;
    const tight = Math.min(10, Math.max(0, opts.tightness ?? 5));
    const spacing = DEFAULT_NODE_RADIUS * (2.4 + (10 - tight) * 0.15);
    const comps = components(ids, adj);
    comps.forEach((comp) => {
      const sorted = comp.slice().sort((p, q) => adj.get(q).size - adj.get(p).size);
      let ring = 0;
      let i = 0;
      while (i < sorted.length) {
        const radius = ring * spacing * 1.2;
        const capacity = ring === 0 ? 1 : Math.max(1, Math.floor(2 * Math.PI * radius / spacing));
        const members = sorted.slice(i, i + capacity);
        members.forEach((id, j) => {
          const a = j / members.length * Math.PI * 2 + ring * 0.5;
          nodes[id].x = Math.cos(a) * radius;
          nodes[id].y = Math.sin(a) * radius;
        });
        i += capacity;
        ring++;
      }
    });
    packOnArc(nodes, comps);
  }
  function structuralLayout(nodes, links, opts = {}) {
    const { ids, adj } = visibleGraph(nodes, links);
    if (ids.length === 0) return;
    const groups = /* @__PURE__ */ new Map();
    ids.forEach((id) => {
      const key = [...adj.get(id)].sort().join("\0");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(id);
    });
    const groupOf = /* @__PURE__ */ new Map();
    const supers = {};
    [...groups.values()].forEach((members, g) => {
      members.forEach((id) => groupOf.set(id, `g${g}`));
      supers[`g${g}`] = { id: `g${g}`, e: Math.sqrt(members.length) * 1.2, members };
    });
    const superLinks = {};
    ids.forEach((id) => adj.get(id).forEach((n) => {
      const a = groupOf.get(id);
      const b = groupOf.get(n);
      if (a !== b) superLinks[a < b ? `${a}|${b}` : `${b}|${a}`] = { id1: a, id2: b };
    }));
    forceLayout(supers, superLinks, opts);
    const step = DEFAULT_NODE_RADIUS * 2.4;
    Object.values(supers).forEach((s) => {
      const cols = Math.ceil(Math.sqrt(s.members.length));
      s.members.forEach((id, i) => {
        nodes[id].x = s.x + (i % cols - (cols - 1) / 2) * step;
        nodes[id].y = s.y + (Math.floor(i / cols) - (Math.ceil(s.members.length / cols) - 1) / 2) * step;
      });
    });
  }
  function runLayout(name = "standard", nodes, links, opts = {}) {
    const random = opts.consistent ? seededRandom(1) : Math.random;
    const common = { tightness: opts.tightness, random, fixed: opts.fixed, top: opts.top, packing: opts.packing };
    const force3D = opts.dimensions === 3 && ["standard", "organic", "tweak"].includes(name);
    if (!force3D) Object.values(nodes).forEach((n) => {
      if (!n.hi && n.z) n.z = 0;
    });
    if (force3D) common.dimensions = 3;
    const layered = {
      level: opts.level,
      orientation: opts.orientation,
      orderBy: opts.orderBy,
      spacing: opts.spacing,
      stacking: opts.stacking,
      stretch: opts.stretch,
      stretchType: opts.stretchType
    };
    switch (name) {
      case "organic":
      case "standard": {
        const adaptive = opts.mode === "adaptive" || opts.packing === "adaptive" || opts.packing === "none";
        return forceLayout(nodes, links, { ...common, packing: opts.packing === "adaptive" ? void 0 : opts.packing, adaptive, iterations: adaptive ? 120 : 300 });
      }
      case "tweak":
        return forceLayout(nodes, links, { ...common, adaptive: true, iterations: 60 });
      case "hierarchy":
        return layeredLayout(nodes, links, { ...common, ...layered, flatten: opts.flatten });
      case "sequential":
        if (opts.mode === "adaptive") return forceLayout(nodes, links, { ...common, adaptive: true, iterations: 60 });
        return layeredLayout(nodes, links, { ...common, ...layered, directed: !opts.top && !opts.level });
      case "radial":
        return radialLayout(nodes, links, common);
      case "lens":
        return lensLayout(nodes, links, common);
      case "structural":
        return structuralLayout(nodes, links, common);
      default:
        throw new Error(`Unknown layout name: ${name}`);
    }
  }
  function arrangeNodes(name, nodes, links, ids, opts = {}) {
    const list = ids.filter((id) => nodes[id] && !nodes[id].hi);
    if (list.length === 0) return;
    let cx = 0;
    let cy = 0;
    if (opts.position === "absolute") {
      cx = opts.x || 0;
      cy = opts.y || 0;
    } else {
      list.forEach((id) => {
        cx += nodes[id].x || 0;
        cy += nodes[id].y || 0;
      });
      cx /= list.length;
      cy /= list.length;
    }
    const tight = Math.min(10, Math.max(0, opts.tightness ?? 5));
    const step = DEFAULT_NODE_RADIUS * (2.2 + (10 - tight) * 0.15) * Math.max(...list.map((id) => nodes[id].e || 1));
    const viaLayout = (fn) => {
      const subset = {};
      list.forEach((id) => {
        subset[id] = { ...nodes[id] };
      });
      fn(subset);
      let sx = 0;
      let sy = 0;
      list.forEach((id) => {
        sx += subset[id].x;
        sy += subset[id].y;
      });
      sx /= list.length;
      sy /= list.length;
      list.forEach((id) => {
        nodes[id].x = cx + subset[id].x - sx;
        nodes[id].y = cy + subset[id].y - sy;
      });
    };
    if (name === "grid") {
      const shape = opts.gridShape;
      let cols = Math.ceil(Math.sqrt(list.length));
      if (shape && shape.columns) cols = Math.max(1, Math.min(list.length, shape.columns));
      else if (shape && shape.rows) cols = Math.max(1, Math.ceil(list.length / shape.rows));
      const rows = Math.ceil(list.length / cols);
      list.forEach((id, i) => {
        nodes[id].x = cx + (i % cols - (cols - 1) / 2) * step;
        nodes[id].y = cy + (Math.floor(i / cols) - (rows - 1) / 2) * step;
      });
    } else if (name === "circle") {
      const radius = list.length === 1 ? 0 : step * list.length / (2 * Math.PI);
      list.forEach((id, i) => {
        const a = i / list.length * Math.PI * 2;
        nodes[id].x = cx + Math.cos(a) * radius;
        nodes[id].y = cy + Math.sin(a) * radius;
      });
    } else if (name === "concentric") {
      const sorted = list.slice().sort((p, q) => (nodes[q].e || 1) - (nodes[p].e || 1));
      let i = 0;
      let ring = 0;
      while (i < sorted.length) {
        const radius = ring * step;
        const capacity = ring === 0 ? 1 : Math.max(1, Math.floor(2 * Math.PI * radius / step));
        const members = sorted.slice(i, i + capacity);
        members.forEach((id, j) => {
          const a = j / members.length * Math.PI * 2;
          nodes[id].x = cx + Math.cos(a) * radius;
          nodes[id].y = cy + Math.sin(a) * radius;
        });
        i += capacity;
        ring++;
      }
    } else if (name === "lens") {
      viaLayout((subset) => lensLayout(subset, links, opts));
    } else if (name === "sequential") {
      viaLayout((subset) => layeredLayout(subset, links, { ...opts, directed: !opts.top && !opts.level }));
    } else if (name === "radial") {
      viaLayout((subset) => radialLayout(subset, links, opts));
    } else {
      throw new Error(`Unknown arrangement: ${name}`);
    }
  }

  // src/engine/events.js
  var LEGACY_NAMES = {
    click: "click",
    dblclick: "double-click",
    contextmenu: "context-menu",
    mousedown: "pointer-down",
    touchdown: "pointer-down",
    hover: "hover",
    mousewheel: "wheel",
    dragstart: "drag-start",
    dragend: "drag-end",
    dragcomplete: "drag-end",
    dragover: "drag-over",
    keydown: "key-down",
    selectionchange: "selection-change",
    viewchange: "view-change",
    prechange: "prechange",
    progress: "progress",
    map: "map",
    change: "change",
    play: "play",
    pause: "pause",
    start: "start",
    end: "end",
    overview: "overview"
  };
  function legacyArgs(props) {
    if (!props || typeof props !== "object") return [];
    if ("id" in props || "x" in props) return [props.id ?? null, props.x, props.y, props.button, props.subItem];
    if ("type" in props) return [props.type];
    return [];
  }
  function createEmitter() {
    const handlers = /* @__PURE__ */ new Map();
    const legacy = /* @__PURE__ */ new Map();
    function on(name, fn) {
      if (typeof fn !== "function") throw new TypeError(`on('${name}'): handler must be a function`);
      if (!handlers.has(name)) handlers.set(name, /* @__PURE__ */ new Set());
      handlers.get(name).add(fn);
    }
    function off(name, fn) {
      if (name === void 0) {
        handlers.clear();
        return;
      }
      if (fn === void 0) handlers.delete(name);
      else if (handlers.has(name)) handlers.get(name).delete(fn);
    }
    function bind(name, fn) {
      const modern = name === "all" ? "all" : LEGACY_NAMES[name] || name;
      const wrapper = name === "all" ? ({ name: n, event }) => fn(n, ...legacyArgs(event)) : (props) => fn(...legacyArgs(props));
      if (!legacy.has(name)) legacy.set(name, /* @__PURE__ */ new Map());
      if (legacy.get(name).has(fn)) return;
      legacy.get(name).set(fn, wrapper);
      on(modern, wrapper);
    }
    function unbind(name, fn) {
      if (name === void 0) {
        legacy.forEach((m, n) => unbind(n));
        return;
      }
      const modern = name === "all" ? "all" : LEGACY_NAMES[name] || name;
      const map = legacy.get(name);
      if (!map) return;
      const fns = fn === void 0 ? [...map.keys()] : [fn];
      fns.forEach((f) => {
        off(modern, map.get(f));
        map.delete(f);
      });
    }
    function emit(name, props) {
      let prevented = false;
      const event = props && typeof props === "object" ? { ...props, preventDefault: () => {
        prevented = true;
      } } : props;
      const call = (fn, arg) => {
        try {
          fn(arg);
        } catch (err) {
          setTimeout(() => {
            throw err;
          });
        }
      };
      (handlers.get(name) || []).forEach((fn) => call(fn, event));
      (handlers.get("all") || []).forEach((fn) => call(fn, { name, event }));
      return prevented;
    }
    const has = (name) => (handlers.get(name)?.size || 0) + (handlers.get("all")?.size || 0) > 0;
    return { on, off, bind, unbind, emit, has, clear: () => {
      handlers.clear();
      legacy.clear();
    } };
  }

  // src/engine/exporters.js
  var esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  var num = (v) => Math.round(v * 100) / 100;
  var IDENTITY = [1, 0, 0, 1, 0, 0];
  var multiply = (m, n) => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
  var apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  function arcToCubics(cx, cy, r, a0, a1) {
    const out = [];
    let sweep = a1 - a0;
    if (Math.abs(sweep) > Math.PI * 2) sweep = Math.sign(sweep) * Math.PI * 2;
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const step = sweep / n;
    const k = 4 / 3 * Math.tan(step / 4);
    let a = a0;
    for (let i = 0; i < n; i++) {
      const b = a + step;
      const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
      out.push([cx + r * (ca - k * sa), cy + r * (sa + k * ca), cx + r * (cb + k * sb), cy + r * (sb - k * cb), cx + r * cb, cy + r * sb]);
      a = b;
    }
    return { start: [cx + r * Math.cos(a0), cy + r * Math.sin(a0)], segments: out };
  }
  function createRecorder(measurer) {
    let path = [];
    let cur = [0, 0];
    let lineDash = [];
    const stack = [];
    const state = {
      fillStyle: "#000",
      strokeStyle: "#000",
      lineWidth: 1,
      globalAlpha: 1,
      lineDashOffset: 0,
      font: "10px sans-serif",
      textAlign: "start",
      textBaseline: "alphabetic",
      matrix: IDENTITY.slice()
    };
    const ctx = state;
    const pt = (x, y) => apply(state.matrix, x, y);
    Object.assign(ctx, {
      setTransform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
        state.matrix = typeof a === "object" ? [a.a, a.b, a.c, a.d, a.e, a.f] : [a, b, c, d, e, f];
      },
      translate(x, y) {
        state.matrix = multiply(state.matrix, [1, 0, 0, 1, x, y]);
      },
      rotate(t) {
        state.matrix = multiply(state.matrix, [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]);
      },
      scale(x, y) {
        state.matrix = multiply(state.matrix, [x, 0, 0, y, 0, 0]);
      },
      save() {
        stack.push({ ...state, matrix: state.matrix.slice(), lineDash: lineDash.slice() });
        ctx._onSave && ctx._onSave();
      },
      restore() {
        const s = stack.pop();
        if (!s) return;
        const { lineDash: ld, ...rest } = s;
        Object.assign(state, rest);
        lineDash = ld;
        ctx._onRestore && ctx._onRestore();
      },
      setLineDash(d) {
        lineDash = (d || []).slice();
      },
      getLineDash() {
        return lineDash.slice();
      },
      beginPath() {
        path = [];
      },
      moveTo(x, y) {
        cur = pt(x, y);
        path.push(["M", ...cur]);
      },
      lineTo(x, y) {
        cur = pt(x, y);
        path.push(["L", ...cur]);
      },
      quadraticCurveTo(cx, cy, x, y) {
        const [qx, qy] = pt(cx, cy);
        const [ex, ey] = pt(x, y);
        const [sx, sy] = cur;
        path.push(["C", sx + 2 / 3 * (qx - sx), sy + 2 / 3 * (qy - sy), ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey), ex, ey]);
        cur = [ex, ey];
      },
      bezierCurveTo(x1, y1, x2, y2, x, y) {
        const a = pt(x1, y1);
        const b = pt(x2, y2);
        const c = pt(x, y);
        path.push(["C", ...a, ...b, ...c]);
        cur = c;
      },
      closePath() {
        path.push(["Z"]);
      },
      rect(x, y, w, h) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
      },
      arc(x, y, r, a0, a1, ccw) {
        let end = a1;
        if (ccw && end > a0) end -= Math.PI * 2;
        if (!ccw && end < a0) end += Math.PI * 2;
        const { start, segments } = arcToCubics(x, y, r, a0, end);
        const s = pt(...start);
        path.push([path.length ? "L" : "M", ...s]);
        segments.forEach((seg) => {
          const a = pt(seg[0], seg[1]);
          const b = pt(seg[2], seg[3]);
          const c = pt(seg[4], seg[5]);
          path.push(["C", ...a, ...b, ...c]);
          cur = c;
        });
      },
      measureText(text) {
        measurer.font = state.font;
        return measurer.measureText(text);
      },
      createLinearGradient(x0, y0, x1, y1) {
        const [ax, ay] = pt(x0, y0);
        const [bx, by] = pt(x1, y1);
        const grad = { gradient: true, x0: ax, y0: ay, x1: bx, y1: by, stops: [], addColorStop(o, c) {
          grad.stops.push([o, c]);
        } };
        return grad;
      }
    });
    return { ctx, state, getPath: () => path, getDash: () => lineDash, pt };
  }
  function rgba(measurer, css) {
    measurer.fillStyle = "#000000";
    measurer.fillStyle = css;
    const v = measurer.fillStyle;
    if (v[0] === "#") return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
    const m = v.match(/[\d.]+/g).map(Number);
    return [m[0], m[1], m[2], m[3] ?? 1];
  }
  function imageDataUrl(img, type = "image/png") {
    try {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      return c.toDataURL(type, 0.92);
    } catch {
      return null;
    }
  }
  function createSvgContext(width, height, measurer) {
    const { ctx, state, getPath, getDash } = createRecorder(measurer);
    const parts = [];
    const defs = [];
    const warnings = [];
    let clipId = null;
    const clipStack = [];
    let idSeq = 0;
    const d = () => getPath().map(([op, ...v]) => op + v.map(num).join(" ")).join("");
    const paint = (style) => {
      if (style && style.gradient) {
        const id = `g${++idSeq}`;
        defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(style.x0)}" y1="${num(style.y0)}" x2="${num(style.x1)}" y2="${num(style.y1)}">${style.stops.map(([o, c]) => `<stop offset="${num(o)}" stop-color="${esc(c)}"/>`).join("")}</linearGradient>`);
        return `url(#${id})`;
      }
      return esc(style);
    };
    const common = () => `${state.globalAlpha < 1 ? ` opacity="${num(state.globalAlpha)}"` : ""}${clipId ? ` clip-path="url(#${clipId})"` : ""}`;
    ctx._onSave = () => clipStack.push(clipId);
    ctx._onRestore = () => {
      clipId = clipStack.pop() ?? null;
    };
    Object.assign(ctx, {
      clearRect() {
      },
      fillRect(x, y, w, h) {
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.fill();
      },
      strokeRect(x, y, w, h) {
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.stroke();
      },
      fill() {
        parts.push(`<path d="${d()}" fill="${paint(state.fillStyle)}"${common()}/>`);
      },
      stroke() {
        const dash = getDash().length ? ` stroke-dasharray="${getDash().map(num).join(" ")}"` : "";
        parts.push(`<path d="${d()}" fill="none" stroke="${paint(state.strokeStyle)}" stroke-width="${num(state.lineWidth)}"${dash}${common()}/>`);
      },
      clip() {
        const id = `c${++idSeq}`;
        defs.push(`<clipPath id="${id}"><path d="${d()}"/></clipPath>`);
        clipId = id;
      },
      fillText(text, x, y) {
        const anchor = { center: "middle", centre: "middle", right: "end", end: "end" }[state.textAlign] || "start";
        const baseline = { middle: "central", top: "hanging", bottom: "text-after-edge" }[state.textBaseline] || "auto";
        const m = state.matrix;
        const transform = m.every((v, i) => v === IDENTITY[i]) ? "" : ` transform="matrix(${m.map(num).join(" ")})"`;
        parts.push(`<text x="${num(x)}" y="${num(y)}" fill="${paint(state.fillStyle)}" style="font:${esc(state.font)}" text-anchor="${anchor}" dominant-baseline="${baseline}"${transform}${common()}>${esc(text)}</text>`);
      },
      drawImage(img, x, y, w, h) {
        const url = img && img.src && img.src.startsWith("data:") ? img.src : img && imageDataUrl(img);
        if (!url) {
          warnings.push({ type: "image", message: `Image could not be embedded (cross-origin): ${img && img.src}` });
          return;
        }
        const [ax, ay] = apply(state.matrix, x, y);
        parts.push(`<image href="${esc(url)}" x="${num(ax)}" y="${num(ay)}" width="${num(w * state.matrix[0])}" height="${num(h * state.matrix[3])}" preserveAspectRatio="none"${common()}/>`);
      },
      toSvg() {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${parts.join("")}</svg>`;
      },
      warnings
    });
    return ctx;
  }
  var latin1 = (str) => Uint8Array.from(str, (c) => c.charCodeAt(0) & 255);
  var pdfString = (text) => `(${String(text).replace(/[^\x20-\xff]/g, "?").replace(/([\\()])/g, "\\$1")})`;
  function createPdfContext(width, height, measurer) {
    const { ctx, state, getPath, getDash } = createRecorder(measurer);
    const ops = [];
    const alphas = /* @__PURE__ */ new Map();
    const images = [];
    const warnings = [];
    const f = (v) => num(v);
    ops.push(`1 0 0 -1 0 ${height} cm`);
    const pathOps = () => getPath().map(([op, ...v]) => {
      if (op === "M") return `${f(v[0])} ${f(v[1])} m`;
      if (op === "L") return `${f(v[0])} ${f(v[1])} l`;
      if (op === "C") return `${v.map(f).join(" ")} c`;
      return "h";
    }).join("\n");
    const alphaOp = (a) => {
      const key = Math.round(Math.min(1, Math.max(0, a)) * 1e3) / 1e3;
      if (!alphas.has(key)) alphas.set(key, `GS${alphas.size}`);
      return `/${alphas.get(key)} gs`;
    };
    const colourOp = (style, stroke) => {
      let css = style;
      if (style && style.gradient) css = (style.stops[Math.floor(style.stops.length / 2)] || style.stops[0] || [0, "#000"])[1];
      const [r, g, b, a] = rgba(measurer, css);
      return { op: `${f(r / 255)} ${f(g / 255)} ${f(b / 255)} ${stroke ? "RG" : "rg"}`, a };
    };
    ctx._onSave = () => ops.push("q");
    ctx._onRestore = () => ops.push("Q");
    Object.assign(ctx, {
      clearRect() {
      },
      fillRect(x, y, w, h) {
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.fill();
      },
      strokeRect(x, y, w, h) {
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.stroke();
      },
      fill() {
        if (!getPath().length) return;
        const { op, a } = colourOp(state.fillStyle, false);
        ops.push(`q ${alphaOp(a * state.globalAlpha)} ${op}
${pathOps()}
f Q`);
      },
      stroke() {
        if (!getPath().length) return;
        const { op, a } = colourOp(state.strokeStyle, true);
        const dash = getDash().length ? `[${getDash().map(f).join(" ")}] 0 d` : "[] 0 d";
        ops.push(`q ${alphaOp(a * state.globalAlpha)} ${op} ${f(state.lineWidth)} w ${dash} 1 J 1 j
${pathOps()}
S Q`);
      },
      clip() {
        ops.push(`${pathOps()}
W n`);
      },
      fillText(text, x, y) {
        const size = parseFloat((state.font.match(/([\d.]+)px/) || [0, 10])[1]);
        const bold = /\bbold\b/.test(state.font);
        measurer.font = state.font;
        const w = measurer.measureText(text).width;
        let dx = 0;
        if (state.textAlign === "center" || state.textAlign === "centre") dx = -w / 2;
        else if (state.textAlign === "right" || state.textAlign === "end") dx = -w;
        let dy = 0;
        if (state.textBaseline === "middle") dy = size * 0.35;
        else if (state.textBaseline === "top" || state.textBaseline === "hanging") dy = size * 0.8;
        else if (state.textBaseline === "bottom") dy = -size * 0.2;
        const [px, py] = apply(state.matrix, x + dx, y + dy);
        const m = state.matrix;
        const { op, a } = colourOp(state.fillStyle, false);
        ops.push(`q ${alphaOp(a * state.globalAlpha)} ${op} BT /${bold ? "F2" : "F1"} ${f(size)} Tf ${f(m[0])} ${f(m[1])} ${f(-m[2])} ${f(-m[3])} ${f(px)} ${f(py)} Tm ${pdfString(text)} Tj ET Q`);
      },
      drawImage(img, x, y, w, h) {
        const name = `Im${images.length}`;
        images.push({ name, img });
        const [ax, ay] = apply(state.matrix, x, y);
        const sw = w * state.matrix[0];
        const sh = h * state.matrix[3];
        ops.push(`q ${alphaOp(state.globalAlpha)} ${f(sw)} 0 0 ${f(-sh)} ${f(ax)} ${f(ay + sh)} cm /${name} Do Q`);
      },
      warnings,
      /** Assembles the PDF. Images are re-encoded as JPEG (DCTDecode). */
      async toPdf() {
        const enc = new TextEncoder();
        const imageObjs = [];
        for (const { name, img } of images) {
          const url = imageDataUrl(img, "image/jpeg");
          if (!url) {
            warnings.push({ type: "image", message: `Image could not be embedded (cross-origin): ${img && img.src}` });
            continue;
          }
          const bytes = Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));
          imageObjs.push({ name, bytes, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
        }
        const content = ops.filter((o) => !imageObjs.length || !/\/Im\d+ Do/.test(o) || imageObjs.some((io) => o.includes(`/${io.name} Do`))).join("\n");
        const objects = [];
        objects.push(enc.encode("<< /Type /Catalog /Pages 2 0 R >>"));
        objects.push(enc.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
        const gs = [...alphas].map(([a, n]) => `/${n} << /Type /ExtGState /ca ${a} /CA ${a} >>`).join(" ");
        const xobj = imageObjs.map((io, i) => `/${io.name} ${7 + i} 0 R`).join(" ");
        objects.push(enc.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /ExtGState << ${gs} >> /XObject << ${xobj} >> >> >>`));
        const contentBytes = latin1(content);
        objects.push({ head: enc.encode(`<< /Length ${contentBytes.length} >>
stream
`), body: contentBytes });
        objects.push(enc.encode("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
        objects.push(enc.encode("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"));
        imageObjs.forEach((io) => objects.push({
          head: enc.encode(`<< /Type /XObject /Subtype /Image /Width ${io.w} /Height ${io.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${io.bytes.length} >>
stream
`),
          body: io.bytes
        }));
        const chunks = [latin1("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
        let offset = chunks[0].length;
        const offsets = [];
        objects.forEach((obj, i) => {
          offsets.push(offset);
          const parts = obj.head ? [enc.encode(`${i + 1} 0 obj
`), obj.head, obj.body, enc.encode("\nendstream\nendobj\n")] : [enc.encode(`${i + 1} 0 obj
`), obj, enc.encode("\nendobj\n")];
          parts.forEach((p) => {
            chunks.push(p);
            offset += p.length;
          });
        });
        const xref = `xref
0 ${objects.length + 1}
0000000000 65535 f 
${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n 
`).join("")}`;
        chunks.push(enc.encode(`${xref}trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${offset}
%%EOF
`));
        const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
        let at = 0;
        chunks.forEach((c) => {
          out.set(c, at);
          at += c.length;
        });
        return out;
      }
    });
    return ctx;
  }

  // src/engine/combos.js
  var asList2 = (v) => Array.isArray(v) ? v : v == null ? [] : [v];
  var isComboNode = (node) => !!(node && node._combo);
  function ancestors(nodes, id) {
    const out = [];
    let node = nodes[id];
    while (node && node.parentId != null && isComboNode(nodes[node.parentId])) {
      out.push(node.parentId);
      node = nodes[node.parentId];
    }
    return out;
  }
  function isNodeVisible(nodes, id) {
    const node = nodes[id];
    if (!node || node.hi) return false;
    return ancestors(nodes, id).every((p) => nodes[p]._combo.open && !nodes[p].hi);
  }
  function visibleEnd(nodes, id) {
    const chain = ancestors(nodes, id);
    for (let i = chain.length - 1; i >= 0; i--) {
      if (!nodes[chain[i]]._combo.open) return chain[i];
    }
    return id;
  }
  function descendants(nodes, comboId) {
    const out = [];
    Object.values(nodes).forEach((node) => {
      if (node.parentId === comboId) {
        out.push(node.id);
        if (isComboNode(node)) out.push(...descendants(nodes, node.id));
      }
    });
    return out;
  }
  function openRadius(nodes, combo) {
    let r = DEFAULT_NODE_RADIUS * (combo.e || 1);
    Object.values(combo._combo.offsets).forEach((o) => {
      const child = nodes[o.id];
      if (!child || child.hi) return;
      const cr = isComboNode(child) && child._combo.open ? openRadius(nodes, child) : DEFAULT_NODE_RADIUS * (child.e || 1);
      r = Math.max(r, Math.hypot(o.dx, o.dy, o.dz || 0) + cr + DEFAULT_NODE_RADIUS * 0.5);
    });
    return r;
  }
  function comboOffset(combo, child) {
    const o = { id: child.id, dx: (child.x || 0) - combo.x, dy: (child.y || 0) - combo.y };
    if (Number.isFinite(child.z) || Number.isFinite(combo.z)) o.dz = (child.z || 0) - (combo.z || 0);
    return o;
  }
  function syncChildren(nodes, comboId) {
    const combo = nodes[comboId];
    if (!isComboNode(combo)) return;
    Object.values(combo._combo.offsets).forEach((o) => {
      const child = nodes[o.id];
      if (!child) return;
      child.x = combo.x + o.dx;
      child.y = combo.y + o.dy;
      if (o.dz !== void 0 || Number.isFinite(combo.z)) child.z = (combo.z || 0) + (o.dz || 0);
      if (isComboNode(child)) syncChildren(nodes, child.id);
    });
  }
  function createComboApi(host) {
    let counter = 0;
    let revealed = [];
    function addChild(combo, child) {
      child.parentId = combo.id;
      combo._combo.offsets[child.id] = comboOffset(combo, child);
    }
    function removeChild(combo, child) {
      delete combo._combo.offsets[child.id];
      const parent = host.nodes()[combo.parentId];
      if (parent && isComboNode(parent)) addChild(parent, child);
      else delete child.parentId;
    }
    const api = {
      combine(definitions, options = {}) {
        const nodes = host.nodes();
        const created = asList2(definitions).map((def) => {
          const ids = asList2(def.ids).filter((id2) => nodes[id2]);
          if (ids.length === 0) return null;
          let id;
          do {
            id = `_combo_${++counter}`;
          } while (nodes[id]);
          const first = nodes[ids[0]];
          const avg = ids.reduce((acc, i) => ({ x: acc.x + (nodes[i].x || 0) / ids.length, y: acc.y + (nodes[i].y || 0) / ids.length }), { x: 0, y: 0 });
          const at = def.position === "first" ? { x: first.x || 0, y: first.y || 0 } : avg;
          const deep = ids.filter((i) => Number.isFinite(nodes[i].z));
          if (deep.length) at.z = def.position === "first" ? first.z || 0 : deep.reduce((sum, i) => sum + nodes[i].z, 0) / ids.length;
          const commonParent = ids.every((i) => nodes[i].parentId === first.parentId) ? first.parentId : void 0;
          const combo = {
            type: "node",
            id,
            x: at.x + (def.dx || 0),
            y: at.y + (def.dy || 0),
            ...at.z !== void 0 ? { z: at.z } : {},
            c: "#cfd8dc",
            b: "#90a4ae",
            e: Math.min(4, 1 + Math.sqrt(ids.length) * 0.35),
            t: def.label ?? "",
            d: def.d,
            ...def.style || {},
            // `glyph` replaces the counter glyph (null removes it); undefined keeps the default.
            _combo: { open: !!def.open, offsets: {}, openStyle: def.openStyle || {}, glyph: "glyph" in def ? def.glyph : void 0 }
          };
          nodes[id] = combo;
          if (commonParent != null && nodes[commonParent]) addChild(nodes[commonParent], combo);
          ids.forEach((childId) => {
            const child = nodes[childId];
            const oldParent = nodes[child.parentId];
            if (oldParent && isComboNode(oldParent)) delete oldParent._combo.offsets[childId];
            addChild(combo, child);
          });
          if (options.arrange !== "none") {
            const arrange = typeof options.arrange === "object" ? options.arrange : { name: options.arrange };
            arrangeChildren(combo, arrange.name, arrange);
          }
          return id;
        }).filter(Boolean);
        if (options.select) host.select(created);
        host.changed();
        return Promise.resolve(created);
      },
      uncombine(ids, options = {}) {
        const nodes = host.nodes();
        const run = (id) => {
          const combo = nodes[id];
          if (!isComboNode(combo)) return [];
          syncChildren(nodes, id);
          const children = Object.keys(combo._combo.offsets).map((c) => nodes[c]).filter(Boolean);
          children.forEach((child) => removeChild(combo, child));
          const parent = nodes[combo.parentId];
          if (parent && isComboNode(parent)) delete parent._combo.offsets[id];
          Object.values(host.links()).forEach((l) => {
            if (l.id1 === id || l.id2 === id) delete host.links()[l.id];
          });
          delete nodes[id];
          const freed2 = children.map((c) => c.id);
          if (options.full) children.filter(isComboNode).forEach((c) => freed2.push(...run(c.id)));
          return freed2;
        };
        const freed = asList2(ids).flatMap(run);
        if (options.select) host.select(freed.filter((id) => nodes[id]));
        host.changed();
        return Promise.resolve();
      },
      open(ids) {
        return setOpen(ids, true);
      },
      close(ids) {
        return setOpen(ids, false);
      },
      isOpen(id) {
        const node = host.nodes()[id];
        return isComboNode(node) && node._combo.open;
      },
      isCombo(ids, options = {}) {
        if (options.type === "link") return false;
        return asList2(ids).some((id) => isComboNode(host.nodes()[id]));
      },
      find(ids, options = {}) {
        const nodes = host.nodes();
        const one = (id) => {
          const chain = ancestors(nodes, id);
          if (chain.length === 0) return null;
          return options.parent === "first" ? chain[0] : chain[chain.length - 1];
        };
        return Array.isArray(ids) ? ids.map(one) : one(ids);
      },
      info(id) {
        const nodes = host.nodes();
        if (!isComboNode(nodes[id])) return null;
        const inside = new Set(descendants(nodes, id));
        return {
          nodes: [...inside].filter((c) => nodes[c].parentId === id).map((c) => nodes[c]),
          links: Object.values(host.links()).filter((l) => inside.has(l.id1) && inside.has(l.id2))
        };
      },
      reveal(ids) {
        if (ids !== void 0) {
          revealed = asList2(ids).filter((id) => host.links()[id]);
          host.render();
        }
        return revealed.slice();
      },
      transfer(ids, comboId, options = {}) {
        const nodes = host.nodes();
        const target = comboId == null ? null : nodes[comboId];
        if (comboId != null && !isComboNode(target)) return Promise.reject(new Error(`transfer: ${comboId} is not a combo`));
        asList2(ids).forEach((id) => {
          const node = nodes[id];
          if (!node || id === comboId || target && ancestors(nodes, comboId).includes(id)) return;
          const old = nodes[node.parentId];
          if (old && isComboNode(old)) {
            syncChildren(nodes, old.id);
            delete old._combo.offsets[id];
          }
          delete node.parentId;
          if (target) {
            if (!target._combo.open) {
              node.x = target.x;
              node.y = target.y;
            }
            addChild(target, node);
          }
        });
        if (target && options.arrange !== "none") {
          const arrange = typeof options.arrange === "object" ? options.arrange : { name: options.arrange };
          arrangeChildren(target, arrange.name, arrange);
        }
        host.changed();
        return Promise.resolve();
      },
      arrange(ids, options = {}) {
        asList2(ids).forEach((id) => {
          const combo = host.nodes()[id];
          if (isComboNode(combo)) arrangeChildren(combo, options.name, options);
        });
        host.render();
        return Promise.resolve();
      }
    };
    function arrangeChildren(combo, name, opts = {}) {
      const nodes = host.nodes();
      const ids = Object.keys(combo._combo.offsets);
      const arrangement = name || (host.comboShape && host.comboShape() === "rectangle" ? "grid" : "lens");
      if (arrangement === "none" || ids.length === 0) return;
      syncChildren(nodes, combo.id);
      arrangeNodes(arrangement, nodes, host.links(), ids, { ...opts, position: "absolute", x: combo.x, y: combo.y, tightness: opts.tightness ?? 8 });
      ids.forEach((id) => {
        const o = combo._combo.offsets[id];
        o.dx = nodes[id].x - combo.x;
        o.dy = nodes[id].y - combo.y;
        if (o.dz !== void 0) {
          o.dz = 0;
          nodes[id].z = combo.z || 0;
        }
      });
    }
    function setOpen(ids, open) {
      const nodes = host.nodes();
      asList2(ids).forEach((id) => {
        const combo = nodes[id];
        if (!isComboNode(combo)) return;
        combo._combo.open = open;
        syncChildren(nodes, id);
      });
      host.changed();
      return Promise.resolve();
    }
    return { api, revealed: () => revealed };
  }

  // src/engine/map.js
  var import_meta = {};
  function assetsBase(host) {
    const configured = host.assets && host.assets();
    if (configured) return configured.replace(/\/?$/, "/");
    try {
      return new URL("../../assets/", import_meta.url).href;
    } catch {
      return null;
    }
  }
  var bundledLeaflet = null;
  function loadBundledLeaflet(host) {
    if (bundledLeaflet) return bundledLeaflet;
    const base2 = assetsBase(host);
    if (!base2) return Promise.reject(new Error("map().show(): set GraphNexus.paths({ assets }) so the bundled Leaflet can be found, or supply Leaflet yourself"));
    const dir = `${base2}vendor/leaflet/`;
    if (!document.querySelector("link[data-graph-nexus-leaflet]")) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = `${dir}leaflet.css`;
      css.dataset.graphNexusLeaflet = "";
      document.head.appendChild(css);
    }
    const viaScript = () => new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = `${dir}leaflet.js`;
      tag.onload = () => window.L ? resolve(window.L) : reject(new Error("Leaflet script loaded without defining L"));
      tag.onerror = () => reject(new Error(`Could not load ${tag.src}`));
      document.head.appendChild(tag);
    });
    bundledLeaflet = import(
      /* webpackIgnore: true */
      `${dir}leaflet-src.esm.js`
    ).then((mod) => mod.default || mod, viaScript);
    bundledLeaflet.catch(() => {
      bundledLeaflet = null;
    });
    return bundledLeaflet;
  }
  var DEFAULT_TILES = {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors"
  };
  function createMapMode(host) {
    let settings = { animate: true, padding: 20, tiles: DEFAULT_TILES, time: 800, transition: "restore" };
    let leafletMap = null;
    let mapDiv = null;
    let shown = false;
    let savedView = null;
    const L = () => settings.leaflet || (typeof window !== "undefined" ? window.L : void 0);
    function located() {
      return Object.values(host.nodes()).filter((n) => n.pos && Number.isFinite(n.pos.lat) && Number.isFinite(n.pos.lng));
    }
    const api = {
      isShown: () => shown,
      leafletMap: () => leafletMap,
      options(next) {
        if (next === void 0) return { ...settings };
        settings = { ...settings, ...next };
        if (shown && "tiles" in next) {
          api.hide();
          return api.show();
        }
        return Promise.resolve();
      },
      show() {
        if (shown) return Promise.resolve();
        const supplied = L();
        return (supplied ? Promise.resolve(supplied) : loadBundledLeaflet(host)).then((leaflet) => {
          if (shown || host.isDestroyed && host.isDestroyed()) return;
          savedView = host.saveView ? host.saveView() : null;
          host.emit("map", { type: "showstart" });
          if (getComputedStyle(host.container).position === "static") host.container.style.position = "relative";
          mapDiv = document.createElement("div");
          Object.assign(mapDiv.style, { position: "absolute", inset: "0", zIndex: "0" });
          host.container.insertBefore(mapDiv, host.canvas);
          Object.assign(host.canvas.style, { position: "relative", zIndex: "1" });
          leafletMap = leaflet.map(mapDiv, { zoomControl: false, attributionControl: !!settings.tiles, maxZoom: 19 });
          if (settings.tiles) {
            const tiles = typeof settings.tiles === "string" ? { url: settings.tiles } : settings.tiles;
            leaflet.tileLayer(tiles.url, tiles).addTo(leafletMap);
          }
          const pts = located().map((n) => [n.pos.lat, n.pos.lng]);
          if (pts.length) leafletMap.fitBounds(pts, { padding: [settings.padding, settings.padding], animate: false, maxZoom: 16 });
          else leafletMap.setView([0, 0], 2);
          leafletMap.on("move zoom", host.render);
          shown = true;
          host.render();
          host.emit("map", { type: "showend" });
        });
      },
      hide() {
        if (!shown) return Promise.resolve();
        host.emit("map", { type: "hidestart" });
        leafletMap.remove();
        mapDiv.remove();
        leafletMap = null;
        mapDiv = null;
        shown = false;
        const transition = { animate: settings.animate !== false, time: settings.time };
        if (settings.transition === "layout" || !savedView || !host.restoreView) host.fit(transition);
        else host.restoreView(savedView, transition);
        savedView = null;
        host.emit("map", { type: "hideend" });
        return Promise.resolve();
      },
      /** View (container pixel) coordinates -> { lat, lng }. */
      mapCoordinates(x, y) {
        if (!shown) return null;
        const ll = leafletMap.containerPointToLatLng([x, y]);
        return { lat: ll.lat, lng: ll.lng };
      },
      /** { lat, lng } -> view coordinates. */
      viewCoordinates(lat, lng) {
        if (!shown) return null;
        const p = leafletMap.latLngToContainerPoint([lat, lng]);
        return { x: p.x, y: p.y };
      }
    };
    return {
      api,
      isShown: () => shown,
      /** Screen position of a node, or null when it has no `pos`. */
      project(node) {
        if (!node.pos) return null;
        return api.viewCoordinates(node.pos.lat, node.pos.lng);
      },
      moveNodeTo(node, x, y) {
        node.pos = api.mapCoordinates(x, y);
      },
      panBy(dx, dy) {
        leafletMap.panBy([-dx, -dy], { animate: false });
      },
      /** Wheel zoom: fractional, proportional to the wheel delta, so trackpads stay smooth. */
      zoomAt(x, y, delta) {
        if (!delta) return;
        const step = Math.max(-1, Math.min(1, -delta / 200));
        leafletMap.setZoomAround([x, y], leafletMap.getZoom() + step, { animate: false });
      },
      zoomBy(step) {
        leafletMap.setZoom(leafletMap.getZoom() + step);
      },
      fit() {
        const pts = located().map((n) => [n.pos.lat, n.pos.lng]);
        if (pts.length) leafletMap.fitBounds(pts, { padding: [settings.padding, settings.padding], maxZoom: 16, animate: settings.animate !== false, duration: (settings.time ?? 800) / 1e3 });
      }
    };
  }

  // src/engine/decorations.js
  var COMPASS = { n: [0, -1], ne: [0.7071, -0.7071], e: [1, 0], se: [0.7071, 0.7071], s: [0, 1], sw: [-0.7071, 0.7071], w: [-1, 0], nw: [-0.7071, -0.7071] };
  var DONUT_COLOURS = ["#e53935", "#1e88e5", "#43a047", "#fdd835", "#8e24aa", "#fb8c00", "#00acc1", "#6d4c41"];
  var asList3 = (v) => Array.isArray(v) ? v : v == null ? [] : [v];
  function boxSpacing(value, fallback = 0) {
    if (value == null) return { top: fallback, right: fallback, bottom: fallback, left: fallback };
    if (typeof value === "number") return { top: value, right: value, bottom: value, left: value };
    const list = typeof value === "string" ? value.trim().split(/\s+/).map(Number) : Array.isArray(value) ? value : null;
    if (list) {
      const [a, b = a, c = a, d = b] = list.map((v) => v ?? 0);
      return { top: a, right: b, bottom: c, left: d };
    }
    return { top: value.top ?? fallback, right: value.right ?? fallback, bottom: value.bottom ?? fallback, left: value.left ?? fallback };
  }
  function cornerRadii(value) {
    if (value == null) return [0, 0, 0, 0];
    if (typeof value === "number") return [value, value, value, value];
    const list = typeof value === "string" ? value.trim().split(/\s+/).map(Number) : Array.isArray(value) ? value : null;
    if (list) {
      const [a, b = a, c = a, d = b] = list.map((v) => v ?? 0);
      return [a, b, c, d];
    }
    return [value.topLeft || 0, value.topRight || 0, value.bottomRight || 0, value.bottomLeft || 0];
  }
  function roundRectPath(g, x, y, w, h, radii = [0, 0, 0, 0]) {
    const max = Math.min(w, h) / 2;
    const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, max)));
    const k = 0.5523;
    g.moveTo(x + tl, y);
    g.lineTo(x + w - tr, y);
    if (tr) g.bezierCurveTo(x + w - tr + tr * k, y, x + w, y + tr - tr * k, x + w, y + tr);
    g.lineTo(x + w, y + h - br);
    if (br) g.bezierCurveTo(x + w, y + h - br + br * k, x + w - br + br * k, y + h, x + w - br, y + h);
    g.lineTo(x + bl, y + h);
    if (bl) g.bezierCurveTo(x + bl - bl * k, y + h, x, y + h - bl + bl * k, x, y + h - bl);
    g.lineTo(x, y + tl);
    if (tl) g.bezierCurveTo(x, y + tl - tl * k, x + tl - tl * k, y, x + tl, y);
    g.closePath();
  }
  function truncate(text, opts) {
    const max = opts && opts.maxLength;
    if (!max || typeof text !== "string" || text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 3))}...`;
  }
  var font = (px, family, bold) => `${bold ? "bold " : ""}${px}px ${family || "sans-serif"}`;
  function drawDonut(g, donut, p, r, scale) {
    const values = asList3(donut.v).filter((v) => v > 0);
    const total = values.reduce((s, v) => s + v, 0);
    if (!total) return 0;
    const width = (donut.w ?? 10) * scale;
    const gap = (donut.bw ?? 2) * scale;
    const ringR = r + gap + width / 2;
    let a = -Math.PI / 2;
    values.forEach((v, i) => {
      const span = v / total * Math.PI * 2;
      g.beginPath();
      g.arc(p.x, p.y, ringR, a, a + span);
      g.strokeStyle = donut.c && donut.c[i] || DONUT_COLOURS[i % DONUT_COLOURS.length];
      g.lineWidth = width;
      g.stroke();
      a += span;
    });
    if (gap > 0) {
      g.strokeStyle = donut.b || "#ffffff";
      g.lineWidth = gap;
      g.beginPath();
      g.arc(p.x, p.y, r + gap / 2, 0, Math.PI * 2);
      g.stroke();
      if (values.length > 1) {
        let s = -Math.PI / 2;
        values.forEach((v) => {
          g.beginPath();
          g.moveTo(p.x + Math.cos(s) * r, p.y + Math.sin(s) * r);
          g.lineTo(p.x + Math.cos(s) * (r + gap + width), p.y + Math.sin(s) * (r + gap + width));
          g.stroke();
          s += v / total * Math.PI * 2;
        });
      }
    }
    return gap + width;
  }
  function glyphPosition(glyph, i, p, r, scale) {
    if (typeof glyph.p === "number") {
      const a = (glyph.p - 90) * Math.PI / 180;
      const dist = glyph.r != null ? glyph.r * scale : r;
      return { x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist };
    }
    const dir = COMPASS[glyph.p] || [COMPASS.ne, COMPASS.se, COMPASS.sw, COMPASS.nw][i % 4];
    return { x: p.x + dir[0] * r, y: p.y + dir[1] * r };
  }
  function drawGlyph(g, glyph, x, y, gr, env) {
    if (!glyph) return;
    let radius = gr;
    if (glyph.a) {
      radius *= 1 + 0.15 * Math.sin((env.now || 0) / 180);
      if (env.onAnimated) env.onAnimated();
    }
    const text = glyph.t != null ? String(glyph.t).slice(0, glyph.w ? 25 : 4) : "";
    const fb = glyph.fb !== false;
    const fontPx = radius * (text.length > 2 && !glyph.w ? 0.9 : 1.2);
    const family = glyph.ff || env.fontFamily;
    const img = glyph.u ? env.imageFor(glyph.u) : null;
    const iconOnly = !glyph.c && (glyph.u || glyph.fi);
    let half = radius;
    if (glyph.w && text) {
      g.font = font(fontPx, family, fb);
      half = Math.max(radius, g.measureText(text).width / 2 + radius * 0.6);
    }
    if (!iconOnly) {
      g.beginPath();
      if (half > radius) roundRectPath(g, x - half, y - radius, half * 2, radius * 2, [radius, radius, radius, radius]);
      else g.arc(x, y, radius, 0, Math.PI * 2);
      g.fillStyle = glyph.c || "#e53935";
      g.fill();
      if (glyph.b) {
        g.strokeStyle = glyph.b;
        g.lineWidth = Math.max(1, radius * 0.15);
        g.stroke();
      }
    }
    const inner = iconOnly ? radius : radius * 0.7;
    if (img && typeof g.drawImage === "function") {
      g.drawImage(img, x - inner, y - inner, inner * 2, inner * 2);
    } else if (glyph.fi && glyph.fi.t != null) {
      const ch = typeof glyph.fi.t === "number" ? String.fromCodePoint(glyph.fi.t) : String(glyph.fi.t);
      g.fillStyle = glyph.fi.c || (iconOnly ? "#000" : "#fff");
      g.font = `${inner * 1.6}px ${glyph.fi.ff || env.iconFontFamily || "sans-serif"}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(ch, x, y);
    } else if (text) {
      g.fillStyle = glyph.fc || "#ffffff";
      g.font = font(fontPx, family, fb);
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, x, y);
    }
  }
  function drawBubble(g, bubble, ax, ay, scale, env) {
    if (!bubble || bubble.t == null) return;
    const fs = (bubble.fs || 14) * scale;
    if (fs < 2) return;
    const text = String(bubble.t);
    g.font = font(fs, bubble.ff || env.fontFamily, bubble.fb);
    const pad = fs * 0.5;
    const glyphW = bubble.g ? fs * 1.2 : 0;
    const w = g.measureText(text).width + pad * 2 + glyphW;
    const h = fs * 1.6;
    const dir = bubble.p || "ne";
    const right = dir === "ne" || dir === "se";
    const up = dir === "ne" || dir === "nw";
    const tail = fs * 0.8;
    const bx = right ? ax + tail * 0.3 : ax - tail * 0.3 - w;
    const by = up ? ay - tail - h : ay + tail;
    g.beginPath();
    roundRectPath(g, bx, by, w, h, [h / 3, h / 3, h / 3, h / 3]);
    g.fillStyle = bubble.c || "#ffffff";
    g.fill();
    g.strokeStyle = bubble.b || "#9e9e9e";
    g.lineWidth = Math.max(1, scale);
    g.stroke();
    const tx = right ? bx + h / 3 : bx + w - h / 3;
    const ty = up ? by + h : by;
    g.beginPath();
    g.moveTo(tx - tail * 0.3, ty);
    g.lineTo(ax, ay);
    g.lineTo(tx + tail * 0.3, ty);
    g.fillStyle = bubble.c || "#ffffff";
    g.fill();
    g.stroke();
    if (bubble.g) drawGlyph(g, bubble.g, bx + pad + glyphW / 2 - fs * 0.1, by + h / 2, fs * 0.5, env);
    g.fillStyle = bubble.fc || "#000000";
    g.font = font(fs, bubble.ff || env.fontFamily, bubble.fb);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(text, bx + pad + glyphW, by + h / 2);
  }
  function labelLines(g, text, maxWidth, wrap) {
    const hard = String(text).split(/\r\n|\r|\n/);
    if (wrap !== "normal" || !maxWidth) return hard;
    const out = [];
    hard.forEach((line) => {
      let cur = "";
      line.split(" ").forEach((word) => {
        const next = cur ? `${cur} ${word}` : word;
        if (cur && g.measureText(next).width > maxWidth) {
          out.push(cur);
          cur = word;
        } else cur = next;
      });
      out.push(cur);
    });
    return out;
  }
  function measureLabel(g, label, node, scale, env, nodeW, nodeH) {
    const fsWorld = label.fs === "auto" ? null : label.fs ?? node.fs ?? 14;
    const family = label.ff || node.ff || env.fontFamily;
    const bold = label.fb ?? node.fb;
    const pad = boxSpacing(label.padding, label.fi || label.t ? 4 : 0);
    const margin = boxSpacing(label.margin, 0);
    const maxW = label.maxWidth != null ? label.maxWidth : null;
    let fs;
    let lines;
    if (label.fi) {
      fs = (fsWorld ?? Math.min(nodeW, nodeH) * 0.5) * scale;
      lines = [typeof label.fi.t === "number" ? String.fromCodePoint(label.fi.t) : String(label.fi.t)];
    } else {
      const text = env.truncate(String(label.t ?? ""));
      if (fsWorld == null) {
        const boxW = (maxW ?? nodeW * 0.8) * scale;
        const boxH = (label.maxHeight ?? nodeH * 0.6) * scale;
        g.font = font(100, family, bold);
        const widest = Math.max(...text.split(/\n/).map((l) => g.measureText(l).width / 100), 0.01);
        const count = text.split(/\n/).length;
        fs = Math.max(1, Math.min(boxW / widest, boxH / (count * 1.2)));
      } else fs = fsWorld * scale;
      g.font = font(fs, family, bold);
      lines = labelLines(g, text, maxW != null ? maxW * scale : label.minWidth && label.minWidth !== "stretch" ? label.minWidth * scale : null, label.textWrap);
    }
    if (!label.fi) g.font = font(fs, family, bold);
    else g.font = `${fs}px ${label.fi.ff || env.iconFontFamily || "sans-serif"}`;
    const textW = Math.max(...lines.map((l) => g.measureText(l).width), 0);
    const textH = lines.length * fs * 1.2;
    let w = textW + (pad.left + pad.right) * scale;
    let h = textH + (pad.top + pad.bottom) * scale;
    if (label.minWidth === "stretch") w = Math.max(w, nodeW * scale);
    else if (label.minWidth) w = Math.max(w, label.minWidth * scale);
    if (label.minHeight === "stretch") h = Math.max(h, nodeH * scale);
    else if (label.minHeight) h = Math.max(h, label.minHeight * scale);
    if (maxW != null) w = Math.min(w, maxW * scale);
    if (label.maxHeight != null) h = Math.min(h, label.maxHeight * scale);
    const draw = (x, y) => {
      const fbc = label.fbc ?? node.fbc;
      const bw = label.b ? (label.bw ?? 4) * scale : 0;
      if (fbc || label.b) {
        g.beginPath();
        roundRectPath(g, x, y, w, h, cornerRadii(label.borderRadius).map((r) => r * scale));
        if (fbc) {
          g.fillStyle = fbc;
          g.fill();
        }
        if (label.b) {
          g.strokeStyle = label.b;
          g.lineWidth = bw;
          g.stroke();
        }
      }
      const align = label.textAlignment && label.textAlignment.horizontal || "centre";
      const valign = label.textAlignment && label.textAlignment.vertical || "middle";
      const innerX = x + pad.left * scale;
      const innerW = w - (pad.left + pad.right) * scale;
      const innerY = y + pad.top * scale;
      const innerH = h - (pad.top + pad.bottom) * scale;
      let ty = valign === "top" ? innerY : valign === "bottom" ? innerY + innerH - textH : innerY + (innerH - textH) / 2;
      ty += (env.labelOffset || 0) * scale;
      g.fillStyle = label.fi ? label.fi.c || label.fc || node.fc || "#000" : label.fc || node.fc || "#000";
      g.textBaseline = "middle";
      g.textAlign = align === "left" ? "left" : align === "right" ? "right" : "center";
      const tx = align === "left" ? innerX : align === "right" ? innerX + innerW : innerX + innerW / 2;
      if (label.fi) g.font = `${fs}px ${label.fi.ff || env.iconFontFamily || "sans-serif"}`;
      else g.font = font(fs, family, bold);
      lines.forEach((line, i) => g.fillText(line, tx, ty + (i + 0.5) * fs * 1.2));
    };
    return { w, h, margin, draw, fs };
  }
  function labelsSize(g, node, env) {
    const labels = asList3(node.t).map((l) => typeof l === "string" ? { t: l } : l).filter((l) => l && typeof l.position !== "string");
    let w = 0;
    let h = 0;
    labels.forEach((l) => {
      const m = measureLabel(g, { ...l, fs: l.fs === "auto" ? 14 : l.fs }, node, 1, env, 56, 56);
      w = Math.max(w, m.w + m.margin.left + m.margin.right);
      h += m.h + m.margin.top + m.margin.bottom;
    });
    return { w: Math.max(node.minWidth ?? 56, w + 8), h: Math.max(node.minHeight ?? 56, h + 8) };
  }
  function drawLabelObjects(g, node, p, half, scale, env) {
    const labels = asList3(node.t).filter((l) => l && typeof l === "object");
    const nodeW = half.w * 2 / scale;
    const nodeH = half.h * 2 / scale;
    const measured = labels.map((l) => ({ label: l, m: measureLabel(g, l, node, scale, env, nodeW, nodeH) }));
    const inside = measured.filter(({ label }) => typeof label.position !== "string");
    const outside = measured.filter(({ label }) => typeof label.position === "string");
    const stack = inside.filter(({ label }) => !(label.position && (typeof label.position.horizontal === "number" || typeof label.position.vertical === "number")));
    const total = stack.reduce((s, { m }) => s + m.h + (m.margin.top + m.margin.bottom) * scale, 0);
    let cursor = p.y - total / 2;
    stack.forEach(({ label, m }) => {
      if (m.fs < env.minLabelPx) {
        cursor += m.h + (m.margin.top + m.margin.bottom) * scale;
        return;
      }
      cursor += m.margin.top * scale;
      const hpos = label.position && label.position.horizontal;
      const vpos = label.position && label.position.vertical;
      let x = p.x - m.w / 2;
      if (hpos === "left") x = p.x - half.w + m.margin.left * scale;
      else if (hpos === "right") x = p.x + half.w - m.w - m.margin.right * scale;
      let y = cursor;
      if (vpos === "top" && stack.length === 1) y = p.y - half.h + m.margin.top * scale;
      else if (vpos === "bottom" && stack.length === 1) y = p.y + half.h - m.h - m.margin.bottom * scale;
      m.draw(x, y);
      cursor += m.h + m.margin.bottom * scale;
    });
    inside.filter((x) => !stack.includes(x)).forEach(({ label, m }) => {
      const pos = label.position;
      const x = typeof pos.horizontal === "number" ? p.x - half.w + pos.horizontal * scale : p.x - m.w / 2;
      const y = typeof pos.vertical === "number" ? p.y - half.h + pos.vertical * scale : p.y - m.h / 2;
      if (m.fs >= env.minLabelPx) m.draw(x, y);
    });
    const offsets = {};
    outside.forEach(({ label, m }) => {
      if (m.fs < env.minLabelPx) return;
      const dir = COMPASS[label.position] || COMPASS.s;
      const key = label.position;
      const extra = offsets[key] || 0;
      const gapX = dir[0] * (m.margin.left + m.margin.right) * scale;
      const gapY = dir[1] * (m.margin.top + m.margin.bottom) * scale;
      let x = p.x + dir[0] * half.w + gapX - m.w / 2 + dir[0] * m.w / 2;
      let y = p.y + dir[1] * half.h + gapY - m.h / 2 + dir[1] * m.h / 2;
      if (dir[0] === 0) y += dir[1] * extra;
      else x += dir[0] * extra;
      m.draw(x, y);
      offsets[key] = extra + (dir[0] === 0 ? m.h : m.w);
    });
    return true;
  }
  function drawTextBox(g, text, x, y, style, scale, env, angle = 0) {
    const str = env.truncate(String(text));
    const fs = (style.fs || 14) * scale;
    if (!str || fs < env.minLabelPx) return;
    g.font = font(fs, style.ff || env.fontFamily, style.fb);
    const lines = str.split(/\r\n|\r|\n/);
    const w = Math.max(...lines.map((l) => g.measureText(l).width));
    const h = lines.length * fs * 1.2;
    const rotate = angle && typeof g.rotate === "function";
    if (rotate) {
      g.save();
      g.translate(x, y);
      g.rotate(angle);
      x = 0;
      y = 0;
    }
    g.fillStyle = style.fbc || "rgba(255,255,255,0.85)";
    g.fillRect(x - w / 2 - 2, y - h / 2, w + 4, h);
    g.fillStyle = style.fc || "#333";
    g.textAlign = "center";
    g.textBaseline = "middle";
    lines.forEach((line, i) => g.fillText(line, x, y - h / 2 + (i + 0.5) * fs * 1.2));
    if (rotate) g.restore();
  }
  function drawBackground(g, size, options) {
    const stops = options.gradient && asList3(options.gradient.stops);
    if (stops && stops.length) {
      const grad = typeof g.createLinearGradient === "function" ? g.createLinearGradient(0, 0, 0, size.h) : null;
      if (grad) {
        stops.forEach((s) => grad.addColorStop(Math.min(1, Math.max(0, s.r)), s.c));
        g.fillStyle = grad;
      } else g.fillStyle = stops[0].c;
    } else g.fillStyle = options.backColour || options.backgroundColour || "#ffffff";
    g.fillRect(0, 0, size.w, size.h);
  }
  function drawBands(g, size, options, worldToScreenX, scale, env) {
    const config = options.bands;
    if (!config || !config.bands) return;
    config.bands.forEach((band, i) => {
      const w = (band.w ?? 100) * scale;
      const x = worldToScreenX(band.x ?? 0) - w / 2;
      g.fillStyle = band.c || (i % 2 ? "#f0f0f0" : "#e6e6e6");
      g.fillRect(x, 0, w, size.h);
      if (!band.t) return;
      let fs = band.fs ?? 20;
      g.font = font(fs, band.ff || env.fontFamily, band.fb);
      const tw = g.measureText(band.t).width;
      if (tw > w * 0.9) {
        fs *= w * 0.9 / tw;
        g.font = font(fs, band.ff || env.fontFamily, band.fb);
      }
      g.fillStyle = band.fc || "#bdbdbd";
      g.textAlign = "center";
      g.textBaseline = "middle";
      if (config.top !== false) g.fillText(band.t, x + w / 2, fs);
      if (config.bottom) g.fillText(band.t, x + w / 2, size.h - fs);
    });
  }
  function drawWatermark(g, size, wm, env) {
    if (!wm || !wm.t && !wm.u) return;
    const valign = wm.a || "centre";
    if (wm.u) {
      const img = env.imageFor(wm.u);
      if (img && typeof g.drawImage === "function") {
        const s = Math.min(1, size.w * 0.8 / img.naturalWidth, size.h * 0.8 / img.naturalHeight);
        const w = img.naturalWidth * s;
        const h = img.naturalHeight * s;
        const y = valign === "top" ? 10 : valign === "bottom" ? size.h - h - 10 : (size.h - h) / 2;
        g.drawImage(img, (size.w - w) / 2, y, w, h);
      }
    }
    if (wm.t) {
      let fs = wm.fs ?? 80;
      g.font = font(fs, wm.ff || env.fontFamily, wm.fb);
      const tw = g.measureText(wm.t).width;
      if (tw > size.w * 0.9) {
        fs *= size.w * 0.9 / tw;
        g.font = font(fs, wm.ff || env.fontFamily, wm.fb);
      }
      const y = valign === "top" ? fs : valign === "bottom" ? size.h - fs : size.h / 2;
      if (wm.fbc) {
        const w = g.measureText(wm.t).width;
        g.fillStyle = wm.fbc;
        g.fillRect((size.w - w) / 2 - 8, y - fs * 0.6, w + 16, fs * 1.2);
      }
      g.fillStyle = wm.fc || "rgba(0,0,0,0.12)";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(wm.t, size.w / 2, y);
    }
  }
  function corner(size, p, w, h, x = 0, y = 0, margin = 10) {
    const right = p === "ne" || p === "se";
    const bottom = p === "se" || p === "sw";
    return { x: (right ? size.w - w - margin : margin) + x, y: (bottom ? size.h - h - margin : margin) + y };
  }
  function drawLogo(g, size, logo, env) {
    if (!logo || !logo.u) return;
    const ratio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const hi = ratio > 1 ? env.imageFor(logo.u.replace(/(\.\w+)$/, "@2x$1"), true) : null;
    const img = hi || env.imageFor(logo.u);
    if (!img || typeof g.drawImage !== "function") return;
    const w = img.naturalWidth / (hi ? 2 : 1);
    const h = img.naturalHeight / (hi ? 2 : 1);
    const at = corner(size, logo.p || "ne", w, h, logo.x, logo.y);
    g.drawImage(img, at.x, at.y, w, h);
  }
  var theme = (options) => {
    const dark = options.controlTheme === "dark";
    return {
      bg: dark ? "rgba(48,48,48,0.9)" : "rgba(255,255,255,0.9)",
      fg: options.controlColour || (dark ? "#e0e0e0" : "#455a64"),
      border: dark ? "#616161" : "#cfd8dc"
    };
  };
  function navigationLayout(size, options) {
    const nav = options.navigation || {};
    if (nav.shown === false) return [];
    const s = 26;
    const ids = ["up", "left", "right", "down", "in", "out", "fit"];
    const w = s * 3;
    const h = s * 3 + 8 + s * 3;
    const at = corner(size, nav.p || "nw", w, h, nav.x, nav.y);
    const rects = {
      up: [at.x + s, at.y],
      left: [at.x, at.y + s],
      right: [at.x + 2 * s, at.y + s],
      down: [at.x + s, at.y + 2 * s],
      in: [at.x + s, at.y + 3 * s + 8],
      out: [at.x + s, at.y + 4 * s + 8],
      fit: [at.x + s, at.y + 5 * s + 8]
    };
    return ids.map((id) => ({ id, x: rects[id][0], y: rects[id][1], w: s, h: s }));
  }
  function drawNavigation(g, size, options) {
    const buttons = navigationLayout(size, options);
    if (!buttons.length) return;
    const t = theme(options);
    const glyph = { up: "\u25B2", down: "\u25BC", left: "\u25C0", right: "\u25B6", in: "+", out: "\u2212", fit: "\u2922" };
    buttons.forEach((b) => {
      g.beginPath();
      roundRectPath(g, b.x + 1, b.y + 1, b.w - 2, b.h - 2, [5, 5, 5, 5]);
      g.fillStyle = t.bg;
      g.fill();
      g.strokeStyle = t.border;
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = t.fg;
      g.font = `${b.w * 0.5}px sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(glyph[b.id], b.x + b.w / 2, b.y + b.h / 2 + 1);
    });
  }
  var hitButton = (buttons, x, y) => buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;
  function overviewLayout(size, options, open) {
    const ov = options.overview || {};
    if (ov.icon === false && !open) return null;
    const s = open ? ov.size ?? 100 : 22;
    const at = corner(size, ov.p || "se", s, s);
    return { x: at.x, y: at.y, w: s, h: s, open };
  }
  function drawOverview(g, size, options, open, world, viewRect, points) {
    const box = overviewLayout(size, options, open);
    if (!box) return null;
    const ov = options.overview || {};
    const t = theme(options);
    g.beginPath();
    roundRectPath(g, box.x, box.y, box.w, box.h, [4, 4, 4, 4]);
    g.fillStyle = ov.backColour || options.backColour || "#ffffff";
    g.fill();
    g.strokeStyle = ov.borderColour || t.border;
    g.lineWidth = 1;
    g.stroke();
    if (!open) {
      g.fillStyle = t.fg;
      g.font = "13px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("\u25A3", box.x + box.w / 2, box.y + box.h / 2 + 1);
      return box;
    }
    const pad = 6;
    const ww = Math.max(world.maxX - world.minX, viewRect.maxX - viewRect.minX, 1);
    const wh = Math.max(world.maxY - world.minY, viewRect.maxY - viewRect.minY, 1);
    const minX = Math.min(world.minX, viewRect.minX);
    const minY = Math.min(world.minY, viewRect.minY);
    const s = Math.min((box.w - pad * 2) / ww, (box.h - pad * 2) / wh);
    const toX = (x) => box.x + pad + (x - minX) * s;
    const toY = (y) => box.y + pad + (y - minY) * s;
    points.forEach((pt) => {
      g.fillStyle = pt.c || "#90a4ae";
      g.fillRect(toX(pt.x) - 1, toY(pt.y) - 1, 2, 2);
    });
    g.strokeStyle = ov.borderColour || t.fg;
    g.lineWidth = 1.5;
    g.beginPath();
    g.rect(toX(viewRect.minX), toY(viewRect.minY), (viewRect.maxX - viewRect.minX) * s, (viewRect.maxY - viewRect.minY) * s);
    g.stroke();
    box.toWorld = (x, y) => ({ x: (x - box.x - pad) / s + minX, y: (y - box.y - pad) / s + minY });
    return box;
  }

  // src/engine/timebar.js
  var SEC = 1e3;
  var UNITS = [
    ["sec", SEC],
    ["min", 60 * SEC],
    ["hour", 3600 * SEC],
    ["day", 86400 * SEC],
    ["week", 7 * 86400 * SEC],
    ["month", 30.44 * 86400 * SEC],
    ["year", 365.25 * 86400 * SEC]
  ];
  var UNIT_MS = Object.fromEntries(UNITS);
  var AXIS_H = 18;
  var CTRL_H = 26;
  var unitMs = (spec) => spec && UNIT_MS[spec.units] ? (spec.value ?? 1) * UNIT_MS[spec.units] : null;
  var HANDLE = 6;
  var asList4 = (v) => Array.isArray(v) ? v : v == null ? [] : [v];
  var toMs = (d) => d instanceof Date ? d.getTime() : Number(d);
  function floorTo(t, unit) {
    const d = new Date(t);
    switch (unit) {
      case "year":
        return new Date(d.getFullYear(), 0, 1).getTime();
      case "month":
        return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      case "week":
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime();
      case "day":
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      default:
        return Math.floor(t / UNIT_MS[unit]) * UNIT_MS[unit];
    }
  }
  function nextOf(t, unit) {
    const d = new Date(t);
    if (unit === "year") return new Date(d.getFullYear() + 1, 0, 1).getTime();
    if (unit === "month") return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    if (unit === "week") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
    if (unit === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    return t + UNIT_MS[unit];
  }
  function labelFor(t, unit, locale) {
    const d = new Date(t);
    if (locale) {
      const short = locale.shortMonths || ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const pad = (n) => String(n).padStart(2, "0");
      if (unit === "year") return String(d.getFullYear());
      if (unit === "month") return `${locale.longMonths && unit === "month" && locale.longMonths[d.getMonth()] || short[d.getMonth()]} ${d.getFullYear()}`;
      if (unit === "day" || unit === "week") return locale.order === "mdy" ? `${short[d.getMonth()]} ${d.getDate()}` : `${d.getDate()} ${short[d.getMonth()]}`;
      let h = d.getHours();
      let suffix = "";
      if (locale.h12) {
        suffix = ` ${(locale.ampm || ["am", "pm"])[h < 12 ? 0 : 1]}`;
        h = h % 12 || 12;
      }
      return `${pad(h)}:${pad(d.getMinutes())}${unit === "sec" ? `:${pad(d.getSeconds())}` : ""}${suffix}`;
    }
    if (unit === "year") return String(d.getFullYear());
    if (unit === "month") return d.toLocaleString(void 0, { month: "short", year: "numeric" });
    if (unit === "day" || unit === "week") return d.toLocaleString(void 0, { day: "numeric", month: "short" });
    return d.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit", second: unit === "sec" ? "2-digit" : void 0 });
  }
  function normaliseItem(item) {
    const dts = asList4(item.dt);
    const vs = asList4(item.v);
    return dts.map((dt, i) => {
      const period = dt && typeof dt === "object" && !(dt instanceof Date);
      const t1 = toMs(period ? dt.dt1 ?? dt.dt2 : dt);
      const t2 = toMs(period ? dt.dt2 ?? dt.dt1 : dt);
      return { t1, t2, v: Number.isFinite(vs[i]) ? vs[i] : Number.isFinite(vs[0]) && vs.length === 1 ? vs[0] : 1 };
    }).filter((e) => Number.isFinite(e.t1));
  }
  function createTimebar(container, initialOptions = {}) {
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, { width: "100%", height: "100%", display: "block", touchAction: "none" });
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const events = createEmitter();
    let options = {
      backColour: "#ffffff",
      fontColour: "#444",
      fontFamily: "sans-serif",
      fontSize: 11,
      histogram: { colour: "#8ba3c7", highlightColour: "#2f6db5", markColour: "#f5b041", markHiColour: "#d68910" },
      area: { colour: "#8ba3c7" },
      type: "histogram",
      playSpeed: 60,
      sliders: "fixed",
      sliderColour: "rgba(255,255,255,0.65)",
      sliderLineColour: "#666",
      ...initialOptions
    };
    const items = /* @__PURE__ */ new Map();
    let view = { t0: Date.now() - 86400 * SEC, t1: Date.now() };
    let range = { ...view };
    let marks = [];
    let selection = [];
    let hoverBin = -1;
    let playTimer = null;
    let destroyed = false;
    function extent() {
      let lo = Infinity;
      let hi = -Infinity;
      items.forEach((it) => it.entries.forEach((e) => {
        lo = Math.min(lo, e.t1);
        hi = Math.max(hi, e.t2);
      }));
      return lo <= hi ? { lo, hi: hi === lo ? lo + UNIT_MS.day : hi } : null;
    }
    function put(list) {
      asList4(list).forEach((item) => {
        if (!item || item.id == null) return;
        items.set(item.id, { id: item.id, d: item.d, entries: normaliseItem(item) });
      });
    }
    function size() {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w, h };
    }
    const xOf = (t, w) => (t - view.t0) / (view.t1 - view.t0) * w;
    const tOf = (x, w) => view.t0 + x / w * (view.t1 - view.t0);
    function unit() {
      const span = view.t1 - view.t0;
      const floor = options.minScale && UNIT_MS[options.minScale.units] ? UNIT_MS[options.minScale.units] : 0;
      return (UNITS.find(([, ms]) => ms >= floor && span / ms <= 120) || UNITS[UNITS.length - 1])[0];
    }
    const showControls = () => options.showControlBar !== false;
    function controlButtons(w, h) {
      if (!showControls()) return [];
      const s = CTRL_H - 4;
      const y = h - CTRL_H + 2;
      const centre = ["back"];
      if (options.showPlay !== false) {
        centre.push("play");
        if (options.showExtend !== false) centre.push("extend");
      }
      centre.push("forward");
      const right = ["in", "out"];
      if (options.showFit !== false) right.push("fit");
      const out = [];
      let x = w / 2 - centre.length * (s + 4) / 2;
      centre.forEach((id) => {
        out.push({ id, x, y, w: s, h: s });
        x += s + 4;
      });
      x = w - right.length * (s + 4) - 4;
      right.forEach((id) => {
        out.push({ id, x, y, w: s, h: s });
        x += s + 4;
      });
      return out;
    }
    function drawControls(w, h) {
      if (!showControls()) return;
      const dark = options.controlBarTheme === "dark";
      ctx.fillStyle = dark ? "#303030" : "#f2f2f2";
      ctx.fillRect(0, h - CTRL_H, w, CTRL_H);
      const icon = { back: "\u25C0", forward: "\u25B6", play: playTimer ? "\u275A\u275A" : "\u25BA", extend: "\u25BA|", in: "+", out: "\u2212", fit: "\u2922" };
      controlButtons(w, h).forEach((b) => {
        ctx.fillStyle = dark ? "#474747" : "#ffffff";
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = dark ? "#5a5a5a" : "#cccccc";
        ctx.lineWidth = 1;
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
        ctx.fillStyle = dark ? "#e0e0e0" : "#444444";
        ctx.font = `${b.h * 0.55}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(icon[b.id], b.x + b.w / 2, b.y + b.h / 2 + 1);
      });
    }
    function runControl(id) {
      if (id === "back" || id === "forward") api.pan(id, { animate: true });
      else if (id === "play") {
        if (playTimer) api.pause();
        else api.play();
      } else if (id === "extend") {
        if (playTimer) api.pause();
        else api.play({ extend: true });
      } else api.zoom(id, { animate: true });
      render();
    }
    const shownHeights = /* @__PURE__ */ new Map();
    let lastFrame = 0;
    let heightRaf = null;
    function easedHeight(key, target, now) {
      const hc = options.heightChange || {};
      if (hc.animate === false || !shownHeights.has(key)) {
        shownHeights.set(key, target);
        return target;
      }
      const time = hc.time ?? 200;
      const k = Math.min(1, (now - lastFrame) / time * 3);
      const cur = shownHeights.get(key);
      const next = Math.abs(target - cur) < 0.5 ? target : cur + (target - cur) * k;
      shownHeights.set(key, next);
      if (next !== target && !heightRaf) heightRaf = requestAnimationFrame(() => {
        heightRaf = null;
        render();
      });
      return next;
    }
    function bins() {
      const u = unit();
      const out = [];
      for (let t = floorTo(view.t0, u); t < view.t1; t = nextOf(t, u)) out.push({ t1: t, t2: nextOf(t, u), total: 0, groups: [], lines: [] });
      const groupBy = options.groups && options.groups.groupBy;
      const categories = options.groups && options.groups.categories || [];
      const lineSets = selection.map((s) => new Set(asList4(s.id)));
      items.forEach((it) => it.entries.forEach((e) => {
        const idx = out.findIndex((b) => e.t1 >= b.t1 && e.t1 < b.t2);
        if (idx < 0) return;
        const bin = out[idx];
        bin.total += e.v;
        if (groupBy) {
          const g = categories.indexOf(it.d && it.d[groupBy]);
          if (g >= 0) bin.groups[g] = (bin.groups[g] || 0) + e.v;
        }
        lineSets.forEach((set, li) => {
          if (set.has(it.id)) bin.lines[li] = (bin.lines[li] || 0) + e.v;
        });
      }));
      return out;
    }
    function render() {
      if (destroyed) return;
      const { w, h } = size();
      const ctrlH = showControls() ? CTRL_H : 0;
      const plotH = h - AXIS_H - ctrlH;
      const now = performance.now();
      if (!lastFrame) lastFrame = now;
      ctx.fillStyle = options.backColour;
      ctx.fillRect(0, 0, w, h);
      const bs = bins();
      const max = Math.max(1, ...bs.map((b) => b.total), ...bs.flatMap((b) => b.lines.filter(Boolean)));
      const hist = options.histogram || {};
      const inMark = (b) => marks.some((m) => b.t1 < m.t2 && b.t2 > m.t1);
      const colours = options.groups && options.groups.colours || [];
      if (options.type === "area") {
        ctx.beginPath();
        ctx.moveTo(0, plotH);
        bs.forEach((b) => ctx.lineTo(xOf((b.t1 + b.t2) / 2, w), plotH - b.total / max * (plotH - 4)));
        ctx.lineTo(w, plotH);
        ctx.closePath();
        ctx.fillStyle = options.area && options.area.colour || hist.colour;
        ctx.fill();
      } else {
        bs.forEach((b, i) => {
          const x1 = xOf(b.t1, w) + 0.5;
          const bw = Math.max(1, xOf(b.t2, w) - xOf(b.t1, w) - 1);
          let base2 = plotH;
          if (b.groups.length) {
            b.groups.forEach((v, g) => {
              if (!v) return;
              const bh = v / max * (plotH - 4);
              ctx.fillStyle = colours[g] || hist.colour;
              ctx.fillRect(x1, base2 - bh, bw, bh);
              base2 -= bh;
            });
          } else {
            const bh = easedHeight(b.t1, b.total / max * (plotH - 4), now);
            const marked = inMark(b);
            ctx.fillStyle = i === hoverBin ? marked ? hist.markHiColour : hist.highlightColour : marked ? hist.markColour : hist.colour;
            ctx.fillRect(x1, plotH - bh, bw, bh);
          }
        });
      }
      const lineColours = ["#e53935", "#43a047", "#1e88e5"];
      selection.forEach((s, li) => {
        ctx.beginPath();
        bs.forEach((b, i) => {
          const x = xOf((b.t1 + b.t2) / 2, w);
          const y = plotH - (b.lines[li] || 0) / max * (plotH - 4);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = s.c || lineColours[li % 3];
        ctx.lineWidth = 2;
        ctx.stroke();
      });
      ctx.fillStyle = options.fontColour;
      ctx.font = `${options.fontSize}px ${options.fontFamily}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      const u = unit();
      const labelUnit = UNITS[Math.min(UNITS.length - 1, UNITS.findIndex(([n]) => n === u) + 1)][0];
      let lastX = -Infinity;
      for (let t = floorTo(view.t0, labelUnit); t < view.t1; t = nextOf(t, labelUnit)) {
        const x = xOf(t, w);
        if (x < 0 || x - lastX < 60) continue;
        ctx.fillRect(x, plotH, 1, 4);
        ctx.fillText(labelFor(t, labelUnit, options.locale), x + 3, plotH + AXIS_H / 2 + 1);
        lastX = x;
      }
      if (options.sliders !== "none") {
        const a = xOf(range.t0, w);
        const b = xOf(range.t1, w);
        ctx.fillStyle = options.sliderColour;
        ctx.fillRect(0, 0, Math.max(0, a), plotH);
        ctx.fillRect(b, 0, Math.max(0, w - b), plotH);
        ctx.fillStyle = options.sliderLineColour;
        ctx.fillRect(a - 1, 0, 2, plotH);
        ctx.fillRect(b - 1, 0, 2, plotH);
        ctx.fillRect(a - HANDLE / 2, plotH / 2 - 10, HANDLE, 20);
        ctx.fillRect(b - HANDLE / 2, plotH / 2 - 10, HANDLE, 20);
      }
      drawControls(w, h);
      lastFrame = now;
    }
    function limitRange(t0, t1, anchor = "start") {
      const max = typeof options.maxRange === "object" ? unitMs(options.maxRange) : null;
      const min = unitMs(options.minScale);
      let width = t1 - t0;
      if (max && width > max) width = max;
      if (min && width < min) width = min;
      if (width === t1 - t0) return { t0, t1 };
      if (anchor === "end") return { t0: t1 - width, t1 };
      if (anchor === "mid") {
        const m = (t0 + t1) / 2;
        return { t0: m - width / 2, t1: m + width / 2 };
      }
      return { t0, t1: t0 + width };
    }
    function viewForRange() {
      const pad = options.sliders === "none" ? 0 : (range.t1 - range.t0) * 0.2;
      view = { t0: range.t0 - pad, t1: range.t1 + pad };
    }
    let rangeToken = 0;
    function setRange(rawT0, rawT1, opts = {}, moveView = true) {
      if (!(rawT1 > rawT0)) return Promise.reject(new Error("range: dt2 must be after dt1"));
      const { t0, t1 } = limitRange(rawT0, rawT1, opts.anchor);
      const target = { t0, t1 };
      const finish = () => {
        range = target;
        if (moveView) viewForRange();
        render();
        events.emit("change", { type: "range" });
      };
      const token = ++rangeToken;
      if (!opts.animate) {
        finish();
        return Promise.resolve();
      }
      const from = { ...range };
      const time = opts.time ?? 200;
      const start = performance.now();
      return new Promise((resolve) => {
        const frame = (now) => {
          if (token !== rangeToken) {
            resolve();
            return;
          }
          const k = Math.min(1, Math.max(0, (now - start) / time));
          range = { t0: from.t0 + (t0 - from.t0) * k, t1: from.t1 + (t1 - from.t1) * k };
          if (moveView) viewForRange();
          render();
          if (k < 1) requestAnimationFrame(frame);
          else {
            finish();
            resolve();
          }
        };
        requestAnimationFrame(frame);
      });
    }
    function fitRange(opts) {
      const ext = extent();
      if (!ext) return Promise.resolve();
      return setRange(ext.lo, ext.hi, opts);
    }
    function hit(evt) {
      const rect = canvas.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      const { w, h } = { w: rect.width, h: rect.height };
      const bs = bins();
      const a = xOf(range.t0, w);
      const b = xOf(range.t1, w);
      let type = "none";
      let index;
      let bin;
      const ctrlH = showControls() ? CTRL_H : 0;
      if (ctrlH && y > h - ctrlH) type = "controlbar";
      else if (y > h - AXIS_H - ctrlH) type = "scale";
      else if (Math.abs(x - a) <= HANDLE) type = "left";
      else if (Math.abs(x - b) <= HANDLE) type = "right";
      else {
        index = bs.findIndex((bb) => x >= xOf(bb.t1, w) && x < xOf(bb.t2, w));
        bin = bs[index];
        if (bin && bin.total > 0) type = "bar";
      }
      return {
        x,
        y,
        w,
        type,
        index: bin ? index : void 0,
        value: bin ? bin.total : void 0,
        rangeStart: bin ? new Date(bin.t1) : void 0,
        rangeEnd: bin ? new Date(bin.t2) : void 0,
        tooltipX: x,
        tooltipY: y,
        button: evt.button
      };
    }
    let drag = null;
    canvas.addEventListener("pointerdown", (evt) => {
      const info = hit(evt);
      if (events.emit("pointer-down", info)) return;
      if (info.type === "controlbar") {
        const rect = canvas.getBoundingClientRect();
        const button = controlButtons(rect.width, rect.height).find((b) => info.x >= b.x && info.x <= b.x + b.w && info.y >= b.y && info.y <= b.y + b.h);
        if (button) runControl(button.id);
        return;
      }
      const mode = info.type === "left" || info.type === "right" ? info.type : info.x > xOf(range.t0, info.w) && info.x < xOf(range.t1, info.w) ? "move" : "pan";
      if (options.sliders === "none" && mode !== "pan") return;
      if (events.emit("drag-start", { ...info, type: mode })) return;
      drag = { mode, startX: info.x, range: { ...range }, view: { ...view }, w: info.w, moved: false };
      canvas.setPointerCapture(evt.pointerId);
    });
    canvas.addEventListener("pointermove", (evt) => {
      const info = hit(evt);
      if (!drag) {
        const idx = info.type === "bar" ? info.index : -1;
        if (idx !== hoverBin) {
          hoverBin = idx;
          render();
          events.emit("hover", info);
        }
        return;
      }
      drag.moved = true;
      const dt = (info.x - drag.startX) / drag.w * (drag.view.t1 - drag.view.t0);
      const min = (drag.view.t1 - drag.view.t0) / 200;
      if (drag.mode === "pan") {
        view = { t0: drag.view.t0 - dt, t1: drag.view.t1 - dt };
        range = { t0: drag.range.t0 - dt, t1: drag.range.t1 - dt };
        render();
        events.emit("change", { type: "range" });
        return;
      }
      let { t0, t1 } = drag.range;
      if (drag.mode === "left") t0 = Math.min(t0 + dt, t1 - min);
      else if (drag.mode === "right") t1 = Math.max(t1 + dt, t0 + min);
      else {
        t0 += dt;
        t1 += dt;
      }
      setRange(t0, t1, { anchor: drag.mode === "left" ? "end" : "start" }, false);
    });
    const endDrag = (evt) => {
      if (!drag) return;
      const info = hit(evt);
      const wasClick = !drag.moved;
      drag = null;
      events.emit("drag-end", info);
      if (wasClick) events.emit("click", info);
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("dblclick", (evt) => {
      const info = hit(evt);
      if (!events.emit("double-click", info)) api.zoom("in", { animate: true });
    });
    canvas.addEventListener("wheel", (evt) => {
      const info = hit(evt);
      if (events.emit("wheel", { ...info, deltaY: evt.deltaY })) return;
      evt.preventDefault();
      const factor = evt.deltaY > 0 ? 1.2 : 1 / 1.2;
      const at = tOf(info.x, info.w);
      view = { t0: at - (at - view.t0) * factor, t1: at + (view.t1 - at) * factor };
      render();
    }, { passive: false });
    const onResize = () => render();
    window.addEventListener("resize", onResize);
    const api = {
      load(data) {
        items.clear();
        put(data && data.items);
        events.emit("change", { type: "data" });
        return fitRange();
      },
      merge(list) {
        put(Array.isArray(list) ? list : list && list.items);
        render();
        events.emit("change", { type: "data" });
        return Promise.resolve();
      },
      removeItem(ids) {
        asList4(ids).forEach((id) => items.delete(id));
        render();
        events.emit("change", { type: "data" });
      },
      clear() {
        items.clear();
        marks = [];
        selection = [];
        render();
        events.emit("change", { type: "data" });
      },
      range(dt1, dt2, opts) {
        if (dt1 === void 0) return { dt1: new Date(range.t0), dt2: new Date(range.t1) };
        return setRange(toMs(dt1), toMs(dt2), opts);
      },
      getIds(dt1, dt2) {
        const a = toMs(dt1);
        const b = toMs(dt2);
        return [...items.values()].filter((it) => it.entries.some((e) => e.t1 <= b && e.t2 >= a)).map((it) => it.id);
      },
      inRange(item) {
        const it = typeof item === "string" ? items.get(item) : item && { entries: normaliseItem(item) };
        return !!it && it.entries.some((e) => e.t1 <= range.t1 && e.t2 >= range.t0);
      },
      zoom(how = "fit", opts = {}) {
        if (how === "fit") {
          if (opts.id !== void 0) {
            const ents = asList4(opts.id).flatMap((id) => (items.get(id) || { entries: [] }).entries);
            if (ents.length) return setRange(Math.min(...ents.map((e) => e.t1)), Math.max(...ents.map((e) => e.t2)) || Math.min(...ents.map((e) => e.t1)) + UNIT_MS.day, opts);
          }
          return fitRange(opts);
        }
        const mid = (range.t0 + range.t1) / 2;
        const half = (range.t1 - range.t0) / 2 * (how === "in" ? 0.5 : 2);
        return setRange(mid - half, mid + half, { ...opts, anchor: "mid" });
      },
      pan(direction = "forward", opts = {}) {
        const step = (range.t1 - range.t0) * (direction === "back" ? -1 : 1);
        return setRange(range.t0 + step, range.t1 + step, opts);
      },
      play(opts = {}) {
        if (playTimer) return;
        const ext = extent();
        if (!ext) return;
        if (range.t1 >= ext.hi) {
          const width = Math.min(range.t1 - range.t0, (ext.hi - ext.lo) / 10);
          setRange(ext.lo, ext.lo + width);
        }
        events.emit("play", { extend: !!opts.extend });
        events.emit("start", {});
        const tick = 50;
        playTimer = setInterval(() => {
          const width = range.t1 - range.t0;
          const step = width / Math.max(1, options.playSpeed) * (tick / 50);
          if (range.t1 >= ext.hi) {
            api.pause();
            events.emit("end", {});
            return;
          }
          if (opts.extend) setRange(range.t0, Math.min(ext.hi, range.t1 + step), {}, true);
          else setRange(range.t0 + step, range.t1 + step, {}, true);
        }, tick);
      },
      pause() {
        if (!playTimer) return;
        clearInterval(playTimer);
        playTimer = null;
        events.emit("pause", {});
      },
      mark(list) {
        if (list === void 0) return marks.map((m) => m.t1 === m.t2 ? new Date(m.t1) : { dt1: new Date(m.t1), dt2: new Date(m.t2) });
        marks = asList4(list).flatMap((m) => normaliseItem({ dt: m })).map(({ t1, t2 }) => ({ t1, t2 }));
        render();
        return marks.length;
      },
      selection(lines) {
        if (lines !== void 0) {
          const list = asList4(lines);
          const next = [];
          list.forEach((line, i) => {
            if (line == null) return;
            next[line.index ?? i] = { id: asList4(line.id), c: line.c };
          });
          selection = next.slice(0, 3).filter(Boolean);
          render();
        }
        return [0, 1, 2].map((i) => selection[i] ? selection[i].id.slice() : null);
      },
      options(next) {
        if (next === void 0) return { ...options };
        options = { ...options, ...next, histogram: { ...options.histogram, ...next.histogram || {} } };
        if ("sliders" in next) viewForRange();
        render();
        return Promise.resolve();
      },
      setContainer(element) {
        const target = typeof element === "string" ? document.getElementById(element) : element;
        if (!target) {
          canvas.remove();
          return;
        }
        container = target;
        container.appendChild(canvas);
        render();
      },
      destroy() {
        api.pause();
        window.removeEventListener("resize", onResize);
        canvas.remove();
        events.clear();
        destroyed = true;
        Object.keys(api).forEach((k) => {
          api[k] = () => {
            throw new Error("This time bar has been destroyed");
          };
        });
      },
      on: events.on,
      off: events.off,
      bind: events.bind,
      unbind: events.unbind,
      toString: () => "[GraphNexus timebar]"
    };
    render();
    return api;
  }

  // src/engine/webgl.js
  var DISC_VS = `
attribute vec2 a_corner; attribute vec2 a_center; attribute vec2 a_half;
attribute vec4 a_fill; attribute vec4 a_border; attribute vec3 a_extra; // bw, box, alpha
uniform vec2 u_size;
varying vec2 v_local; varying vec2 v_half; varying vec4 v_fill; varying vec4 v_border; varying vec3 v_extra;
void main() {
  vec2 grown = a_half + 1.0;
  vec2 pos = a_center + a_corner * grown;
  v_local = a_corner * grown; v_half = a_half; v_fill = a_fill; v_border = a_border; v_extra = a_extra;
  gl_Position = vec4(pos / u_size * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;
  var DISC_FS = `
precision mediump float;
uniform float u_shade; // 1: light round bodies like spheres (3D view)
varying vec2 v_local; varying vec2 v_half; varying vec4 v_fill; varying vec4 v_border; varying vec3 v_extra;
void main() {
  float outer = v_extra.y > 0.5
    ? max(abs(v_local.x) - v_half.x, abs(v_local.y) - v_half.y)
    : length(v_local) - v_half.x;
  float coverage = clamp(0.5 - outer, 0.0, 1.0);
  if (coverage <= 0.0) discard;
  bool border = v_extra.x > 0.0 && outer > -v_extra.x;
  vec4 col = border ? v_border : v_fill;
  if (u_shade > 0.5 && v_extra.y < 0.5 && !border) {
    // Same look as the canvas path: top-left highlight, darker rim.
    vec2 q = v_local / max(v_half.x - v_extra.x, 1.0);
    float glow = 1.0 - smoothstep(0.0, 0.95, length(q - vec2(-0.35, -0.4)));
    float rim = smoothstep(0.6, 1.0, length(q));
    col.rgb = mix(col.rgb, vec3(1.0), glow * 0.5) * (1.0 - rim * 0.38);
  }
  gl_FragColor = vec4(col.rgb, col.a * coverage * v_extra.z);
}`;
  var LINE_VS = `
attribute vec2 a_pos; attribute vec4 a_color;
uniform vec2 u_size;
varying vec4 v_color;
void main() {
  v_color = a_color;
  gl_Position = vec4(a_pos / u_size * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;
  var LINE_FS = `
precision mediump float;
varying vec4 v_color;
void main() { gl_FragColor = v_color; }`;
  function compile(gl, vs, fs) {
    const prog = gl.createProgram();
    [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(([type, src]) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(prog, sh);
    });
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    return prog;
  }
  var colourCache = /* @__PURE__ */ new Map();
  var probe = null;
  function parseColour(css) {
    if (css == null) return [0, 0, 0, 0];
    if (Array.isArray(css)) return css;
    if (colourCache.has(css)) return colourCache.get(css);
    if (!probe) probe = document.createElement("canvas").getContext("2d");
    probe.fillStyle = "#000000";
    probe.fillStyle = css;
    const v = probe.fillStyle;
    let out;
    if (v[0] === "#") out = [parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255, 1];
    else {
      const m = v.match(/[\d.]+/g).map(Number);
      out = [m[0] / 255, m[1] / 255, m[2] / 255, m[3] ?? 1];
    }
    colourCache.set(css, out);
    return out;
  }
  function createGLLayer(container, overlay) {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", { premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: true });
    if (!gl) return null;
    let disc;
    let line;
    try {
      disc = compile(gl, DISC_VS, DISC_FS);
      line = compile(gl, LINE_VS, LINE_FS);
    } catch {
      return null;
    }
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    Object.assign(canvas.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", zIndex: "0", pointerEvents: "none" });
    container.insertBefore(canvas, overlay);
    Object.assign(overlay.style, { position: "relative", zIndex: "1" });
    const buffer = gl.createBuffer();
    const lineBuffer = gl.createBuffer();
    let rings = [];
    let discs = [];
    let lines = [];
    let size = { w: 1, h: 1 };
    let ordered = false;
    let shade = 0;
    let runs = [];
    const DISC_STRIDE = 17;
    const LINE_STRIDE = 6;
    function mark(kind, start) {
      if (!ordered) return;
      const last = runs[runs.length - 1];
      if (last && last.kind === kind) last.count += 6;
      else runs.push({ kind, start, count: 6 });
    }
    const attr = (prog, name) => gl.getAttribLocation(prog, name);
    function bindAttrs(prog, layout, stride) {
      let offset = 0;
      layout.forEach(([name, n]) => {
        const loc = attr(prog, name);
        if (loc >= 0) {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride * 4, offset * 4);
        }
        offset += n;
      });
    }
    return {
      canvas,
      gl,
      /** `inOrder`: draw primitives in submission order (3D depth sort) rather than in passes. */
      begin(viewSize, background, inOrder = false, sphereShading = false) {
        size = viewSize;
        ordered = inOrder;
        shade = sphereShading ? 1 : 0;
        runs = [];
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(viewSize.w * dpr);
        const h = Math.round(viewSize.h * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        gl.viewport(0, 0, w, h);
        const bg = parseColour(background || "#ffffff");
        gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);
        rings = [];
        discs = [];
        lines = [];
      },
      /** A node body: centre, half extents (px), box?, fill, border colour, border width (px), alpha. */
      disc(x, y, hw, hh, box, fill, border, bw, alpha = 1) {
        const f = parseColour(fill);
        const b = parseColour(border || fill);
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
        mark("disc", discs.length / DISC_STRIDE);
        corners.forEach(([cx, cy]) => discs.push(cx, cy, x, y, hw + bw, hh + bw, ...f, ...b, bw, box ? 1 : 0, alpha));
      },
      /** A halo ring centred at (x, y): radius to the ring's centre line, width w (px). */
      ring(x, y, radius, w, colour, alpha = 1) {
        const c = parseColour(colour);
        const half = radius + w / 2;
        const out = ordered ? discs : rings;
        mark("disc", discs.length / DISC_STRIDE);
        [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]].forEach(([cx, cy]) => out.push(cx, cy, x, y, half, half, 0, 0, 0, 0, ...c, w, 0, alpha));
      },
      /** A straight segment of width `w` px, colour c1 at the start fading to c2 at the end. */
      line(x1, y1, x2, y2, w, c1, c2, alpha = 1) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len * (w / 2);
        const ny = dx / len * (w / 2);
        const a = parseColour(c1);
        const b = parseColour(c2 || c1);
        const ca = [a[0], a[1], a[2], a[3] * alpha];
        const cb = [b[0], b[1], b[2], b[3] * alpha];
        mark("line", lines.length / LINE_STRIDE);
        lines.push(
          x1 + nx,
          y1 + ny,
          ...ca,
          x1 - nx,
          y1 - ny,
          ...ca,
          x2 - nx,
          y2 - ny,
          ...cb,
          x1 + nx,
          y1 + ny,
          ...ca,
          x2 - nx,
          y2 - ny,
          ...cb,
          x2 + nx,
          y2 + ny,
          ...cb
        );
      },
      flush() {
        gl.useProgram(disc);
        gl.uniform1f(gl.getUniformLocation(disc, "u_shade"), shade);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const drawDiscs = (data) => {
          gl.useProgram(disc);
          gl.uniform2f(gl.getUniformLocation(disc, "u_size"), size.w, size.h);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
          bindAttrs(disc, [["a_corner", 2], ["a_center", 2], ["a_half", 2], ["a_fill", 4], ["a_border", 4], ["a_extra", 3]], 17);
          gl.drawArrays(gl.TRIANGLES, 0, data.length / 17);
        };
        if (ordered) {
          const discLoc = gl.getUniformLocation(disc, "u_size");
          const lineLoc = gl.getUniformLocation(line, "u_size");
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(discs), gl.STREAM_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STREAM_DRAW);
          runs.forEach((run) => {
            if (run.kind === "disc") {
              gl.useProgram(disc);
              gl.uniform2f(discLoc, size.w, size.h);
              gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
              bindAttrs(disc, [["a_corner", 2], ["a_center", 2], ["a_half", 2], ["a_fill", 4], ["a_border", 4], ["a_extra", 3]], DISC_STRIDE);
            } else {
              gl.useProgram(line);
              gl.uniform2f(lineLoc, size.w, size.h);
              gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
              bindAttrs(line, [["a_pos", 2], ["a_color", 4]], LINE_STRIDE);
            }
            gl.drawArrays(gl.TRIANGLES, run.start, run.count);
          });
          return;
        }
        if (rings.length) drawDiscs(rings);
        if (lines.length) {
          gl.useProgram(line);
          gl.uniform2f(gl.getUniformLocation(line, "u_size"), size.w, size.h);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STREAM_DRAW);
          bindAttrs(line, [["a_pos", 2], ["a_color", 4]], 6);
          gl.drawArrays(gl.TRIANGLES, 0, lines.length / 6);
        }
        if (discs.length) drawDiscs(discs);
      },
      /** Counts from the last frame, for tests. */
      stats: () => ({ rings: rings.length / (6 * 17), discs: discs.length / (6 * 17), segments: lines.length / (6 * 6) }),
      destroyed: false,
      destroy() {
        this.destroyed = true;
        canvas.remove();
        const lose = gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      }
    };
  }

  // src/engine/camera3d.js
  var MAX_PITCH = Math.PI / 2 - 0.01;
  var ORBIT_SPEED = 5e-3;
  var KEYS = ["yaw", "pitch", "focal", "targetX", "targetY", "targetZ"];
  function createCamera3D(opts = {}) {
    const cam = { yaw: 0, pitch: 0, focal: 1500, targetX: 0, targetY: 0, targetZ: 0 };
    function rotate(x, y, z) {
      const cy = Math.cos(cam.yaw);
      const sy = Math.sin(cam.yaw);
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const cp = Math.cos(cam.pitch);
      const sp = Math.sin(cam.pitch);
      return { x: x1, y: y * cp - z1 * sp, z: y * sp + z1 * cp };
    }
    function unrotate(x, y, z) {
      const cp = Math.cos(cam.pitch);
      const sp = Math.sin(cam.pitch);
      const y1 = y * cp + z * sp;
      const z1 = -y * sp + z * cp;
      const cy = Math.cos(cam.yaw);
      const sy = Math.sin(cam.yaw);
      return { x: x * cy - z1 * sy, y: y1, z: x * sy + z1 * cy };
    }
    const api = {
      /** A copy of { yaw, pitch, focal, targetX, targetY, targetZ }. */
      get state() {
        return { ...cam };
      },
      set(next = {}) {
        KEYS.forEach((k) => {
          if (Number.isFinite(next[k])) cam[k] = next[k];
        });
        cam.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, cam.pitch));
        cam.focal = Math.max(1, cam.focal);
      },
      /** Camera-space point: depth > 0 is behind the pivot plane, < 0 in front of it. */
      toCamera(x, y, z) {
        return rotate(x - cam.targetX, y - cam.targetY, (z || 0) - cam.targetZ);
      },
      project(x, y, z, view, size) {
        const c = api.toCamera(x, y, z);
        const d = cam.focal + c.z;
        if (d <= 1) return null;
        const s = cam.focal / d;
        return {
          x: (c.x * s + view.panX) * view.zoom + size.w / 2,
          y: (c.y * s + view.panY) * view.zoom + size.h / 2,
          depth: c.z,
          s
        };
      },
      unproject(sx, sy, depth, view, size) {
        const s = cam.focal / (cam.focal + depth);
        const w = unrotate(
          ((sx - size.w / 2) / view.zoom - view.panX) / s,
          ((sy - size.h / 2) / view.zoom - view.panY) / s,
          depth
        );
        return { x: w.x + cam.targetX, y: w.y + cam.targetY, z: w.z + cam.targetZ };
      },
      orbit(dx, dy) {
        api.set({ yaw: cam.yaw + dx * ORBIT_SPEED, pitch: cam.pitch + dy * ORBIT_SPEED });
      }
    };
    api.set(opts);
    return api;
  }
  function convexHull(points) {
    const p = [...points].sort((m, n) => m.x - n.x || m.y - n.y);
    if (p.length < 3) return p;
    const turn = (o, q, r) => (q.x - o.x) * (r.y - o.y) - (q.y - o.y) * (r.x - o.x);
    const half = (list) => {
      const out = [];
      list.forEach((pt) => {
        while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], pt) <= 0) out.pop();
        out.push(pt);
      });
      out.pop();
      return out;
    };
    return [...half(p), ...half([...p].reverse())];
  }
  function coneOutline(project, tip, dir, length, radius) {
    const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const u0 = cross(dir, Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    const ul = Math.hypot(...u0);
    const u = u0.map((c) => c / ul);
    const v = cross(dir, u);
    const base3 = tip.map((c, i) => c - dir[i] * length);
    const tipScreen = project(...tip);
    const base2 = project(...base3);
    if (!tipScreen || !base2) return null;
    const pts = [tipScreen];
    for (let k = 0; k < 16; k++) {
      const t = k / 16 * Math.PI * 2;
      const q = project(...base3.map((c, i) => c + radius * (Math.cos(t) * u[i] + Math.sin(t) * v[i])));
      if (!q) return null;
      pts.push(q);
    }
    return { base: base2, outline: convexHull(pts) };
  }

  // src/graph-nexus.js
  var import_meta2 = {};
  var VERSION = "GraphNexus 1.0";
  var asList5 = (v) => Array.isArray(v) ? v : v == null ? [] : [v];
  var clone = (v) => v === void 0 ? v : JSON.parse(JSON.stringify(v));
  var globals = { corsAdapter: null, paths: {}, mode: "auto", renderers: /* @__PURE__ */ new Set() };
  var GL_AUTO_NODES = 3e3;
  var WORKER_MIN_ITEMS = 600;
  function runInWorker(items, method, opts, onProgress) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(new URL("./engine/graphWorker.js", import_meta2.url), { type: "module" });
      } catch (err) {
        reject(err);
        return;
      }
      worker.onmessage = ({ data }) => {
        if ("progress" in data) {
          onProgress(data.progress);
          return;
        }
        worker.terminate();
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
      };
      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };
      try {
        const { onProgress: _ignored, ...plain } = opts || {};
        worker.postMessage({ items: JSON.parse(JSON.stringify(items)), method, opts: plain });
      } catch (err) {
        worker.terminate();
        reject(err);
      }
    });
  }
  function createGraphFacade(getItems, onProgress = () => {
  }, engineOptions = {}) {
    const analysis = createGraphEngine(engineOptions);
    const reload = () => analysis.load({ items: getItems() });
    reload();
    const heavy = (method) => (opts = {}) => {
      const report = (p) => {
        onProgress(method, p);
        if (typeof opts.onProgress === "function") opts.onProgress(p);
      };
      const local = () => analysis[method]({ ...opts, onProgress: report });
      const items = getItems();
      if (typeof Worker === "undefined" || items.length < WORKER_MIN_ITEMS) return local();
      return runInWorker(items, method, opts, report).catch(() => local());
    };
    return {
      reload,
      load: (data) => analysis.load(data),
      clear: () => analysis.clear(),
      neighbours: (ids, opts) => analysis.neighbours(ids, opts),
      degrees: (opts) => analysis.degrees(opts),
      pageRank: (opts) => analysis.pageRank(opts),
      eigenCentrality: (opts) => analysis.eigenCentrality(opts),
      closeness: heavy("closeness"),
      betweenness: heavy("betweenness"),
      distances: (source, opts) => analysis.distances(source, opts),
      components: (opts) => analysis.components(opts),
      clusters: (opts) => analysis.clusters(opts),
      kCores: (opts) => analysis.kCores(opts),
      shortestPaths: (from, to, opts) => analysis.shortestPaths(from, to, opts)
    };
  }
  var MIN_LABEL_PX = 3.8;
  var ZOOM_STEP = 1.4;
  var LABEL_BOX_WIDTH = 1.28;
  var LABEL_MAX_FONT = 1.24;
  var LABEL_LINE_ADVANCE = 1.08;
  var LABEL_BLOCK_LINE = 1.04;
  var LABEL_BASELINE = 0.84;
  function fitLabel(g, text, r, family) {
    const words = text.split(/\s+/).filter(Boolean);
    g.font = `100px ${family}`;
    const width = (line) => g.measureText(line).width / 100;
    let best = { lines: [text], fontPx: 0 };
    const n = words.length;
    if (n === 0) return best;
    const splits = n <= 10 ? 1 << Math.max(0, n - 1) : 0;
    const consider = (lines) => {
      const widest = Math.max(...lines.map(width)) || 1;
      const fontPx = Math.min(LABEL_BOX_WIDTH * r / widest, LABEL_MAX_FONT * r / lines.length);
      if (fontPx > best.fontPx) best = { lines, fontPx };
    };
    for (let mask = 0; mask < splits; mask++) {
      const lines = [];
      let cur = words[0];
      for (let i = 1; i < n; i++) {
        if (mask & 1 << i - 1) {
          lines.push(cur);
          cur = words[i];
        } else cur += ` ${words[i]}`;
      }
      lines.push(cur);
      consider(lines);
    }
    if (splits === 0) consider(words.length ? words : [text]);
    return best;
  }
  function labelText(node) {
    if (!node) return "";
    const t = node.t;
    if (t == null) return "";
    if (typeof t === "string") return t;
    if (Array.isArray(t)) return labelText({ t: t[0] });
    if (typeof t === "object") return typeof t.t === "string" ? t.t : typeof t.text === "string" ? t.text : "";
    return String(t);
  }
  var itemsOf = (data) => asList5(data && !Array.isArray(data) && data.items ? data.items : data);
  function indexItems(items) {
    const nodes = {};
    const links = {};
    itemsOf(items).forEach((item) => {
      if (!item || typeof item !== "object" || item.id == null) return;
      if (item.type === "link") links[item.id] = { ...item };
      else nodes[item.id] = { type: "node", ...item };
    });
    return { nodes, links };
  }
  var imageCache = /* @__PURE__ */ new Map();
  var NOOP = () => {
  };
  function imageSrc(url) {
    let src = url;
    if (globals.paths.images && !/^(data:|blob:|https?:|\/)/.test(src)) src = globals.paths.images.replace(/\/?$/, "/") + src;
    if (globals.corsAdapter) src = globals.corsAdapter(src);
    return src;
  }
  function waitForImages(urls, timeout = 3e3) {
    const unique = [...new Set(urls.filter(Boolean))];
    const waits = unique.map((url) => {
      imageFor(url, NOOP);
      const { img } = imageCache.get(imageSrc(url));
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    });
    const limit = new Promise((resolve) => setTimeout(resolve, timeout));
    return Promise.race([Promise.all(waits), limit]).then(() => unique.filter((url) => {
      const { img } = imageCache.get(imageSrc(url));
      return !(img.complete && img.naturalWidth);
    }));
  }
  function imageFor(url, onLoad) {
    const src = imageSrc(url);
    if (!imageCache.has(src)) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => imageCache.get(src).waiters.splice(0).forEach((fn) => fn());
      img.src = src;
      imageCache.set(src, { img, waiters: [] });
    }
    const entry = imageCache.get(src);
    if (entry.img.complete && entry.img.naturalWidth) return entry.img;
    if (!entry.waiters.includes(onLoad)) entry.waiters.push(onLoad);
    return null;
  }
  function createChart(container, initialOptions, onDestroy) {
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, { width: "100%", height: "100%", display: "block", touchAction: "none", outline: "none" });
    canvas.tabIndex = 0;
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const events = createEmitter();
    let chartOptions = { ...initialOptions };
    let nodes = {};
    let links = {};
    let selection = [];
    let locked = false;
    let destroyed = false;
    const view = { zoom: 1, panX: 0, panY: 0 };
    const camera = createCamera3D();
    let baseFocal = camera.state.focal;
    const is3D = () => !!chartOptions.view3d && !mapMode.isShown();
    const shading3D = () => is3D() && !!(chartOptions.view3d && chartOptions.view3d.shading);
    const labelMin3D = () => {
      const v = chartOptions.view3d && chartOptions.view3d.labelMinRadius;
      return Number.isFinite(v) ? v : 0;
    };
    let fogRange = null;
    function depthFog(depth) {
      if (!fogRange || !(chartOptions.view3d && chartOptions.view3d.fog)) return 1;
      const t = (depth - fogRange.min) / (fogRange.max - fogRange.min || 1);
      return 1 - 0.8 * Math.min(1, Math.max(0, t));
    }
    let pings = [];
    let gesture = null;
    let hoverId = null;
    let pendingLink = null;
    let aggregates = /* @__PURE__ */ new Map();
    let animating = false;
    let animatedFlag = false;
    let animRaf = null;
    let overviewOpen = !!(initialOptions.overview && initialOptions.overview.shown);
    let overviewBox = null;
    let gl = null;
    let glFailed = false;
    let glBatch = null;
    const underlying = () => [
      ...Object.values(nodes).filter((n) => !isComboNode(n)),
      ...Object.values(links)
    ];
    const graphFacade = createGraphFacade(underlying, (task, progress) => events.emit("progress", { task, progress }), { selfLinks: !!initialOptions.selfLinks });
    function changed() {
      graphFacade.reload();
      render();
    }
    const combos = createComboApi({
      nodes: () => nodes,
      links: () => links,
      render: () => render(),
      select: (ids) => {
        selection = ids.slice();
      },
      changed,
      comboShape: () => chartOptions.combos && chartOptions.combos.shape || "circle"
    });
    const mapMode = createMapMode({
      get container() {
        return container;
      },
      canvas,
      nodes: () => nodes,
      render: () => render(),
      emit: (name, props) => events.emit(name, props),
      fit: (transition = {}) => fitTo(Object.keys(nodes), transition),
      assets: () => globals.paths.assets,
      saveView: () => ({ ...view }),
      restoreView: (saved, transition = {}) => setView(saved, transition),
      isDestroyed: () => destroyed
    });
    function viewSize() {
      const rect = container.getBoundingClientRect();
      return { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
    }
    const baseRadius = (node) => (node.e || 1) * DEFAULT_NODE_RADIUS;
    const bgAlpha = () => chartOptions.backgroundAlpha ?? 0.2;
    const selColour = () => chartOptions.selectionColour || "rgb(114, 179, 0)";
    const selFont = () => chartOptions.selectionFontColour || "rgb(255, 255, 255)";
    const itemZoom = (z) => Math.min(z, chartOptions.maxItemZoom ?? Infinity);
    function decoEnv() {
      return {
        fontFamily: chartOptions.fontFamily || "sans-serif",
        iconFontFamily: chartOptions.iconFontFamily,
        imageFor: (url) => imageFor(url, render),
        truncate: (t) => truncate(t, chartOptions.truncateLabels),
        minLabelPx: MIN_LABEL_PX,
        labelOffset: chartOptions.labelOffset || 0,
        now: performance.now(),
        animated: false,
        onAnimated: () => {
          animatedFlag = true;
        }
      };
    }
    function styledNode(node, selected) {
      if (!selected) return node;
      const sel = chartOptions.selectedNode;
      if (sel) return { ...node, ...sel };
      return { ...node, b: selColour(), bw: node.bw ?? DEFAULT_BORDER_WIDTH, fbc: selColour(), fc: selFont() };
    }
    const isBox = (node) => !isComboNode(node) && (node.sh === "box" || node.sh !== "circle" && node.w != null && node.h != null);
    function worldHalf(node) {
      if (isComboNode(node) && node._combo.open) {
        const r2 = openRadius(nodes, node);
        return { w: r2, h: r2 };
      }
      let { w, h } = node;
      if (w === "auto" || h === "auto") {
        const m = labelsSize(ctx, node, decoEnv());
        if (w === "auto") w = m.w;
        if (h === "auto") h = m.h;
      }
      if (isBox(node) && typeof w === "number" && typeof h === "number") {
        return { w: Math.max(w, node.minWidth ?? 0) / 2, h: Math.max(h, node.minHeight ?? 0) / 2 };
      }
      if (typeof h === "number") return { w: h / 2, h: h / 2 };
      const r = baseRadius(node);
      return { w: r, h: r };
    }
    const worldRadius = (node) => {
      const half = worldHalf(node);
      return Math.max(half.w, half.h);
    };
    function toScreen(x, y, v = view, size = viewSize()) {
      return { x: (x + v.panX) * v.zoom + size.w / 2, y: (y + v.panY) * v.zoom + size.h / 2 };
    }
    function toWorld(sx, sy, v = view, size = viewSize()) {
      return { x: (sx - size.w / 2) / v.zoom - v.panX, y: (sy - size.h / 2) / v.zoom - v.panY };
    }
    function placeNode(node, v = view, size = viewSize()) {
      const half = worldHalf(node);
      let p;
      let s;
      let fog = 1;
      if (mapMode.isShown()) {
        p = mapMode.project(node);
        if (!p) return null;
        s = 1;
      } else if (is3D()) {
        p = camera.project(node.x || 0, node.y || 0, node.z || 0, v, size);
        if (!p) return null;
        s = itemZoom(v.zoom) * p.s;
        fog = depthFog(p.depth);
      } else {
        p = toScreen(node.x || 0, node.y || 0, v, size);
        s = itemZoom(v.zoom);
        const minPx = 1.5;
        if (!(chartOptions.zoom && chartOptions.zoom.adaptiveStyling === false) && Math.max(half.w, half.h) * s < minPx) {
          s = minPx / Math.max(half.w, half.h, 1e-6);
        }
      }
      return { x: p.x, y: p.y, r: Math.max(half.w, half.h) * s, hw: half.w * s, hh: half.h * s, s, depth: p.depth ?? 0, fog };
    }
    const visibleIds = () => Object.keys(nodes).filter((id) => isNodeVisible(nodes, id));
    function drawOrder(ids, v, size) {
      fogRange = null;
      if (!is3D()) return ids;
      const depth = new Map(ids.map((id) => [id, placeNode(nodes[id], v, size)?.depth ?? 0]));
      if (depth.size) {
        const all = [...depth.values()];
        fogRange = { min: Math.min(...all), max: Math.max(...all) };
      }
      return [...ids].sort((a, b) => depth.get(b) - depth.get(a));
    }
    function boundsOf(ids) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      ids.forEach((id) => {
        const n = nodes[id];
        if (!n) return;
        const half = worldHalf(n);
        const border = n.b && !isComboNode(n) ? (n.bw ?? DEFAULT_BORDER_WIDTH) * (n.e || 1) : 0;
        minX = Math.min(minX, (n.x || 0) - half.w - border);
        maxX = Math.max(maxX, (n.x || 0) + half.w + border);
        minY = Math.min(minY, (n.y || 0) - half.h - border);
        maxY = Math.max(maxY, (n.y || 0) + half.h + border);
      });
      return minX <= maxX ? { minX, minY, maxX, maxY } : { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    }
    function fitView(ids, size = viewSize(), heightOnly = false, retarget = false) {
      if (is3D()) return fitView3D(ids, size, heightOnly, retarget);
      const b = boundsOf(ids);
      const pad = 0.875;
      const zx = size.w / (b.maxX - b.minX || 1) * pad;
      const zy = size.h / (b.maxY - b.minY || 1) * pad;
      return { zoom: Math.min(heightOnly ? zy : Math.min(zx, zy), 1), panX: -(b.minX + b.maxX) / 2, panY: -(b.minY + b.maxY) / 2 };
    }
    function fitView3D(ids, size, heightOnly, retarget) {
      const list = ids.map((id) => nodes[id]).filter(Boolean);
      if (!list.length) return { zoom: view.zoom, panX: view.panX, panY: view.panY };
      let target;
      if (retarget) {
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        list.forEach((n) => [n.x || 0, n.y || 0, n.z || 0].forEach((c, i) => {
          lo[i] = Math.min(lo[i], c);
          hi[i] = Math.max(hi[i], c);
        }));
        target = { targetX: (lo[0] + hi[0]) / 2, targetY: (lo[1] + hi[1]) / 2, targetZ: (lo[2] + hi[2]) / 2 };
        let reach = 0;
        list.forEach((n) => {
          reach = Math.max(reach, Math.hypot((n.x || 0) - target.targetX, (n.y || 0) - target.targetY, (n.z || 0) - target.targetZ) + worldRadius(n));
        });
        target.focal = Math.max(baseFocal, reach * 2);
      }
      const probe2 = createCamera3D({ ...camera.state, ...target });
      const flat = { zoom: 1, panX: 0, panY: 0 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      list.forEach((n) => {
        const p = probe2.project(n.x || 0, n.y || 0, n.z || 0, flat, { w: 0, h: 0 });
        if (!p) return;
        const r = (worldRadius(n) + (n.b && !isComboNode(n) ? (n.bw ?? DEFAULT_BORDER_WIDTH) * (n.e || 1) : 0)) * p.s;
        minX = Math.min(minX, p.x - r);
        maxX = Math.max(maxX, p.x + r);
        minY = Math.min(minY, p.y - r);
        maxY = Math.max(maxY, p.y + r);
      });
      if (!(minX <= maxX)) return { zoom: view.zoom, panX: view.panX, panY: view.panY, camera: target };
      const pad = 0.875;
      const zx = size.w / (maxX - minX || 1) * pad;
      const zy = size.h / (maxY - minY || 1) * pad;
      return { zoom: Math.min(heightOnly ? zy : Math.min(zx, zy), 1), panX: -(minX + maxX) / 2, panY: -(minY + maxY) / 2, camera: target };
    }
    function sizeCanvas() {
      const { w, h } = viewSize();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w, h };
    }
    function wantGL() {
      if (mapMode.isShown() || chartOptions.gradient || chartOptions.bands) return false;
      if (globals.mode === "webgl") return true;
      return globals.mode === "auto" && Object.keys(nodes).length > GL_AUTO_NODES;
    }
    function render() {
      if (destroyed) return;
      animating = false;
      if (wantGL() && !gl && !glFailed) {
        gl = createGLLayer(container, canvas);
        if (!gl) glFailed = true;
        else {
          const layer = gl;
          layer.canvas.addEventListener("webglcontextlost", () => {
            if (layer.destroyed || gl !== layer) return;
            layer.destroy();
            gl = null;
            glFailed = true;
            render();
          });
        }
      } else if (!wantGL() && gl) {
        gl.destroy();
        gl = null;
      }
      const size = sizeCanvas();
      if (gl) {
        gl.begin(size, chartOptions.backColour || chartOptions.backgroundColour || "#ffffff", is3D(), shading3D());
        glBatch = gl;
      }
      try {
        drawScene(ctx, size, view, { selection: true, overlays: true });
      } finally {
        glBatch = null;
      }
      if (gl) gl.flush();
      if (animating && !animRaf) animRaf = requestAnimationFrame(() => {
        animRaf = null;
        render();
      });
    }
    function drawScene(g, size, v, flags) {
      const sel = new Set(flags.selection ? selection : []);
      const env = decoEnv();
      g.clearRect(0, 0, size.w, size.h);
      if ((!mapMode.isShown() || !flags.overlays) && !glBatch) drawBackground(g, size, chartOptions);
      if (!mapMode.isShown()) {
        drawBands(g, size, chartOptions, (x) => toScreen(x, 0, v, size).x, v.zoom, env);
        if (flags.watermark !== false) drawWatermark(g, size, chartOptions.watermark, env);
      }
      const place = (node) => placeNode(node, v, size);
      const visible = drawOrder(visibleIds(), v, size);
      if (is3D()) env.project = (x, y, z) => camera.project(x, y, z, v, size);
      const shapes = chartOptions.legacyShapeNodeBehaviour ? new Set(visible.filter((id) => !isComboNode(nodes[id]) && typeof nodes[id].w === "number" && typeof nodes[id].h === "number")) : /* @__PURE__ */ new Set();
      shapes.forEach((id) => {
        const p = place(nodes[id]);
        if (p) drawNode(g, nodes[id], p, v, sel.has(id), env);
      });
      const rectCombos = chartOptions.combos && chartOptions.combos.shape === "rectangle";
      const openCombos = visible.filter((id) => isComboNode(nodes[id]) && nodes[id]._combo.open);
      const drawOpenCombo = (id) => {
        const node = nodes[id];
        const p = place(node);
        if (!p) return;
        const os = { ...chartOptions.defaultStyles && chartOptions.defaultStyles.openCombos || {}, ...node._combo.openStyle || {}, ...node.oc || {} };
        g.globalAlpha = node.bg || node._bg ? bgAlpha() : 1;
        g.beginPath();
        if (rectCombos) roundRectPath(g, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2, cornerRadii(os.borderRadius ?? 8).map((x) => x * p.s));
        else g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        g.fillStyle = os.c || "rgba(207,216,220,0.35)";
        g.fill();
        g.strokeStyle = sel.has(id) ? selColour() : os.b || "#90a4ae";
        g.lineWidth = Math.max(1, (os.bw ?? 1) * p.s);
        if (os.bs === "dashed") g.setLineDash([6 * p.s, 4 * p.s]);
        g.stroke();
        g.setLineDash([]);
        const title = os.t != null ? typeof os.t === "string" ? os.t : labelText({ t: os.t }) : labelText(node);
        if (title) drawTextBox(g, title, p.x, p.y - p.r + 14 * p.s, { fs: 14, fc: "#37474f", fbc: "rgba(0,0,0,0)", fb: true }, p.s, env);
        asList5(os.g).forEach((gl2, i) => {
          const at = glyphPosition(gl2, i, p, p.r, p.s);
          drawGlyph(g, gl2, at.x, at.y, DEFAULT_NODE_RADIUS * 0.32 * (gl2.e || 1) * p.s, env);
        });
        const counter = comboCounterGlyph(node);
        if (counter && chartOptions.defaultStyles && chartOptions.defaultStyles.comboGlyphOnOpen) {
          const at = glyphPosition(counter, 0, p, p.r, p.s);
          drawGlyph(g, counter, at.x, at.y, DEFAULT_NODE_RADIUS * 0.32 * (counter.e || 1) * p.s, env);
        }
        g.globalAlpha = 1;
      };
      if (!is3D()) openCombos.forEach(drawOpenCombo);
      if (!is3D()) visible.forEach((id) => {
        const node = nodes[id];
        if (shapes.has(id) || isComboNode(node) && node._combo.open) return;
        const p = place(node);
        if (p) drawHalos(g, styledNode(node, sel.has(id)), p, v);
      });
      const nodeDraws = [];
      visible.forEach((id) => {
        const node = nodes[id];
        if (shapes.has(id) || isComboNode(node) && node._combo.open) return;
        const p = place(node);
        if (!p) return;
        nodeDraws.push({
          // 3D: sorted as if the disc sat on the node's camera side (one radius nearer), as in
          // the ECP engine, so a node covers the ends and arrowheads of its own links.
          depth: is3D() ? p.depth - edgeRadius(node) : p.depth,
          draw: () => {
            if (is3D()) drawHalos(g, styledNode(node, sel.has(id)), p, v);
            drawNode(g, node, p, v, sel.has(id), env);
          }
        });
      });
      if (is3D()) {
        const comboDraws = openCombos.map((id) => ({ depth: (place(nodes[id])?.depth ?? 0) + worldRadius(nodes[id]), draw: () => drawOpenCombo(id) }));
        [...comboDraws, ...drawLinks(g, size, v, sel, place, env, true), ...nodeDraws].sort((p, q) => q.depth - p.depth).forEach((item) => item.draw());
      } else {
        drawLinks(g, size, v, sel, place, env);
        nodeDraws.forEach((item) => item.draw());
      }
      combos.revealed().forEach((lid) => {
        const link = links[lid];
        if (!link || !nodes[link.id1] || !nodes[link.id2]) return;
        [link.id1, link.id2].forEach((nid) => syncChildrenUp(nid));
        const a = place(nodes[link.id1]);
        const b = place(nodes[link.id2]);
        if (!a || !b) return;
        strokeLink(g, link, a, b, 0, v, sel.has(lid), nodes[link.id1], nodes[link.id2], env, false);
        [[nodes[link.id1], a], [nodes[link.id2], b]].forEach(([n, p]) => drawNode(g, n, p, v, sel.has(n.id), env));
      });
      if (flags.logo !== false) drawLogo(g, size, chartOptions.logo, env);
      if (env.animated || animatedFlag) animating = true;
      animatedFlag = false;
      if (!flags.overlays) return;
      const now = performance.now();
      pings.forEach((ping) => {
        const node = nodes[ping.id];
        if (!node) return;
        const p = place(node);
        if (!p) return;
        const t = (now - ping.start) % ping.time / ping.time;
        g.globalAlpha = 1 - t;
        g.beginPath();
        g.arc(p.x, p.y, p.r + (ping.r * t + ping.w) * v.zoom, 0, Math.PI * 2);
        g.strokeStyle = ping.c;
        g.lineWidth = ping.lw * v.zoom;
        g.stroke();
        g.globalAlpha = 1;
      });
      if (gesture && gesture.kind === "marquee" && gesture.moved) {
        const { x0, y0, x1, y1 } = gesture;
        g.fillStyle = "rgba(66,165,245,0.12)";
        g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        g.strokeStyle = "#42a5f5";
        g.lineWidth = 1;
        g.beginPath();
        g.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        g.stroke();
      }
      if (gesture && gesture.kind === "createLink") {
        const src = place(nodes[gesture.source]);
        if (src) {
          g.setLineDash([6, 4]);
          g.strokeStyle = pendingLink && pendingLink.style && pendingLink.style.c || "#555";
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(src.x, src.y);
          g.lineTo(gesture.x1, gesture.y1);
          g.stroke();
          g.setLineDash([]);
        }
      }
      if (!mapMode.isShown()) {
        drawNavigation(g, size, chartOptions);
        const all = visibleIds();
        const viewRect = (() => {
          const tl = toWorld(0, 0, v, size);
          const br = toWorld(size.w, size.h, v, size);
          return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
        })();
        const ov = overviewScene(all);
        overviewBox = drawOverview(g, size, chartOptions, overviewOpen, ov.bounds, viewRect, ov.points);
      }
    }
    function overviewScene(ids) {
      if (!is3D()) return { bounds: boundsOf(ids), points: ids.map((id) => ({ x: nodes[id].x || 0, y: nodes[id].y || 0, c: nodes[id].c })) };
      const flat = { zoom: 1, panX: 0, panY: 0 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const points = [];
      ids.forEach((id) => {
        const n = nodes[id];
        const p = camera.project(n.x || 0, n.y || 0, n.z || 0, flat, { w: 0, h: 0 });
        if (!p) return;
        const r = worldRadius(n) * p.s;
        minX = Math.min(minX, p.x - r);
        maxX = Math.max(maxX, p.x + r);
        minY = Math.min(minY, p.y - r);
        maxY = Math.max(maxY, p.y + r);
        points.push({ x: p.x, y: p.y, c: n.c, depth: p.depth });
      });
      points.sort((a, b) => b.depth - a.depth);
      const bounds = minX <= maxX ? { minX, minY, maxX, maxY } : { minX: -100, minY: -100, maxX: 100, maxY: 100 };
      return { bounds, points };
    }
    function syncChildrenUp(id) {
      const chain = [];
      let n = nodes[id];
      while (n && n.parentId != null && nodes[n.parentId]) {
        chain.unshift(n.parentId);
        n = nodes[n.parentId];
      }
      if (chain.length) syncChildren(nodes, chain[0]);
    }
    const linkDirection = (l) => l.a1 && l.a2 ? "both" : l.a2 ? "from" : l.a1 ? "to" : "none";
    function drawLinks(g, size, v, sel, place, env, collect = false) {
      const drawn = [];
      Object.values(links).forEach((link) => {
        if (link.hi || !nodes[link.id1] || !nodes[link.id2]) return;
        const e1 = visibleEnd(nodes, link.id1);
        const e2 = visibleEnd(nodes, link.id2);
        if (e1 === e2 || !isNodeVisible(nodes, e1) || !isNodeVisible(nodes, e2)) return;
        drawn.push({ link, e1, e2, rerouted: e1 !== link.id1 || e2 !== link.id2 });
      });
      const before = aggregates;
      aggregates = /* @__PURE__ */ new Map();
      let list = drawn;
      const agg = chartOptions.aggregateLinks;
      if (agg) {
        const by = typeof agg === "object" ? agg.aggregateBy : void 0;
        const byDir = typeof agg === "object" && agg.aggregateByDirection;
        const groups = /* @__PURE__ */ new Map();
        list = [];
        drawn.forEach((d) => {
          const value = by ? d.link.d && d.link.d[by] : void 0;
          if (by && value === void 0) {
            list.push(d);
            return;
          }
          const [id1, id2] = d.e1 < d.e2 ? [d.e1, d.e2] : [d.e2, d.e1];
          let dir = byDir ? linkDirection(d.link) : void 0;
          if (dir && d.e1 !== id1) dir = dir === "from" ? "to" : dir === "to" ? "from" : dir;
          const key = `${id1}|${id2}|${by ? String(value) : ""}|${dir || ""}`;
          if (!groups.has(key)) groups.set(key, { id1, id2, value, dir, members: [] });
          groups.get(key).members.push(d);
        });
        groups.forEach((group, key) => {
          const { members } = group;
          const id = `_agg:${key}`;
          const children = members.map((m) => m.link.id);
          const fwd = members.some((m) => m.link.a2 || m.link.a1);
          aggregates.set(id, { id, id1: group.id1, id2: group.id2, children, directed: fwd, value: group.value, dir: group.dir, by });
          const first = members[0];
          list.push({
            link: { ...first.link, id, w: Math.max(...members.map((m) => m.link.w || 1)) + Math.log2(members.length), t: members.length > 1 ? String(members.length) : first.link.t },
            e1: first.e1,
            e2: first.e2,
            rerouted: first.rerouted,
            aggregateOf: children
          });
        });
      }
      if (agg || before.size) {
        const emitAgg = (a, change) => events.emit("link-aggregation", {
          id: a.id,
          id1: a.id1,
          id2: a.id2,
          links: a.children.slice(),
          change,
          aggregateByValue: a.by ? a.value : void 0,
          aggregateByDirection: a.dir
        });
        aggregates.forEach((a, id) => {
          const old = before.get(id);
          if (!old) emitAgg(a, "created");
          else if (old.children.join() !== a.children.join()) emitAgg(a, "updated");
        });
        before.forEach((a, id) => {
          if (!aggregates.has(id)) emitAgg(a, "deleted");
        });
      }
      const pairs = new Set(list.map((d) => `${d.e1}\0${d.e2}`));
      const queue = [];
      list.forEach(({ link, e1, e2, aggregateOf, rerouted }) => {
        const a = place(nodes[e1]);
        const b = place(nodes[e2]);
        if (!a || !b) return;
        const bow = pairs.has(`${e2}\0${e1}`) ? 1 : 0;
        const selected = sel.has(link.id) || aggregateOf && aggregateOf.some((id) => sel.has(id));
        const draw = () => strokeLink(g, link, a, b, bow, v, selected, nodes[e1], nodes[e2], env, rerouted);
        if (collect) queue.push({ depth: (a.depth + b.depth) / 2, draw });
        else draw();
      });
      return queue;
    }
    const ARROW_SCALE = { normal: 1, small: 0.7, large: 1.4, xlarge: 1.8 };
    const edgeRadius = (node) => worldRadius(node) + (node.b && !(node.donut && node.donut.v) ? (node.bw ?? DEFAULT_BORDER_WIDTH) * (node.e || 1) : 0);
    function linkExit(n1, n2, sign, project, outside) {
      const A = [n1.x || 0, n1.y || 0, n1.z || 0];
      const B = [n2.x || 0, n2.y || 0, n2.z || 0];
      const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
      if (len < 1e-6) return null;
      const [centre, node, other] = sign > 0 ? [B, n2, A] : [A, n1, B];
      const away = centre.map((c, i) => (other[i] - c) / len);
      const point = (d) => centre.map((c, i) => c + away[i] * d);
      let lo = edgeRadius(node);
      if (lo >= len) return null;
      let q = project(...point(lo));
      if (!q) return null;
      if (!outside(q)) {
        let hi = len;
        const far = project(...point(hi));
        if (!far || !outside(far)) return null;
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          const m = project(...point(mid));
          if (!m || outside(m)) hi = mid;
          else lo = mid;
        }
        lo = hi;
        q = project(...point(lo));
        if (!q) return null;
      }
      return { at: point(lo), q, dir: away.map((c) => -c), d: lo, len, point };
    }
    function coneHead(link, n1, n2, w, project) {
      const length = (8 + 1.556 * w) * (ARROW_SCALE[chartOptions.arrows] || 1);
      return (sign, outside) => {
        const exit = linkExit(n1, n2, sign, project, outside);
        if (!exit) return null;
        const coneAt = (d) => coneOutline(project, exit.point(d), exit.dir, length, length * 0.5);
        const clear = (c) => c && c.outline.every(outside);
        const first = coneAt(exit.d);
        if (clear(first)) return first;
        let lo = exit.d;
        let hi = exit.len;
        if (!clear(coneAt(hi))) return null;
        for (let k = 0; k < 20; k++) {
          const mid = (lo + hi) / 2;
          if (clear(coneAt(mid))) hi = mid;
          else lo = mid;
        }
        return coneAt(hi);
      };
    }
    function strokeLink(g, rawLink, a, b, bow, v, selected, n1, n2, outerEnv, rerouted) {
      const env = fullOnHover(rawLink.id, outerEnv);
      let link = rawLink;
      if (rerouted && chartOptions.defaultStyles && chartOptions.defaultStyles.comboLinks) link = { ...link, ...chartOptions.defaultStyles.comboLinks };
      if (selected) link = chartOptions.selectedLink ? { ...link, ...chartOptions.selectedLink } : { ...link, c: selColour(), fbc: selColour(), fc: selFont() };
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1) return;
      const s = a.s ?? v.zoom;
      const w = link.w || 1;
      const path = link._path || chartOptions.linkStyle && chartOptions.linkStyle.path || "direct";
      let at;
      let straight = false;
      if (path === "horizontal" || path === "vertical") {
        const h = path === "horizontal";
        const c1 = h ? { x: (a.x + b.x) / 2, y: a.y } : { x: a.x, y: (a.y + b.y) / 2 };
        const c2 = h ? { x: (a.x + b.x) / 2, y: b.y } : { x: b.x, y: (a.y + b.y) / 2 };
        at = (t) => {
          const u = 1 - t;
          return {
            x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
            y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y
          };
        };
      } else {
        const bend = (link.off != null ? link.off : bow ? 40 : 0) * v.zoom;
        straight = bend === 0;
        const cx = (a.x + b.x) / 2 + (b.y - a.y) / len * bend;
        const cy = (a.y + b.y) / 2 - (b.x - a.x) / len * bend;
        at = (t) => ({
          x: (1 - t) * (1 - t) * a.x + 2 * t * (1 - t) * cx + t * t * b.x,
          y: (1 - t) * (1 - t) * a.y + 2 * t * (1 - t) * cy + t * t * b.y
        });
      }
      const N = straight ? 1 : Math.min(64, Math.max(4, Math.ceil(len / 6)));
      const pts = [];
      const cum = [0];
      for (let i = 0; i <= N; i++) {
        pts.push(at(i / N));
        if (i) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      }
      const total = cum[N];
      const atArc = (d) => {
        const t = Math.min(total, Math.max(0, d));
        let i = 1;
        while (i < N && cum[i] < t) i++;
        const f = (t - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const dl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
        return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f, ux: (p1.x - p0.x) / dl, uy: (p1.y - p0.y) / dl };
      };
      const arcAtDistance = (fromB, dist) => {
        const end = fromB ? b : a;
        if (fromB) {
          for (let i = N; i > 0; i--) {
            if (Math.hypot(pts[i - 1].x - end.x, pts[i - 1].y - end.y) > dist) {
              const d0 = Math.hypot(pts[i].x - end.x, pts[i].y - end.y);
              const d1 = Math.hypot(pts[i - 1].x - end.x, pts[i - 1].y - end.y);
              return cum[i] - (dist - d0) / (d1 - d0 || 1) * (cum[i] - cum[i - 1]);
            }
          }
          return 0;
        }
        for (let i = 0; i < N; i++) {
          if (Math.hypot(pts[i + 1].x - end.x, pts[i + 1].y - end.y) > dist) {
            const d0 = Math.hypot(pts[i].x - end.x, pts[i].y - end.y);
            const d1 = Math.hypot(pts[i + 1].x - end.x, pts[i + 1].y - end.y);
            return cum[i] + (dist - d0) / (d1 - d0 || 1) * (cum[i + 1] - cum[i]);
          }
        }
        return total;
      };
      const loose = chartOptions.linkEnds && chartOptions.linkEnds.spacing === "loose" ? 4 * s : 0;
      const outerOf = (end, node, ux, uy) => {
        const base2 = isBox(node) && end.hw != null ? Math.min(end.hw / Math.max(Math.abs(ux), 1e-6), end.hh / Math.max(Math.abs(uy), 1e-6)) : end.r;
        const border = node.b && !(node.donut && node.donut.v) ? (node.bw ?? DEFAULT_BORDER_WIDTH) * (node.e || 1) * s : 0;
        const labelBelow = labelText(node) && (node.tc === false || node.tc === void 0 && node.u);
        const avoid = labelBelow && !(chartOptions.linkEnds && chartOptions.linkEnds.avoidLabels === false) && uy > 0.7;
        const labelDrop = avoid ? (node.fs || 14) * 1.8 * s : 0;
        return base2 + border + loose + labelDrop;
      };
      let alpha = link.bg || link._bg || n1.bg || n1._bg || n2.bg || n2._bg ? bgAlpha() : 1;
      alpha *= ((a.fog ?? 1) + (b.fog ?? 1)) / 2;
      if (!(chartOptions.zoom && chartOptions.zoom.adaptiveStyling === false) && v.zoom < 0.1) alpha *= Math.max(0.25, v.zoom / 0.1);
      g.globalAlpha = alpha;
      const arrows = chartOptions.arrows !== "none";
      const head = (8 + 1.556 * w) * s * (ARROW_SCALE[chartOptions.arrows] || 1);
      const startBack = (link.b1 || 0) * total;
      const endBack = (link.b2 || 0) * total;
      let from = startBack;
      let to = total - endBack;
      const heads = [];
      const outsideDisc = (fromB) => {
        const end = fromB ? b : a;
        const at2 = atArc(fromB ? total : 0);
        const r = outerOf(end, fromB ? n2 : n1, fromB ? -at2.ux : at2.ux, fromB ? -at2.uy : at2.uy);
        return (q) => Math.hypot(q.x - end.x, q.y - end.y) >= r;
      };
      const cone = arrows && straight && env.project && (link.a1 || link.a2) ? coneHead(link, n1, n2, w, env.project) : null;
      if (arrows && link.a2) {
        const c3 = !link.b2 && cone && cone(1, outsideDisc(true));
        if (c3) {
          heads.push({ outline: c3.outline, colour: link.c2 || link.c });
          to = Math.hypot(c3.base.x - a.x, c3.base.y - a.y) + 0.5;
        } else {
          const tipArc = link.b2 ? to : arcAtDistance(true, outerOf(b, n2, -atArc(total).ux, -atArc(total).uy));
          heads.push({ tip: atArc(tipArc), base: atArc(tipArc - head), colour: link.c2 || link.c });
          to = tipArc - head + 0.5;
        }
      }
      if (arrows && link.a1) {
        const c3 = !link.b1 && cone && cone(-1, outsideDisc(false));
        if (c3) {
          heads.push({ outline: c3.outline, colour: link.c });
          from = Math.hypot(c3.base.x - a.x, c3.base.y - a.y) - 0.5;
        } else {
          const tipArc = link.b1 ? from : arcAtDistance(false, outerOf(a, n1, atArc(0).ux, atArc(0).uy));
          heads.push({ tip: atArc(tipArc), base: atArc(tipArc + head), colour: link.c });
          from = tipArc + head - 0.5;
        }
      }
      if (env.project) {
        const edgeArc = (node, fromB) => {
          const exit = straight && linkExit(n1, n2, fromB ? 1 : -1, env.project, outsideDisc(fromB));
          if (exit) return Math.hypot(exit.q.x - a.x, exit.q.y - a.y);
          const at2 = atArc(fromB ? total : 0);
          return arcAtDistance(fromB, outerOf(fromB ? b : a, node, fromB ? -at2.ux : at2.ux, fromB ? -at2.uy : at2.uy));
        };
        if (!(arrows && link.a1) && !link.b1) from = edgeArc(n1, false);
        if (!(arrows && link.a2) && !link.b2) to = edgeArc(n2, true);
      }
      const colour = link.c || "#bcced8";
      let stroke = colour;
      if (link.c2 && typeof g.createLinearGradient === "function") {
        const tr = Math.min(1, Math.max(0, (chartOptions.linkStyle && chartOptions.linkStyle.transition) ?? 1));
        const grad = g.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, colour);
        grad.addColorStop(Math.max(0, 0.5 - tr / 2), colour);
        grad.addColorStop(Math.min(1, 0.5 + tr / 2), link.c2);
        grad.addColorStop(1, link.c2);
        stroke = grad;
      }
      g.strokeStyle = stroke;
      g.lineWidth = Math.max(0.5, w * s);
      const flow = link.flow ? typeof link.flow === "object" ? link.flow.velocity ?? 2 : 2 : 0;
      if (flow) {
        g.setLineDash([10 * s, 6 * s]);
        g.lineDashOffset = -(env.now / 1e3 * flow * 30 * s) % (16 * s);
        animatedFlag = true;
      } else if (link.ls === "dashed") g.setLineDash([8 * s, 6 * s]);
      else if (link.ls === "dotted") g.setLineDash([2 * s, 4 * s]);
      if (to > from && glBatch && !flow && !link.ls) {
        const c1 = parseColour(colour);
        const c2 = parseColour(link.c2 || colour);
        const tr = Math.min(1, Math.max(0, (chartOptions.linkStyle && chartOptions.linkStyle.transition) ?? 1));
        const mix = (f) => {
          const k = link.c2 ? Math.min(1, Math.max(0, (f - (0.5 - tr / 2)) / (tr || 1e-6))) : 0;
          return c1.map((v2, i) => v2 + (c2[i] - v2) * k);
        };
        const stops = [from, ...cum.filter((c) => c > from && c < to), to];
        for (let i = 1; i < stops.length; i++) {
          const q0 = atArc(stops[i - 1]);
          const q1 = atArc(stops[i]);
          glBatch.line(q0.x, q0.y, q1.x, q1.y, g.lineWidth, mix(stops[i - 1] / total), mix(stops[i] / total), g.globalAlpha);
        }
      } else if (to > from) {
        g.beginPath();
        const p0 = atArc(from);
        g.moveTo(p0.x, p0.y);
        for (let i = 1; i < N; i++) if (cum[i] > from && cum[i] < to) g.lineTo(pts[i].x, pts[i].y);
        const p1 = atArc(to);
        g.lineTo(p1.x, p1.y);
        g.stroke();
      }
      g.setLineDash([]);
      g.lineDashOffset = 0;
      heads.forEach(({ tip, base: base2, outline, colour: c }) => {
        g.fillStyle = link.c2 ? c || colour : colour;
        if (outline) {
          g.beginPath();
          outline.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y));
          g.closePath();
          g.fill();
          return;
        }
        const hl = Math.hypot(tip.x - base2.x, tip.y - base2.y) || 1;
        const ux = (tip.x - base2.x) / hl;
        const uy = (tip.y - base2.y) / hl;
        const bx = tip.x - ux * head;
        const by = tip.y - uy * head;
        g.beginPath();
        g.moveTo(tip.x, tip.y);
        g.lineTo(bx - uy * head * 0.5, by + ux * head * 0.5);
        g.lineTo(bx + uy * head * 0.5, by - ux * head * 0.5);
        g.closePath();
        g.fillStyle = link.c2 ? c || colour : colour;
        g.fill();
      });
      const style = { fs: link.fs || 14, fc: link.fc, fbc: link.fbc, ff: link.ff, fb: link.fb };
      const inline = chartOptions.linkStyle && chartOptions.linkStyle.inline;
      const mid = atArc(total / 2);
      const angleOf = (p) => {
        if (!inline) return 0;
        let ang = Math.atan2(p.uy, p.ux);
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        return ang;
      };
      const label = labelText(link);
      if (label) drawTextBox(g, label, mid.x, mid.y, style, s, env, angleOf(mid));
      const glyphs = asList5(link.g);
      if (glyphs.length) {
        const gr = 10 * s;
        const along = chartOptions.linkStyle && chartOptions.linkStyle.glyphs === "along" && !label;
        const ux = along ? mid.ux : 1;
        const uy = along ? mid.uy : 0;
        let off = label ? 0 : -((glyphs.length - 1) * gr * 1.1);
        if (label) {
          g.font = `${(link.fs || 14) * s}px ${link.ff || env.fontFamily}`;
          off += g.measureText(label).width / 2 + gr + 4;
        }
        glyphs.forEach((gl2) => {
          drawGlyph(g, gl2, mid.x + ux * off, mid.y + uy * off, gr * (gl2.e || 1), env);
          off += gr * 2.2;
        });
      }
      [["t1", 0.18], ["t2", 0.82]].forEach(([key, frac]) => {
        const t = link[key];
        if (t == null) return;
        const p = atArc(total * frac);
        const obj = typeof t === "string" ? { t } : t;
        drawTextBox(g, obj.t ?? "", p.x, p.y, { ...style, ...obj }, s, env, angleOf(p));
        asList5(obj.g).forEach((gl2, i) => drawGlyph(g, gl2, p.x + (i + 1) * 22 * s, p.y, 10 * s, env));
      });
      if (link.bu) drawBubble(g, link.bu, mid.x, mid.y, s, env);
      g.globalAlpha = 1;
    }
    function drawHalos(g, node, p, v) {
      g.globalAlpha = (node.bg || node._bg ? bgAlpha() : 1) * (p.fog ?? 1);
      for (let i = 0; i < 10; i++) {
        const halo = node[`ha${i}`];
        if (!halo || !halo.c) continue;
        const e = node.e || 1;
        const s = p.s ?? v.zoom;
        if (glBatch) {
          glBatch.ring(p.x, p.y, (halo.r || 34) * e * s, (halo.w || 6) * e * s, halo.c, g.globalAlpha);
          continue;
        }
        g.beginPath();
        g.arc(p.x, p.y, (halo.r || 34) * e * s, 0, Math.PI * 2);
        g.strokeStyle = halo.c;
        g.lineWidth = (halo.w || 6) * e * s;
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    function comboCounterGlyph(node) {
      if (!isComboNode(node)) return null;
      const own = node._combo.glyph;
      const dflt = chartOptions.defaultStyles && "comboGlyph" in chartOptions.defaultStyles ? chartOptions.defaultStyles.comboGlyph : {};
      const base2 = own !== void 0 ? own : dflt;
      if (base2 === null) return null;
      const count = descendants(nodes, node.id).filter((id) => !isComboNode(nodes[id])).length;
      return { c: "#e53935", fc: "#ffffff", p: "ne", t: String(count), ...base2 };
    }
    const fullOnHover = (id, env) => id === hoverId && chartOptions.truncateLabels && chartOptions.truncateLabels.showOnHover !== false ? { ...env, truncate: (t) => t } : env;
    function drawNode(g, rawNode, p, v, selected, outerEnv) {
      const env = fullOnHover(rawNode.id, outerEnv);
      let node = styledNode(rawNode, selected);
      const s = p.s ?? v.zoom;
      const r = p.r;
      const hw = p.hw ?? r;
      const hh = p.hh ?? r;
      g.globalAlpha = (node.bg || node._bg ? bgAlpha() : 1) * (p.fog ?? 1);
      if (node.du) {
        g.beginPath();
        g.arc(p.x, p.y, Math.max(2, 5 * s), 0, Math.PI * 2);
        g.fillStyle = node.c || "#757575";
        g.fill();
        g.globalAlpha = 1;
        return;
      }
      const box = isBox(node);
      const radii = box ? cornerRadii(node.borderRadius).map((x) => x * s) : null;
      const shape = (grow = 0) => {
        g.beginPath();
        if (box) roundRectPath(g, p.x - hw - grow, p.y - hh - grow, (hw + grow) * 2, (hh + grow) * 2, radii.map((x) => x ? x + grow : 0));
        else g.arc(p.x, p.y, r + grow, 0, Math.PI * 2);
      };
      const donut = !box && node.donut && node.donut.v;
      const hasBorder = !donut && (node.b || isComboNode(node));
      const lw = hasBorder ? Math.max(1, (node.bw ?? DEFAULT_BORDER_WIDTH) * (node.e || 1) * s) : 0;
      const glBody = glBatch && !donut && node.bs !== "dashed" && !(box && radii.some(Boolean));
      if (glBody) {
        glBatch.disc(p.x, p.y, hw, hh, box, node.c || (isComboNode(node) ? "#cfd8dc" : "rgba(0,0,0,0)"), node.b || "#90a4ae", lw, g.globalAlpha);
      } else if (hasBorder) {
        g.fillStyle = node.b || "#90a4ae";
        if (node.bs === "dashed") {
          g.strokeStyle = g.fillStyle;
          g.lineWidth = lw;
          g.setLineDash([6 * s, 4 * s]);
          shape(lw / 2);
          g.stroke();
          g.setLineDash([]);
        } else {
          shape(lw);
          g.fill();
        }
      }
      if (!glBody) {
        shape();
        g.fillStyle = node.c || (isComboNode(node) ? "#cfd8dc" : "rgba(0,0,0,0)");
        g.fill();
      }
      if (donut) drawDonut(g, node.donut, p, r, s);
      const align = (key) => chartOptions.imageAlignment && chartOptions.imageAlignment[key] || {};
      if (node.u && typeof g.drawImage === "function") {
        const img = imageFor(node.u, render);
        if (img) {
          const al = align(node.u);
          const k = al.e ?? 1;
          const ox = (al.dx || 0) / 100 * hw * 2;
          const oy = (al.dy || 0) / 100 * hh * 2;
          g.save();
          if (node.ci) {
            g.beginPath();
            g.arc(p.x, p.y, Math.min(hw, hh), 0, Math.PI * 2);
          } else shape();
          g.clip();
          g.drawImage(img, p.x - hw * k + ox, p.y - hh * k + oy, hw * 2 * k, hh * 2 * k);
          g.restore();
        }
      }
      if (shading3D() && !box && !glBody && !donut && typeof g.createRadialGradient === "function") {
        const light = g.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.05, p.x, p.y, r);
        light.addColorStop(0, "rgba(255,255,255,0.55)");
        light.addColorStop(0.35, "rgba(255,255,255,0.12)");
        light.addColorStop(0.75, "rgba(0,0,0,0.06)");
        light.addColorStop(1, "rgba(0,0,0,0.38)");
        shape();
        g.fillStyle = light;
        g.fill();
      }
      if (node.fi && node.fi.t != null) {
        const ch = typeof node.fi.t === "number" ? String.fromCodePoint(node.fi.t) : String(node.fi.t);
        const al = align(node.fi.t);
        g.fillStyle = node.fi.c || "#000";
        g.font = `${Math.min(hw, hh) * 1.1 * (al.e ?? 1)}px ${node.fi.ff || chartOptions.iconFontFamily || "sans-serif"}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(ch, p.x + (al.dx || 0) / 100 * hw * 2, p.y + (al.dy || 0) / 100 * hh * 2);
      }
      if (node.re && box) {
        g.fillStyle = "#ffffff";
        g.strokeStyle = "#616161";
        g.lineWidth = 1;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([dx, dy]) => {
          g.beginPath();
          g.rect(p.x + dx * hw - 4, p.y + dy * hh - 4, 8, 8);
          g.fill();
          g.stroke();
        });
      }
      const drawGlyphs = () => {
        const list = asList5(node.g).slice();
        const counter = comboCounterGlyph(node);
        if (counter) list.push(counter);
        list.forEach((glyph, i) => {
          if (!glyph) return;
          const at = glyphPosition(glyph, i, p, box ? Math.hypot(hw, hh) * 0.75 : r, s);
          drawGlyph(g, glyph, at.x, at.y, Math.min(hw, hh) * 0.32 * (glyph.e || 1), env);
        });
      };
      const drawLabels = () => {
        const one = Array.isArray(node.t) && node.t.length === 1 ? node.t[0] : node.t;
        const simple = one && typeof one === "object" && one.fs === "auto" && !one.position && !one.fi && !one.padding && !one.b;
        if (node.t != null && typeof node.t === "object" && !simple) {
          drawLabelObjects(g, node, p, { w: hw, h: hh }, s, env);
          return;
        }
        if (simple) node = { ...node, fc: one.fc ?? node.fc, fb: one.fb ?? node.fb, ff: one.ff ?? node.ff, fbc: one.fbc ?? node.fbc, t: one.t };
        const label = env.truncate(labelText(node));
        if (!label) return;
        const family = node.ff || chartOptions.fontFamily || "sans-serif";
        const offset = (chartOptions.labelOffset || 0) * s;
        const below = node.tc === false || node.tc === void 0 && node.u;
        if (below) {
          drawTextBox(g, label, p.x, p.y + hh + (node.fs || 14) * s * 0.8 + offset, { fs: node.fs || 14, fc: node.fc || "#000", fbc: node.fbc, ff: family, fb: node.fb }, s, env);
          return;
        }
        let lines;
        let fontPx;
        if (node.fs) {
          lines = label.split(/\r\n|\r|\n/);
          fontPx = node.fs * s;
        } else ({ lines, fontPx } = fitLabel(g, label, Math.min(hw, hh), family));
        if (fontPx < MIN_LABEL_PX) return;
        g.font = `${node.fb ? "bold " : ""}${fontPx}px ${family}`;
        if (node.fbc) {
          const wMax = Math.max(...lines.map((l) => g.measureText(l).width));
          const hTot = lines.length * LABEL_LINE_ADVANCE * fontPx;
          g.fillStyle = node.fbc;
          g.fillRect(p.x - wMax / 2 - 2, p.y - hTot / 2 + offset, wMax + 4, hTot);
        }
        g.fillStyle = node.fc || (isComboNode(node) ? "#37474f" : "#000000");
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        const top = -lines.length * LABEL_BLOCK_LINE / 2 + LABEL_BASELINE;
        lines.forEach((line, i) => g.fillText(line, p.x, p.y + (top + i * LABEL_LINE_ADVANCE) * fontPx + offset));
      };
      const labels = !is3D() || selected || r >= labelMin3D() ? drawLabels : () => {
      };
      if (chartOptions.legacyGlyphAndLabelOrdering === false) {
        labels();
        drawGlyphs();
      } else {
        drawGlyphs();
        labels();
      }
      if (node.bu) {
        const dir = COMPASS[node.bu.p || "ne"];
        drawBubble(g, node.bu, p.x + dir[0] * hw, p.y + dir[1] * hh, s, env);
      }
      g.globalAlpha = 1;
    }
    function hitTest(sx, sy) {
      const size = viewSize();
      const visible = visibleIds();
      let best = null;
      let bestD = Infinity;
      visible.forEach((id) => {
        const node = nodes[id];
        if (isComboNode(node) && node._combo.open) return;
        const p = placeNode(node, view, size);
        if (!p) return;
        const inside = isBox(node) ? Math.abs(p.x - sx) <= p.hw && Math.abs(p.y - sy) <= p.hh : Math.hypot(p.x - sx, p.y - sy) <= p.r;
        const d = is3D() ? p.depth : Math.hypot(p.x - sx, p.y - sy);
        if (inside && d < bestD) {
          bestD = d;
          best = id;
        }
      });
      if (best) return best;
      let linkHit = null;
      let linkD = 6;
      Object.values(links).forEach((link) => {
        if (link.hi || !nodes[link.id1] || !nodes[link.id2]) return;
        const e1 = visibleEnd(nodes, link.id1);
        const e2 = visibleEnd(nodes, link.id2);
        if (e1 === e2 || !isNodeVisible(nodes, e1) || !isNodeVisible(nodes, e2)) return;
        const a = placeNode(nodes[e1], view, size);
        const b = placeNode(nodes[e2], view, size);
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(a.x + t * dx - sx, a.y + t * dy - sy);
        if (d < linkD) {
          linkD = d;
          linkHit = link.id;
        }
      });
      if (linkHit) return linkHit;
      visible.forEach((id) => {
        const node = nodes[id];
        if (!(isComboNode(node) && node._combo.open)) return;
        const p = placeNode(node, view, size);
        if (p && Math.hypot(p.x - sx, p.y - sy) <= p.r) best = id;
      });
      return best;
    }
    let viewAnim = null;
    const MAX_ZOOM = 16;
    const clampZoom = (z) => Math.min(Math.max(z, chartOptions.minZoom ?? 0.05), MAX_ZOOM);
    function setView(rawTarget, opts = {}) {
      const { camera: camTo, ...target } = { ...rawTarget, zoom: clampZoom(rawTarget.zoom) };
      if (viewAnim) {
        cancelAnimationFrame(viewAnim.raf);
        viewAnim.resolve();
        viewAnim = null;
      }
      if (!opts.animate) {
        if (camTo) camera.set(camTo);
        Object.assign(view, target);
        render();
        events.emit("view-change");
        return Promise.resolve();
      }
      const from = { ...view };
      const camFrom = camera.state;
      const time = opts.time ?? 250;
      const start = performance.now();
      return new Promise((resolve) => {
        viewAnim = { resolve, raf: 0 };
        const frame = (now) => {
          const k = Math.min(1, Math.max(0, (now - start) / time));
          const e = k * k * (3 - 2 * k);
          view.zoom = from.zoom * Math.pow(target.zoom / from.zoom, e);
          view.panX = from.panX + (target.panX - from.panX) * e;
          view.panY = from.panY + (target.panY - from.panY) * e;
          if (camTo) {
            const step = {};
            Object.keys(camTo).forEach((k2) => {
              if (Number.isFinite(camTo[k2])) step[k2] = camFrom[k2] + (camTo[k2] - camFrom[k2]) * e;
            });
            camera.set(step);
          }
          render();
          if (k < 1) viewAnim.raf = requestAnimationFrame(frame);
          else {
            viewAnim = null;
            events.emit("view-change");
            resolve();
          }
        };
        viewAnim.raf = requestAnimationFrame(frame);
      });
    }
    function fitTo(ids, opts, heightOnly = false) {
      if (mapMode.isShown()) {
        mapMode.fit();
        return Promise.resolve();
      }
      return setView(fitView(ids.length ? ids : visibleIds(), viewSize(), heightOnly, true), opts);
    }
    const ORBIT_STEP = Math.PI / 8;
    function orbitStep(direction) {
      const d = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[direction];
      if (!d) return Promise.resolve();
      const c = camera.state;
      return setView({ ...view, camera: { yaw: c.yaw + d[0] * ORBIT_STEP, pitch: c.pitch + d[1] * ORBIT_STEP } }, { animate: true, time: 200 });
    }
    function zoomAround(sx, sy, factor, opts) {
      const before = toWorld(sx, sy);
      const zoom = clampZoom(view.zoom * factor);
      const size = viewSize();
      const panX = (sx - size.w / 2) / zoom - before.x;
      const panY = (sy - size.h / 2) / zoom - before.y;
      return setView({ zoom, panX, panY }, opts);
    }
    function afterMove(node) {
      if (isComboNode(node)) syncChildren(nodes, node.id);
      const parent = nodes[node.parentId];
      if (parent && isComboNode(parent) && parent._combo.offsets[node.id]) {
        Object.assign(parent._combo.offsets[node.id], comboOffset(parent, node));
      }
    }
    let animationQueue = Promise.resolve();
    function animateProperties(items, opts = {}) {
      const settings = { time: 500, queue: true, easing: "linear", ...opts };
      if (!settings.queue) return runAnimation(items, settings);
      const run = animationQueue.then(() => runAnimation(items, settings));
      animationQueue = run.catch(() => {
      });
      return run;
    }
    function runAnimation(items, settings) {
      const list = asList5(items);
      const startAt = performance.now();
      const tweens = list.map((update) => {
        const target = update && (nodes[update.id] || links[update.id]);
        if (!target) return null;
        const numeric = {};
        ["e", "w", "x", "y", "z"].forEach((key) => {
          if (typeof update[key] === "number") numeric[key] = { from: target[key] ?? (key === "e" || key === "w" ? 1 : 0), to: update[key] };
        });
        Object.keys(update).forEach((key) => {
          if (key === "id" || key in numeric) return;
          target[key] = update[key];
        });
        return { target, numeric };
      }).filter(Boolean);
      return new Promise((resolve, reject) => {
        function frame(now) {
          try {
            step(now);
          } catch (err) {
            reject(err);
          }
        }
        function step(now) {
          const t = settings.time > 0 ? Math.min(1, Math.max(0, (now - startAt) / settings.time)) : 1;
          const ease = settings.easing === "cubic" ? t * t * (3 - 2 * t) : t;
          tweens.forEach(({ target, numeric }) => {
            Object.keys(numeric).forEach((key) => {
              const { from, to } = numeric[key];
              target[key] = from + (to - from) * ease;
            });
            if (target.type !== "link") afterMove(target);
          });
          render();
          if (t < 1) requestAnimationFrame(frame);
          else resolve();
        }
        requestAnimationFrame(frame);
      });
    }
    function moveNodes(targets, opts = {}) {
      const updates = Object.keys(targets).map((id) => {
        const u = { id, x: targets[id].x, y: targets[id].y };
        if (typeof targets[id].z === "number") u.z = targets[id].z;
        return u;
      });
      if (opts.animate === false) {
        updates.forEach((u) => {
          Object.assign(nodes[u.id], u);
          afterMove(nodes[u.id]);
        });
        render();
        return Promise.resolve();
      }
      return runAnimation(updates, { time: opts.time ?? 500, easing: opts.easing || "cubic" });
    }
    function pointerProps(evt, id) {
      const rect = canvas.getBoundingClientRect();
      return {
        id: id ?? null,
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top,
        button: evt.button ?? 0,
        pointerType: evt.pointerType || "mouse",
        pointerId: evt.pointerId ?? 1,
        subItem: {},
        modifierKeys: { alt: evt.altKey, ctrl: evt.ctrlKey, meta: evt.metaKey, shift: evt.shiftKey, consistentCtrl: navigator.platform?.startsWith("Mac") ? evt.metaKey : evt.ctrlKey }
      };
    }
    function setSelection(ids, fromUser) {
      const next = asList5(ids).filter((id) => nodes[id] || links[id]);
      const same = next.length === selection.length && next.every((id, i) => id === selection[i]);
      selection = next;
      render();
      if (fromUser && !same) events.emit("selection-change");
    }
    canvas.addEventListener("pointerdown", (evt) => {
      if (destroyed) return;
      canvas.focus({ preventScroll: true });
      const rect = canvas.getBoundingClientRect();
      const sx = evt.clientX - rect.left;
      const sy = evt.clientY - rect.top;
      if (!mapMode.isShown() && !locked) {
        const button = hitButton(navigationLayout(viewSize(), chartOptions), sx, sy);
        if (button) {
          if (button.id === "in" || button.id === "out" || button.id === "fit") api.zoom(button.id, { animate: true, time: 200 });
          else if (is3D()) orbitStep(button.id);
          else api.pan(button.id, { animate: true, time: 200 });
          return;
        }
        const ov = overviewBox || overviewLayout(viewSize(), chartOptions, overviewOpen);
        if (ov && sx >= ov.x && sx <= ov.x + ov.w && sy >= ov.y && sy <= ov.y + ov.h) {
          if (!ov.open) overviewOpen = true;
          else if (ov.toWorld) {
            const c = ov.toWorld(sx, sy);
            setView({ zoom: view.zoom, panX: -c.x, panY: -c.y }, { animate: true, time: 200 });
          }
          if (!ov.open) render();
          return;
        }
      }
      const id = hitTest(sx, sy);
      const props = pointerProps(evt, id);
      if (events.emit("pointer-down", props) || locked || evt.button === 2 && !is3D()) return;
      canvas.setPointerCapture(evt.pointerId);
      if (evt.button === 2) {
        gesture = { kind: "pan", id, x0: sx, y0: sy, x1: sx, y1: sy, moved: false, props, start: [], view: { ...view }, cam: camera.state, right: true };
        return;
      }
      if (pendingLink) {
        gesture = { kind: "createLink", source: pendingLink.source, x0: sx, y0: sy, x1: sx, y1: sy, moved: false };
        return;
      }
      const node = id && nodes[id];
      if (id) {
        const additive = props.modifierKeys.shift || props.modifierKeys.consistentCtrl;
        if (additive) setSelection(selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id], true);
        else if (!selection.includes(id)) setSelection([id], true);
      }
      const dragLinks = !chartOptions.drag || chartOptions.drag.links !== false;
      let kind;
      if (node) kind = "node";
      else if (id && dragLinks) kind = "node";
      else if (is3D() && !evt.altKey) kind = evt.shiftKey ? "pan" : "orbit";
      else kind = chartOptions.handMode || mapMode.isShown() ? "pan" : "marquee";
      let dragged = [];
      if (kind === "node") {
        const base2 = node ? selection.includes(id) ? selection : [id] : [links[id].id1, links[id].id2];
        dragged = base2.filter((n) => nodes[n] && isNodeVisible(nodes, n));
      }
      gesture = {
        kind,
        id,
        x0: sx,
        y0: sy,
        x1: sx,
        y1: sy,
        moved: false,
        props,
        start: dragged.map((n) => {
          const s = { id: n, x: nodes[n].x || 0, y: nodes[n].y || 0 };
          const p = is3D() && placeNode(nodes[n]);
          if (p) Object.assign(s, { offX: p.x - sx, offY: p.y - sy, depth: p.depth });
          return s;
        }),
        view: { ...view },
        cam: camera.state
      };
    });
    let hoverTimer = null;
    canvas.addEventListener("pointermove", (evt) => {
      if (destroyed) return;
      const rect = canvas.getBoundingClientRect();
      const sx = evt.clientX - rect.left;
      const sy = evt.clientY - rect.top;
      if (!gesture) {
        const id = hitTest(sx, sy);
        if (id !== hoverId) {
          hoverId = id;
          canvas.style.cursor = id ? "pointer" : "";
          const props = pointerProps(evt, id);
          if (chartOptions.truncateLabels) render();
          clearTimeout(hoverTimer);
          const delay = chartOptions.hover ?? 150;
          if (delay > 0) hoverTimer = setTimeout(() => {
            if (hoverId === id) events.emit("hover", props);
          }, delay);
          else events.emit("hover", props);
        }
        if (events.has("pointer-move")) events.emit("pointer-move", pointerProps(evt, id));
        return;
      }
      if (!gesture.moved && Math.hypot(sx - gesture.x0, sy - gesture.y0) < 3) return;
      if (!gesture.moved) {
        gesture.moved = true;
        if (gesture.kind !== "createLink" && events.emit("drag-start", { ...gesture.props, type: gesture.kind === "node" ? "move" : gesture.kind })) {
          gesture = null;
          return;
        }
      }
      gesture.x1 = sx;
      gesture.y1 = sy;
      if (gesture.kind === "node" && !mapMode.isShown() && chartOptions.dragPan !== false && chartOptions.panAtBoundary !== false) {
        const edge = 24;
        const size = viewSize();
        const px = sx < edge ? 10 : sx > size.w - edge ? -10 : 0;
        const py = sy < edge ? 10 : sy > size.h - edge ? -10 : 0;
        if (px || py) {
          view.panX += px / view.zoom;
          view.panY += py / view.zoom;
          gesture.x0 += px;
          gesture.y0 += py;
          events.emit("view-change");
        }
      }
      const dx = sx - gesture.x0;
      const dy = sy - gesture.y0;
      if (gesture.kind === "node") {
        gesture.start.forEach((s) => {
          const n = nodes[s.id];
          if (!n) return;
          if (mapMode.isShown()) {
            if (!n.pos) return;
            const p = mapMode.project({ pos: n.pos }) || { x: sx, y: sy };
            mapMode.moveNodeTo(n, p.x + evt.movementX, p.y + evt.movementY);
          } else if (is3D() && s.depth !== void 0) {
            const w = camera.unproject(sx + s.offX, sy + s.offY, s.depth, view, viewSize());
            n.x = w.x;
            n.y = w.y;
            n.z = w.z;
            afterMove(n);
          } else {
            n.x = s.x + dx / view.zoom;
            n.y = s.y + dy / view.zoom;
            afterMove(n);
          }
        });
        render();
      } else if (gesture.kind === "pan") {
        if (mapMode.isShown()) mapMode.panBy(evt.movementX, evt.movementY);
        else {
          view.panX = gesture.view.panX + dx / view.zoom;
          view.panY = gesture.view.panY + dy / view.zoom;
          render();
        }
      } else if (gesture.kind === "orbit") {
        camera.set(gesture.cam);
        camera.orbit(dx, dy);
        render();
      } else {
        render();
      }
      events.emit("drag-move", { ...pointerProps(evt, gesture.id), type: gesture.kind });
    });
    function endGesture(evt) {
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      const rect = canvas.getBoundingClientRect();
      const sx = evt.clientX - rect.left;
      const sy = evt.clientY - rect.top;
      const target = hitTest(sx, sy);
      const props = pointerProps(evt, target);
      if (g.kind === "createLink") {
        const done = pendingLink;
        pendingLink = null;
        const ok = target && nodes[target] && target !== done.source;
        if (ok) {
          links[done.linkId] = { type: "link", id: done.linkId, id1: done.source, id2: target, c: "#555", w: 2, ...done.style || {} };
          changed();
        } else render();
        done.resolve(ok ? target : null);
        return;
      }
      if (g.moved) {
        if (g.kind === "marquee") {
          const [x0, x1] = [Math.min(g.x0, g.x1), Math.max(g.x0, g.x1)];
          const [y0, y1] = [Math.min(g.y0, g.y1), Math.max(g.y0, g.y1)];
          const inside = visibleIds().filter((id) => {
            const p = placeNode(nodes[id]);
            return p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
          });
          const mode = chartOptions.marqueeLinkSelection || "centre";
          const inRect = (q) => q && q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
          if (mode !== "off") {
            Object.values(links).forEach((l) => {
              if (l.hi || !isNodeVisible(nodes, l.id1) || !isNodeVisible(nodes, l.id2)) return;
              const a = placeNode(nodes[l.id1]);
              const b = placeNode(nodes[l.id2]);
              if (!a || !b) return;
              const ok = mode === "ends" ? inRect(a) && inRect(b) : inRect({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
              if (ok) inside.push(l.id);
            });
          }
          const additive = props.modifierKeys.shift || props.modifierKeys.consistentCtrl;
          setSelection(additive ? [.../* @__PURE__ */ new Set([...selection, ...inside])] : inside, true);
        }
        if (g.kind === "pan" || g.kind === "orbit") events.emit("view-change");
        if (g.kind === "node" && target && !g.start.some((s) => s.id === target)) events.emit("drag-over", { ...props, type: "move" });
        if (g.kind === "node") events.emit("prechange", { type: "move" });
        events.emit("drag-end", { ...props, type: g.kind === "node" ? "move" : g.kind });
        if (g.kind === "node") graphFacade.reload();
        render();
      } else if (!g.right) {
        if (!events.emit("click", props) && !target && !locked) setSelection([], true);
      }
      events.emit("pointer-up", props);
    }
    canvas.addEventListener("pointerup", endGesture);
    canvas.addEventListener("pointercancel", endGesture);
    canvas.addEventListener("dblclick", (evt) => {
      if (destroyed) return;
      const rect = canvas.getBoundingClientRect();
      const id = hitTest(evt.clientX - rect.left, evt.clientY - rect.top);
      const props = pointerProps(evt, id);
      if (events.emit("double-click", props) || locked) return;
      if (id && isComboNode(nodes[id])) {
        if (nodes[id]._combo.open) combos.api.close(id);
        else combos.api.open(id);
      } else if (!id) {
        zoomAround(props.x, props.y, 1.6, { animate: true, time: 200 });
      }
    });
    canvas.addEventListener("contextmenu", (evt) => {
      const rect = canvas.getBoundingClientRect();
      const id = hitTest(evt.clientX - rect.left, evt.clientY - rect.top);
      if (events.emit("context-menu", pointerProps(evt, id)) || is3D()) evt.preventDefault();
    });
    canvas.addEventListener("wheel", (evt) => {
      if (destroyed) return;
      const props = { ...pointerProps(evt, null), deltaX: evt.deltaX, deltaY: evt.deltaY, deltaZ: evt.deltaZ };
      if (events.emit("wheel", props) || locked) return;
      if (chartOptions.navigation && chartOptions.navigation.wheel === false) return;
      evt.preventDefault();
      if (mapMode.isShown()) {
        mapMode.zoomAt(props.x, props.y, evt.deltaY);
        return;
      }
      zoomAround(props.x, props.y, Math.pow(1.0015, -evt.deltaY), {});
    }, { passive: false });
    const keyProps = (evt) => ({
      keyCode: evt.keyCode,
      key: evt.key,
      code: evt.code,
      modifierKeys: { alt: evt.altKey, ctrl: evt.ctrlKey, meta: evt.metaKey, shift: evt.shiftKey, consistentCtrl: evt.ctrlKey || evt.metaKey }
    });
    canvas.addEventListener("keydown", (evt) => {
      if (events.emit("key-down", keyProps(evt))) {
        evt.preventDefault();
        return;
      }
      if (locked) return;
      const panBy = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[evt.key];
      if (panBy) {
        evt.preventDefault();
        setView({ zoom: view.zoom, panX: view.panX + panBy[0] / view.zoom, panY: view.panY + panBy[1] / view.zoom });
      } else if ((evt.key === "Delete" || evt.key === "Backspace") && selection.length && events.has("delete")) {
        events.emit("delete");
      }
    });
    canvas.addEventListener("keyup", (evt) => {
      if (events.emit("key-up", keyProps(evt))) evt.preventDefault();
    });
    let resizeRaf = null;
    const onResize = () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(render);
    };
    window.addEventListener("resize", onResize);
    let pingRaf = null;
    function tickPings() {
      const now = performance.now();
      pings = pings.filter((p) => {
        if (now - p.start < p.time * p.repeat) return true;
        p.resolve();
        return false;
      });
      render();
      pingRaf = pings.length ? requestAnimationFrame(tickPings) : null;
    }
    function exportView(mode, w, h) {
      const size = viewSize();
      if (mode === "chart" || mode === "exact") return fitView(visibleIds(), { w, h });
      if (mode === "oneToOne") return { ...view, zoom: 1 };
      const s = Math.min(w / size.w, h / size.h);
      return { zoom: view.zoom * s, panX: view.panX, panY: view.panY };
    }
    function renderOffscreen(width, height, mode, withSelection, extra = {}) {
      const size = viewSize();
      const w = Math.max(1, Math.round(width || size.w));
      const h = Math.max(1, Math.round(height || size.h));
      let v;
      if (mode === "chart" || mode === "exact") v = fitView(visibleIds(), { w, h });
      else if (mode === "oneToOne") v = { ...view, zoom: 1 };
      else {
        const s = Math.min(w / size.w, h / size.h);
        v = { zoom: view.zoom * s, panX: view.panX, panY: view.panY };
      }
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const g = off.getContext("2d");
      drawScene(g, { w, h }, v, { selection: withSelection, overlays: false, ...extra });
      return { canvas: off, w, h, v };
    }
    function exportSize(opts) {
      const size = viewSize();
      if (opts.fitTo && typeof opts.fitTo === "object") {
        const { width, height } = opts.fitTo;
        const aspect = size.w / size.h;
        if (width && height) return { w: width, h: height };
        if (width) return { w: width, h: width / aspect };
        if (height) return { w: height * aspect, h: height };
      }
      if (opts.fitTo === "page") return { w: 595, h: 842 };
      return size;
    }
    function imageUrls() {
      const urls = [];
      [...Object.values(nodes), ...Object.values(links)].forEach((item) => {
        if (item.u) urls.push(item.u);
        asList5(item.g).forEach((gl2) => gl2 && gl2.u && urls.push(gl2.u));
      });
      if (chartOptions.watermark && chartOptions.watermark.u) urls.push(chartOptions.watermark.u);
      if (chartOptions.logo && chartOptions.logo.u) urls.push(chartOptions.logo.u);
      return urls;
    }
    const toBlob = (c, type, quality) => new Promise((resolve) => c.toBlob(resolve, type, quality));
    const api = {
      load(data) {
        const indexed = indexItems(data);
        nodes = indexed.nodes;
        links = indexed.links;
        selection = [];
        changed();
        return Promise.resolve();
      },
      merge(items) {
        const indexed = indexItems(items);
        Object.values(indexed.nodes).forEach((n) => {
          nodes[n.id] = { ...nodes[n.id] || {}, ...n };
        });
        Object.values(indexed.links).forEach((l) => {
          links[l.id] = { ...links[l.id] || {}, ...l };
        });
        changed();
        return Promise.resolve();
      },
      expand(items, opts = {}) {
        const indexed = indexItems(items);
        Object.values(indexed.nodes).forEach((n) => {
          if (nodes[n.id] || typeof n.x === "number") return;
          const neighbour = Object.values(indexed.links).map((l) => l.id1 === n.id ? l.id2 : l.id2 === n.id ? l.id1 : null).find((id) => id && nodes[id]);
          const at = neighbour ? nodes[neighbour] : { x: 0, y: 0 };
          n.x = (at.x || 0) + (Math.random() - 0.5) * DEFAULT_NODE_RADIUS * 4;
          n.y = (at.y || 0) + (Math.random() - 0.5) * DEFAULT_NODE_RADIUS * 4;
        });
        const existing = new Set(Object.keys(nodes));
        return api.merge(items).then(() => {
          const layout = opts.layout || {};
          const name = layout.name || "organic";
          const fix = layout.fix || "adaptive";
          let fixed;
          if (fix !== "adaptive" && (name === "organic" || name === "standard")) {
            const touched = /* @__PURE__ */ new Set();
            Object.values(indexed.links).forEach((l) => {
              if (existing.has(l.id1) && !existing.has(l.id2)) touched.add(l.id1);
              if (existing.has(l.id2) && !existing.has(l.id1)) touched.add(l.id2);
              if (existing.has(l.id1) && existing.has(l.id2) && !links[l.id]) {
                touched.add(l.id1);
                touched.add(l.id2);
              }
            });
            const all = [...existing].filter((id) => nodes[id]);
            fixed = fix === "all" ? all : fix === "adjacent" ? all.filter((id) => touched.has(id)) : fix === "nonadjacent" ? all.filter((id) => !touched.has(id)) : [];
          }
          return api.layout(name, {
            mode: "adaptive",
            ...layout,
            ...fixed ? { fixed, mode: fixed.length ? "adaptive" : "full" } : {},
            animate: opts.animate,
            time: opts.time,
            fit: layout.fit ?? true
          });
        });
      },
      removeItem(ids) {
        asList5(ids).forEach((id) => {
          if (links[id]) {
            delete links[id];
            return;
          }
          if (!nodes[id]) return;
          const gone = [id, ...isComboNode(nodes[id]) ? descendants(nodes, id) : []];
          const parent = nodes[nodes[id].parentId];
          if (parent && isComboNode(parent)) delete parent._combo.offsets[id];
          gone.forEach((n) => delete nodes[n]);
          Object.values(links).forEach((l) => {
            if (!nodes[l.id1] || !nodes[l.id2]) delete links[l.id];
          });
        });
        selection = selection.filter((id) => nodes[id] || links[id]);
        changed();
      },
      setItem(item) {
        if (!item || item.id == null) return Promise.reject(new Error("setItem: item must have an id"));
        if (item.type === "link") {
          if (!nodes[item.id1] || !nodes[item.id2]) return Promise.reject(new Error(`setItem: link ${item.id} refers to a missing node`));
          links[item.id] = { ...item };
        } else {
          const old = nodes[item.id];
          nodes[item.id] = { type: "node", ...item, ...old && old._combo ? { _combo: old._combo } : {} };
        }
        changed();
        return Promise.resolve();
      },
      getItem(id) {
        const one = (i) => nodes[i] || links[i] || null;
        return Array.isArray(id) ? id.map(one) : one(id);
      },
      clear() {
        nodes = {};
        links = {};
        selection = [];
        changed();
      },
      serialize() {
        const strip = (item) => {
          const copy = clone(item);
          delete copy._bg;
          return copy;
        };
        return { type: "LinkChart", items: [...Object.values(nodes), ...Object.values(links)].map(strip) };
      },
      each(query, visit) {
        const type = query && query.type || "all";
        const scope = query && query.items || "toplevel";
        const keep = (item) => {
          if (scope === "underlying" && isComboNode(item)) return false;
          if (scope === "toplevel" && item.type !== "link" && item.parentId != null) return false;
          return true;
        };
        if (type !== "link") Object.values(nodes).filter(keep).forEach((n) => visit(n));
        if (type !== "node") Object.values(links).forEach((l) => visit(l));
      },
      graph: () => graphFacade,
      combo: () => comboApiWithPrechange,
      map: () => mapMode.api,
      selection(ids) {
        if (ids === void 0) return selection.slice();
        setSelection(ids, false);
        return selection.slice();
      },
      setProperties(props, useRegEx) {
        asList5(props).forEach((update) => {
          if (!update || update.id === void 0) return;
          let targets;
          if (useRegEx) {
            const re = new RegExp(update.id);
            targets = [...Object.values(nodes), ...Object.values(links)].filter((item) => re.test(item.id));
          } else {
            targets = [nodes[update.id] || links[update.id]].filter(Boolean);
          }
          targets.forEach((target) => {
            Object.keys(update).forEach((key) => {
              if (key === "id") return;
              if (update[key] === null) delete target[key];
              else target[key] = update[key];
            });
            if (target.type !== "link" && ("x" in update || "y" in update)) afterMove(target);
          });
        });
        changed();
        return Promise.resolve();
      },
      animateProperties,
      hide(ids) {
        asList5(ids).forEach((id) => {
          const item = nodes[id] || links[id];
          if (item) item.hi = true;
        });
        changed();
        return Promise.resolve();
      },
      show(ids, showLinks = false) {
        const list = asList5(ids);
        list.forEach((id) => {
          const item = nodes[id] || links[id];
          if (item) delete item.hi;
        });
        if (showLinks) {
          const set = new Set(list);
          Object.values(links).forEach((l) => {
            if ((set.has(l.id1) || set.has(l.id2)) && !nodes[l.id1]?.hi && !nodes[l.id2]?.hi) delete l.hi;
          });
        }
        changed();
        return Promise.resolve();
      },
      filter(fn, opts = {}) {
        const type = opts.type || "node";
        const result = { shown: { nodes: [], links: [] }, hidden: { nodes: [], links: [] }, combos: { nodes: [], links: [] } };
        if (type !== "link") {
          Object.values(nodes).forEach((n) => {
            if (isComboNode(n)) return;
            if (fn(n)) delete n.hi;
            else n.hi = true;
          });
        }
        Object.values(links).forEach((l) => {
          const endsShown = !nodes[l.id1]?.hi && !nodes[l.id2]?.hi;
          const pass = type === "node" ? true : fn(l);
          if (pass && endsShown) delete l.hi;
          else l.hi = true;
        });
        if (opts.hideSingletons) {
          const linked = /* @__PURE__ */ new Set();
          Object.values(links).forEach((l) => {
            if (!l.hi) {
              linked.add(l.id1);
              linked.add(l.id2);
            }
          });
          Object.values(nodes).forEach((n) => {
            if (!isComboNode(n) && !n.hi && !linked.has(n.id)) n.hi = true;
          });
        }
        Object.values(nodes).forEach((n) => {
          if (!isComboNode(n)) result[n.hi ? "hidden" : "shown"].nodes.push(n.id);
        });
        Object.values(links).forEach((l) => result[l.hi ? "hidden" : "shown"].links.push(l.id));
        changed();
        return Promise.resolve(result);
      },
      foreground(fn, opts = {}) {
        const type = opts.type || "node";
        const result = { foreground: { nodes: [], links: [] }, background: { nodes: [], links: [] } };
        Object.values(nodes).forEach((n) => {
          const fg = type === "link" ? true : !!fn(n);
          if (fg) delete n._bg;
          else n._bg = true;
          result[fg ? "foreground" : "background"].nodes.push(n.id);
        });
        Object.values(links).forEach((l) => {
          const fg = type === "node" ? !nodes[l.id1]?._bg && !nodes[l.id2]?._bg : !!fn(l);
          if (fg) delete l._bg;
          else l._bg = true;
          result[fg ? "foreground" : "background"].links.push(l.id);
        });
        if (type === "link") {
          const keep = /* @__PURE__ */ new Set();
          Object.values(links).forEach((l) => {
            if (!l._bg) {
              keep.add(l.id1);
              keep.add(l.id2);
            }
          });
          result.foreground.nodes = [];
          result.background.nodes = [];
          Object.values(nodes).forEach((n) => {
            const fg = keep.has(n.id);
            if (fg) delete n._bg;
            else n._bg = true;
            result[fg ? "foreground" : "background"].nodes.push(n.id);
          });
        }
        render();
        return Promise.resolve(result);
      },
      ping(ids, opts = {}) {
        const list = asList5(ids).filter((id) => nodes[id]);
        const done = list.map((id) => new Promise((resolve) => {
          pings.push({
            id,
            start: performance.now(),
            resolve,
            c: opts.c || "#2196f3",
            r: opts.r ?? 80,
            w: opts.w ?? 20,
            lw: opts.lw ?? 4,
            time: opts.time ?? 800,
            repeat: Math.max(1, opts.repeat ?? 1)
          });
        }));
        if (!pingRaf && pings.length) pingRaf = requestAnimationFrame(tickPings);
        return Promise.all(done).then(() => void 0);
      },
      lock(val) {
        if (val !== void 0) {
          locked = !!val;
          canvas.style.cursor = locked ? chartOptions.lockCursor || "wait" : "";
        }
        return locked;
      },
      labelPosition(id) {
        const node = nodes[id];
        if (!node || !isNodeVisible(nodes, id) || !labelText(node)) return null;
        const p = placeNode(node);
        if (!p) return null;
        const fs = p.r * 0.36;
        ctx.font = `bold ${fs}px sans-serif`;
        const w = ctx.measureText(labelText(node)).width;
        return { x1: p.x - w / 2, x2: p.x + w / 2, y1: p.y - fs * 0.6, y2: p.y + fs * 0.6, fs };
      },
      getItemInfoAt(x, y) {
        const id = hitTest(x, y);
        return id ? { id, subItem: {} } : void 0;
      },
      contains(shape) {
        const { x, y, w, h } = shape;
        return visibleIds().filter((id) => {
          const n = nodes[id];
          const dx = (n.x || 0) - x;
          const dy = (n.y || 0) - y;
          return shape.sh === "circle" ? dx * dx / (w / 2) ** 2 + dy * dy / (h / 2) ** 2 <= 1 : Math.abs(dx) <= w / 2 && Math.abs(dy) <= h / 2;
        });
      },
      /** 3D camera { yaw, pitch, focal } (radians, world units). Takes effect with options.view3d. */
      camera(next, opts = {}) {
        if (next && Number.isFinite(next.focal)) baseFocal = Math.max(1, next.focal);
        if (next !== void 0) setView({ ...view, camera: next }, opts);
        return camera.state;
      },
      viewCoordinates(x, y, z = 0) {
        if (!is3D()) return toScreen(x, y);
        const p = camera.project(x, y, z, view, viewSize());
        return p ? { x: p.x, y: p.y } : null;
      },
      // 3D: the world point under (x, y) on the plane through the orbit pivot.
      worldCoordinates(x, y) {
        return is3D() ? camera.unproject(x, y, 0, view, viewSize()) : toWorld(x, y);
      },
      viewOptions(next, transition = {}) {
        const size = viewSize();
        if (next === void 0) {
          return { zoom: view.zoom, offsetX: view.panX * view.zoom, offsetY: view.panY * view.zoom, width: size.w, height: size.h };
        }
        const zoom = next.zoom ?? view.zoom;
        const panX = next.offsetX !== void 0 ? next.offsetX / zoom : view.panX;
        const panY = next.offsetY !== void 0 ? next.offsetY / zoom : view.panY;
        return setView({ zoom, panX, panY }, transition);
      },
      zoom(how, opts = {}) {
        if (mapMode.isShown()) {
          if (how === "in") mapMode.zoomBy(1);
          else if (how === "out") mapMode.zoomBy(-1);
          else mapMode.fit();
          return Promise.resolve();
        }
        const size = viewSize();
        if (how === "fit") return fitTo(asList5(opts.ids).filter((id) => nodes[id]), opts);
        if (how === "height") return fitTo(asList5(opts.ids).filter((id) => nodes[id]), opts, true);
        if (how === "selection") {
          const ids = selection.filter((id) => nodes[id]);
          return ids.length ? fitTo(ids, opts) : Promise.resolve();
        }
        if (how === "in") return zoomAround(size.w / 2, size.h / 2, ZOOM_STEP, opts);
        if (how === "out") return zoomAround(size.w / 2, size.h / 2, 1 / ZOOM_STEP, opts);
        if (how === "one") return setView({ zoom: 1, panX: view.panX, panY: view.panY }, opts);
        if (typeof how === "number") return setView({ zoom: how, panX: view.panX, panY: view.panY }, opts);
        return Promise.reject(new Error(`zoom: unknown option ${how}`));
      },
      pan(direction, opts = {}) {
        const size = viewSize();
        const step = { up: [0, size.h / 3], down: [0, -size.h / 3], left: [size.w / 3, 0], right: [-size.w / 3, 0] }[direction];
        if (mapMode.isShown()) {
          if (step) mapMode.panBy(step[0], step[1]);
          return Promise.resolve();
        }
        if (step) return setView({ zoom: view.zoom, panX: view.panX + step[0] / view.zoom, panY: view.panY + step[1] / view.zoom }, opts);
        if (direction === "selection") {
          const ids = selection.filter((id) => nodes[id]);
          if (!ids.length) return Promise.resolve();
          if (is3D()) return setView({ zoom: view.zoom, panX: 0, panY: 0, camera: fitView3D(ids, viewSize(), false, true).camera }, opts);
          const b = boundsOf(ids);
          return setView({ zoom: view.zoom, panX: -(b.minX + b.maxX) / 2, panY: -(b.minY + b.maxY) / 2 }, opts);
        }
        return Promise.reject(new Error(`pan: unknown direction ${direction}`));
      },
      arrange(name, ids, opts = {}) {
        const work = {};
        Object.keys(nodes).forEach((id) => {
          work[id] = { ...nodes[id] };
        });
        try {
          arrangeNodes(name, work, links, asList5(ids), opts);
        } catch (err) {
          return Promise.reject(err);
        }
        const targets = {};
        asList5(ids).forEach((id) => {
          if (work[id]) targets[id] = work[id];
        });
        return moveNodes(targets, opts).then(() => opts.fit ? fitTo(Object.keys(targets), { animate: opts.animate !== false }) : void 0);
      },
      layout(name = "standard", opts = {}) {
        const ids = visibleIds().filter((id) => {
          const p = nodes[nodes[id].parentId];
          return !(p && isComboNode(p));
        });
        const work = {};
        ids.forEach((id) => {
          work[id] = { ...nodes[id] };
        });
        const routed = {};
        Object.values(links).forEach((l) => {
          if (l.hi || !nodes[l.id1] || !nodes[l.id2]) return;
          const a = visibleEnd(nodes, l.id1);
          const b = visibleEnd(nodes, l.id2);
          if (a !== b && work[a] && work[b]) routed[l.id] = { ...l, id1: a, id2: b };
        });
        events.emit("progress", { task: "layout", progress: 0 });
        try {
          runLayout(name, work, routed, { dimensions: chartOptions.view3d ? 3 : 2, ...opts });
        } catch (err) {
          return Promise.reject(err);
        }
        const axis = opts.orientation === "left" || opts.orientation === "right" ? "horizontal" : "vertical";
        const curved = opts.linkShape === "curved" && (name === "hierarchy" || name === "sequential");
        Object.keys(routed).forEach((lid) => {
          const link = links[lid];
          if (curved) link._path = axis;
          else delete link._path;
          if (opts.straighten !== false) delete link.off;
        });
        const fit = opts.fit !== false;
        const animate = opts.animate !== false;
        return moveNodes(work, { animate, time: opts.time, easing: opts.easing }).then(() => {
          events.emit("progress", { task: "layout", progress: 1 });
          return fit ? fitTo(ids, { animate, time: 300 }) : void 0;
        });
      },
      createLink(id, linkId, opts = {}) {
        if (!nodes[id]) return Promise.reject(new Error(`createLink: no node ${id}`));
        if (pendingLink) pendingLink.resolve(null);
        return new Promise((resolve) => {
          pendingLink = { source: id, linkId, style: opts.style, resolve };
        });
      },
      getAggregateInfo(id) {
        const one = (i) => {
          const agg = aggregates.get(i);
          if (agg) {
            return { isAggregate: true, aggregateChildren: agg.children.slice(), aggregateDirection: agg.directed ? "both" : "none", aggregateByProp: void 0, parentAggregate: void 0 };
          }
          for (const [aggId, a] of aggregates) {
            if (a.children.includes(i)) return { isAggregate: false, parentAggregate: aggId };
          }
          return null;
        };
        return Array.isArray(id) ? id.map(one) : one(id);
      },
      async toDataURL(width, height, opts = {}) {
        await waitForImages(imageUrls());
        const { canvas: off } = renderOffscreen(width, height, opts.fit || "view", !!opts.selection, {
          logo: opts.logo !== false,
          watermark: opts.watermark !== false
        });
        return Promise.resolve(off.toDataURL("image/png"));
      },
      async export(opts = {}) {
        const type = (opts.type || "png").toLowerCase();
        const { w, h } = exportSize(opts);
        const mode = opts.extents === "chart" ? "chart" : "view";
        const warnings = [];
        let blob;
        const W = Math.max(1, Math.round(w));
        const H = Math.max(1, Math.round(h));
        const missing = await waitForImages(imageUrls());
        missing.forEach((url) => warnings.push({ type: "image", message: `Image not loaded, left out of export: ${url}` }));
        if (type === "svg") {
          const svg = createSvgContext(W, H, ctx);
          drawScene(svg, { w: W, h: H }, exportView(mode, W, H), { selection: false, overlays: false });
          warnings.push(...svg.warnings);
          blob = new Blob([svg.toSvg()], { type: "image/svg+xml" });
        } else if (type === "png" || type === "jpeg" || type === "jpg") {
          const { canvas: off } = renderOffscreen(w, h, mode, false);
          blob = await toBlob(off, type === "png" ? "image/png" : "image/jpeg", 0.92);
        } else if (type === "pdf") {
          const pdf = createPdfContext(W, H, ctx);
          drawScene(pdf, { w: W, h: H }, exportView(mode, W, H), { selection: false, overlays: false });
          const bytes = await pdf.toPdf();
          warnings.push(...pdf.warnings);
          blob = new Blob([bytes], { type: "application/pdf" });
        } else {
          throw new Error(`export: unsupported type ${opts.type}`);
        }
        return { url: URL.createObjectURL(blob), blob, warnings };
      },
      options(next) {
        if (next === void 0) return { ...chartOptions };
        chartOptions = { ...chartOptions, ...next };
        render();
        return Promise.resolve();
      },
      setContainer(element) {
        const target = typeof element === "string" ? document.getElementById(element) : element;
        if (mapMode.isShown()) mapMode.api.hide();
        if (gl) {
          gl.destroy();
          gl = null;
        }
        if (!target) {
          canvas.remove();
          return;
        }
        container = target;
        container.appendChild(canvas);
        render();
      },
      destroy() {
        if (destroyed) return;
        if (mapMode.isShown()) mapMode.api.hide();
        destroyed = true;
        window.removeEventListener("resize", onResize);
        if (pingRaf) cancelAnimationFrame(pingRaf);
        pings.forEach((p) => p.resolve());
        pings = [];
        if (pendingLink) {
          pendingLink.resolve(null);
          pendingLink = null;
        }
        clearTimeout(hoverTimer);
        if (gl) {
          gl.destroy();
          gl = null;
        }
        globals.renderers.delete(render);
        canvas.remove();
        events.clear();
        onDestroy();
        Object.keys(api).forEach((k) => {
          if (k === "destroy" || k === "toString") return;
          api[k] = () => {
            throw new Error("This chart has been destroyed");
          };
        });
      },
      on: events.on,
      off: events.off,
      bind: events.bind,
      unbind: events.unbind,
      toString: () => "[GraphNexus chart]"
    };
    globals.renderers.add(render);
    render();
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has("debug")) {
      const registry = window.__gnCharts = window.__gnCharts || [];
      registry.push({
        container,
        labelOf: (id) => labelText(nodes[id]),
        nodeState: () => Object.values(nodes).map((node) => ({
          id: node.id,
          label: labelText(node),
          rawT: node.t,
          x: node.x,
          y: node.y,
          z: node.z,
          e: node.e || 1,
          selected: selection.includes(node.id),
          halo: !!(node.ha0 && node.ha0.c)
        })),
        view: () => ({ ...view }),
        selection: () => selection.slice()
      });
    }
    const PRECHANGE = {
      layout: "layout",
      merge: "merge",
      expand: "expand",
      hide: "hide",
      show: "show",
      setProperties: "properties",
      animateProperties: "properties",
      setItem: "properties",
      removeItem: "delete",
      arrange: "arrange",
      filter: "hide"
    };
    Object.entries(PRECHANGE).forEach(([key, type]) => {
      const fn = api[key];
      api[key] = (...args) => {
        events.emit("prechange", { type });
        return fn(...args);
      };
    });
    const COMBO_PRECHANGE = { combine: "combine", uncombine: "uncombine", open: "open", close: "close", transfer: "transfer", arrange: "arrange combo" };
    const comboApiWithPrechange = { ...combos.api };
    Object.entries(COMBO_PRECHANGE).forEach(([key, type]) => {
      comboApiWithPrechange[key] = (...args) => {
        events.emit("prechange", { type });
        return combos.api[key](...args);
      };
    });
    return api;
  }
  var components2 = {};
  var componentCounter = 0;
  function resolveElement(target) {
    if (typeof target === "string") {
      const el = document.getElementById(target);
      if (!el) throw new Error(`Cannot create component. No element with id "${target}" exists in the DOM`);
      return el;
    }
    if (target && target.nodeType === 1) return target;
    throw new Error("create: a container id or element is required");
  }
  function createOne(def) {
    const definition = typeof def === "string" || def && def.nodeType === 1 ? { container: def } : def || {};
    const element = resolveElement(definition.container ?? definition.element ?? definition.id);
    const type = definition.type || "chart";
    if (type !== "chart" && type !== "timebar") throw new Error(`The type of component passed to create is not valid: ${type}`);
    let id = definition.id && typeof definition.id === "string" && definition.container ? definition.id : element.id;
    if (!id || components2[id]) id = `${type}-${++componentCounter}`;
    const onDestroy = () => {
      delete components2[id];
    };
    const component = type === "timebar" ? createTimebar(element, definition.options || {}) : createChart(element, definition.options || {}, onDestroy);
    if (type === "timebar") {
      const destroy = component.destroy;
      component.destroy = () => {
        destroy();
        onDestroy();
      };
    }
    components2[id] = component;
    return component;
  }
  function create(definitions) {
    return new Promise((resolve, reject) => {
      try {
        const wasArray = Array.isArray(definitions);
        const list = wasArray ? definitions : [definitions];
        if (list.length < 1) throw new Error("No definition passed to create");
        const made = list.map(createOne);
        resolve(wasArray ? made : made[0]);
      } catch (error) {
        reject(error);
      }
    });
  }
  var base = {
    create,
    components: components2,
    callbacks: () => GraphNexus,
    coords(evt) {
      const target = evt.currentTarget && evt.currentTarget.getBoundingClientRect ? evt.currentTarget : evt.target;
      const rect = target.getBoundingClientRect();
      const point = evt.touches && evt.touches[0] ? evt.touches[0] : evt;
      return { x: point.clientX - rect.left, y: point.clientY - rect.top };
    },
    corsAdapter(adapter) {
      globals.corsAdapter = typeof adapter === "function" ? adapter : null;
    },
    dashedLineSupport: () => typeof CanvasRenderingContext2D !== "undefined" && "setLineDash" in CanvasRenderingContext2D.prototype,
    fullScreenCapable: () => typeof document !== "undefined" && !!document.fullscreenEnabled,
    getFontIcon(classes) {
      const el = document.createElement("i");
      el.className = classes;
      el.style.position = "absolute";
      el.style.visibility = "hidden";
      document.body.appendChild(el);
      const content = getComputedStyle(el, "::before").content;
      el.remove();
      const ch = content && content !== "none" ? content.replace(/^["']|["']$/g, "") : "";
      return ch ? ch.codePointAt(0) : 0;
    },
    getGraphEngine: (opts) => withCallbacks(createGraphEngine(opts)),
    info: () => ({ version: VERSION, mode: base.mode(), webgl: base.webGLSupport() }),
    /** 'auto' (WebGL for large charts), 'webgl' or 'canvas'. Returns the mode in effect. */
    mode(value) {
      if (value !== void 0) {
        if (!["auto", "webgl", "canvas"].includes(value)) throw new Error(`mode: expected 'auto', 'webgl' or 'canvas', got ${value}`);
        globals.mode = value === "webgl" && !base.webGLSupport() ? "canvas" : value;
        globals.renderers.forEach((fn) => fn());
      }
      return globals.mode;
    },
    paths(value) {
      if (value !== void 0) globals.paths = { ...globals.paths, ...value };
      return { ...globals.paths };
    },
    setSize(target, width, height) {
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        throw new Error("setSize: Invalid width or height value passed. Both parameters should be numbers.");
      }
      const el = resolveElement(target);
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      window.dispatchEvent(new Event("resize"));
    },
    toggleFullScreen(element, handler) {
      const done = () => {
        if (typeof handler === "function") handler(!!document.fullscreenElement);
      };
      const p = document.fullscreenElement ? document.exitFullscreen() : resolveElement(element).requestFullscreen();
      Promise.resolve(p).then(done, done);
    },
    webGLSupport() {
      try {
        const c = document.createElement("canvas");
        return !!(c.getContext("webgl2") || c.getContext("webgl"));
      } catch {
        return false;
      }
    }
  };
  var ASYNC_METHODS = /* @__PURE__ */ new Set([
    "animateProperties",
    "arrange",
    "createLink",
    "expand",
    "export",
    "hide",
    "layout",
    "load",
    "merge",
    "options",
    "pan",
    "ping",
    "setItem",
    "setProperties",
    "show",
    "toDataURL",
    "viewOptions",
    "zoom",
    "range",
    "close",
    "combine",
    "open",
    "transfer",
    "uncombine",
    "betweenness",
    "closeness"
  ]);
  var FN_FIRST = /* @__PURE__ */ new Set(["filter", "foreground"]);
  var NESTED = /* @__PURE__ */ new Set(["graph", "combo", "map"]);
  function withCallbacks(target) {
    return new Proxy(target, {
      get(obj, key) {
        const value = obj[key];
        if (typeof value !== "function") return value;
        if (NESTED.has(key)) return (...args) => withCallbacks(value(...args));
        if (key === "create") {
          return (def, cb) => {
            const p = value(def).then((made) => Array.isArray(made) ? made.map(withCallbacks) : withCallbacks(made));
            if (typeof cb !== "function") return p;
            p.then((made) => cb(null, made), (err) => cb(err));
            return void 0;
          };
        }
        const isAsync = ASYNC_METHODS.has(key) || FN_FIRST.has(key);
        if (!isAsync) return value;
        return (...args) => {
          const last = args[args.length - 1];
          const hasCb = typeof last === "function" && (!FN_FIRST.has(key) || args.length > 1);
          if (!hasCb) return value(...args);
          args.pop();
          Promise.resolve(value(...args)).then(
            (result) => last(result),
            (err) => setTimeout(() => {
              throw err;
            })
          );
          return void 0;
        };
      }
    });
  }
  var GraphNexus = withCallbacks(base);
  var graph_nexus_default = GraphNexus;

  // src/graph-nexus-umd.js
  var graph_nexus_umd_default = graph_nexus_default;
  return __toCommonJS(graph_nexus_umd_exports);
})();
GraphNexus = GraphNexus.default || GraphNexus; if (typeof window !== 'undefined') window.GraphNexus = GraphNexus;
