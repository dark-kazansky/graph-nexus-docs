/**
 * Graph Nexus WebAssembly core loader (Rust source: wasm/graph-nexus-core).
 *
 * The module is embedded as base64 and compiled synchronously on first use (it is small),
 * so the synchronous layout API, the web worker, CJS / UMD bundles and file:// all work
 * without fetching a file. Every wrapper returns false / null when WebAssembly is missing,
 * disabled or fails to load; callers then run their JavaScript path, which gives the same
 * results (the Rust code mirrors it operation for operation; tests/wasm-parity.mjs checks).
 */
import { WASM_BASE64 } from './wasm/graphNexusCore.wasm.js';

let core = null;
let failed = false;
let enabled = true;
let currentRandom = Math.random; // env.random for the running call (coincident points only)

/** Turns the WebAssembly core on or off (off: JavaScript paths). For tests and comparisons. */
export function setWasmEnabled(on) { enabled = !!on; }

/** True when calls currently run in WebAssembly. */
export function wasmActive() { return !!getCore(); }

function decode(b64) {
  if (typeof atob === 'function') {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

function getCore() {
  if (!enabled || failed) return null;
  if (core) return core;
  try {
    if (typeof WebAssembly !== 'object') throw new Error('WebAssembly unavailable');
    const mod = new WebAssembly.Module(decode(WASM_BASE64));
    core = new WebAssembly.Instance(mod, { env: { random: () => currentRandom() } }).exports;
  } catch {
    failed = true;
    core = null;
  }
  return core;
}

/** Buffers in WebAssembly memory for one call; views are re-made after calls (memory may grow). */
function session(c) {
  const blocks = [];
  return {
    alloc(Type, length) {
      const bytes = Math.max(8, length * Type.BYTES_PER_ELEMENT);
      const ptr = c.alloc(bytes);
      blocks.push([ptr, bytes]);
      return { ptr, length, Type };
    },
    view: b => new b.Type(c.memory.buffer, b.ptr, b.length),
    free() { blocks.forEach(([ptr, bytes]) => c.dealloc(ptr, bytes)); },
  };
}

/**
 * Runs the force-layout iterations (forceComponent / forceComponent3D) in WebAssembly and
 * writes the positions back onto the node objects. Returns false (nothing changed) when the
 * core is unavailable.
 * @param {object} p  { dims, nodes, ids, edges: [[id1, id2]], radius(id), fixed: Set, iterations,
 *   gap, k, gravity, temperature, minTemp, cooling, gx, gy, gz, useTree, random }
 */
export function forceStepsWasm(p) {
  const c = getCore();
  if (!c) return false;
  const { dims, nodes, ids, edges } = p;
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const s = session(c);
  try {
    const X = s.alloc(Float64Array, n);
    const Y = s.alloc(Float64Array, n);
    const Z = dims === 3 ? s.alloc(Float64Array, n) : null;
    const R = s.alloc(Float64Array, n);
    const F = s.alloc(Uint8Array, n);
    const E = s.alloc(Uint32Array, edges.length * 2);
    const x = s.view(X); const y = s.view(Y); const z = Z && s.view(Z);
    const r = s.view(R); const f = s.view(F); const e = s.view(E);
    ids.forEach((id, i) => {
      const node = nodes[id];
      x[i] = node.x; y[i] = node.y; if (z) z[i] = node.z;
      r[i] = p.radius(id);
      f[i] = p.fixed.has(id) ? 1 : 0;
    });
    edges.forEach(([a, b], j) => { e[2 * j] = index.get(a); e[2 * j + 1] = index.get(b); });
    currentRandom = p.random;
    const common = [R.ptr, F.ptr, n, E.ptr, edges.length, p.iterations, p.gap, p.k, p.gravity, p.temperature, p.minTemp, p.cooling];
    if (dims === 3) c.force3d(X.ptr, Y.ptr, Z.ptr, ...common, p.gx, p.gy, p.gz, p.useTree ? 1 : 0);
    else c.force2d(X.ptr, Y.ptr, ...common, p.gx, p.gy, p.useTree ? 1 : 0);
    const xo = s.view(X); const yo = s.view(Y); const zo = Z && s.view(Z);
    ids.forEach((id, i) => {
      const node = nodes[id];
      node.x = xo[i]; node.y = yo[i]; if (zo) node.z = zo[i];
    });
    return true;
  } finally {
    currentRandom = Math.random;
    s.free();
  }
}

/** Copies an indexedGraph CSR half ({ start, to, len }) into WebAssembly memory. */
function putCsr(s, half) {
  const S = s.alloc(Int32Array, half.start.length);
  const T = s.alloc(Int32Array, half.to.length);
  const L = s.alloc(Float64Array, half.len.length);
  s.view(S).set(half.start); s.view(T).set(half.to); s.view(L).set(half.len);
  return { S, T, L };
}

/** Runs sources in ~20 chunks so the progress callback still fires as the JS loop does. */
function inChunks(n, tick, run) {
  const step = Math.max(1, Math.floor(n / 20));
  for (let s0 = 0; s0 < n; s0 += step) {
    const s1 = Math.min(n, s0 + step);
    run(s0, s1);
    for (let i = s0; i < s1; i++) tick();
  }
}

/**
 * Closeness inputs for every source of an indexedGraph: { harmonic: Float64Array, settled: Int32Array },
 * or null when the core is unavailable.
 */
export function closenessWasm(g, tick) {
  const c = getCore();
  if (!c) return null;
  const s = session(c);
  try {
    const f = putCsr(s, g.fwd);
    const H = s.alloc(Float64Array, g.n);
    const C = s.alloc(Int32Array, g.n);
    inChunks(g.n, tick, (s0, s1) => c.closeness(f.S.ptr, f.T.ptr, f.L.ptr, g.n, g.fwd.to.length, g.unit ? 1 : 0, s0, s1, H.ptr, C.ptr));
    return { harmonic: Float64Array.from(s.view(H)), settled: Int32Array.from(s.view(C)) };
  } finally {
    s.free();
  }
}

/** Raw Brandes betweenness (before halving / normalising) for an indexedGraph, or null. */
export function betweennessWasm(g, tick) {
  const c = getCore();
  if (!c) return null;
  const s = session(c);
  try {
    const f = putCsr(s, g.fwd);
    const r = putCsr(s, g.rev);
    const RAW = s.alloc(Float64Array, g.n);
    s.view(RAW).fill(0);
    inChunks(g.n, tick, (s0, s1) => c.betweenness(f.S.ptr, f.T.ptr, f.L.ptr, r.S.ptr, r.T.ptr, r.L.ptr, g.n, g.fwd.to.length, g.unit ? 1 : 0, s0, s1, RAW.ptr));
    return Float64Array.from(s.view(RAW));
  } finally {
    s.free();
  }
}
